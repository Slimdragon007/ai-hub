/**
 * YNAB Finance Command Center — Claude Agent
 * ==========================================
 * A Claude agent with live access to your YNAB budget data.
 * Amex, Citi, and Chase all flow through YNAB → this agent reads it all.
 *
 * Setup:
 *   1. npm install
 *   2. cp .env.example .env  →  add ANTHROPIC_API_KEY + YNAB_ACCESS_TOKEN
 *   3. node server.js
 *
 * Try asking:
 *   "How much did I spend this month by category?"
 *   "What are my top merchants this month?"
 *   "Show me any credits or refunds in the last 60 days"
 *   "Draft a refund message for a $47 charge at Amazon"
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import * as ynabLib from "ynab";

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────────────────
const claude = new Anthropic();
const ynabAPI = new ynabLib.API(process.env.YNAB_ACCESS_TOKEN);

// ─────────────────────────────────────────────────────────────────────────────
// YNAB HELPERS
// Cached at startup so tools don't re-fetch on every call.
// ─────────────────────────────────────────────────────────────────────────────
let budgetId = null;
let accountMap = {}; // { accountId: { name, type } }

async function initYnab() {
  const budgetsResp = await ynabAPI.budgets.getBudgets();
  const budget = budgetsResp.data.budgets[0]; // use first / only budget
  budgetId = budget.id;

  const accountsResp = await ynabAPI.accounts.getAccounts(budgetId);
  for (const acct of accountsResp.data.accounts) {
    if (!acct.closed && !acct.deleted) {
      accountMap[acct.id] = { name: acct.name, type: acct.type };
    }
  }

  const acctNames = Object.values(accountMap).map((a) => a.name).join(", ");
  console.log(`\nYNAB connected: "${budget.name}"`);
  console.log(`Accounts: ${acctNames}\n`);
}

// Convert YNAB milliunits to dollars
function toDollars(milliunits) {
  return (milliunits / 1000).toFixed(2);
}

// Default: 30 days ago
function defaultSinceDate(daysBack = 30) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split("T")[0];
}

// Resolve a friendly account name to an account ID (fuzzy match)
function resolveAccountId(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const entry = Object.entries(accountMap).find(([, v]) =>
    v.name.toLowerCase().includes(lower)
  );
  return entry ? entry[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS
// Tell Claude what it can call and what inputs each tool expects.
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_accounts",
    description:
      "List all connected YNAB accounts (Amex, Citi, Chase, etc.) with current balances. " +
      "Call this first if the user asks which accounts are connected.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_transactions",
    description:
      "Fetch transactions from YNAB for a date range, optionally filtered to one account. " +
      "Returns date, payee, category, amount (in dollars), account name, and cleared status.",
    input_schema: {
      type: "object",
      properties: {
        since_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format. Default: 30 days ago.",
        },
        until_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format. Optional — defaults to today.",
        },
        account_name: {
          type: "string",
          description:
            "Filter to a specific account. Partial match works, e.g. 'amex', 'chase', 'citi'. " +
            "Omit to get transactions from all accounts.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_spending_by_category",
    description:
      "Summarize spending grouped by budget category for a date range. " +
      "Returns categories sorted by total spend, with transaction counts. " +
      "Use this for 'how much did I spend on X' or 'show my spending breakdown'.",
    input_schema: {
      type: "object",
      properties: {
        since_date: {
          type: "string",
          description: "Start date YYYY-MM-DD. Default: first of current month.",
        },
        until_date: {
          type: "string",
          description: "End date YYYY-MM-DD. Optional.",
        },
        account_name: {
          type: "string",
          description: "Limit to one account. Optional.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_top_merchants",
    description:
      "Show the top merchants/payees by total spend for a date range. " +
      "Use for 'where am I spending the most' or 'what are my top merchants'.",
    input_schema: {
      type: "object",
      properties: {
        since_date: {
          type: "string",
          description: "Start date YYYY-MM-DD. Default: 30 days ago.",
        },
        limit: {
          type: "number",
          description: "Number of merchants to return. Default: 10.",
        },
        account_name: {
          type: "string",
          description: "Limit to one account. Optional.",
        },
      },
      required: [],
    },
  },
  {
    name: "find_credits",
    description:
      "Find all credits, refunds, and positive-amount transactions on credit card accounts. " +
      "These are likely refunds, billing credits, or adjustments. " +
      "Use when the user asks about pending refunds, credits, or money owed back.",
    input_schema: {
      type: "object",
      properties: {
        since_date: {
          type: "string",
          description: "Start date YYYY-MM-DD. Default: 60 days ago.",
        },
      },
      required: [],
    },
  },
  {
    name: "draft_customer_message",
    description:
      "Draft a professional, ready-to-send customer service message. " +
      "Use when the user wants to request a refund, dispute a charge, follow up on an order, " +
      "or report a billing error.",
    input_schema: {
      type: "object",
      properties: {
        merchant: {
          type: "string",
          description: "The merchant or company name, e.g. 'Amazon', 'Citi'",
        },
        issue: {
          type: "string",
          enum: ["refund", "missing_order", "billing_error", "damaged_item", "overcharge", "follow_up"],
          description: "The type of issue",
        },
        amount: {
          type: "number",
          description: "Dollar amount involved",
        },
        order_ref: {
          type: "string",
          description: "Order number, transaction ID, or reference. Optional.",
        },
        days_pending: {
          type: "number",
          description: "How many days this has been unresolved. Optional.",
        },
      },
      required: ["merchant", "issue", "amount"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTION
// When Claude calls a tool, this runs the real logic and returns results.
// ─────────────────────────────────────────────────────────────────────────────
async function executeTool(toolName, input) {
  switch (toolName) {
    // ── Tool 1: List accounts ──────────────────────────────────────────────
    case "get_accounts": {
      const resp = await ynabAPI.accounts.getAccounts(budgetId);
      const accounts = resp.data.accounts
        .filter((a) => !a.closed && !a.deleted)
        .map((a) => ({
          name: a.name,
          type: a.type,
          balance: `$${toDollars(a.balance)}`,
          cleared_balance: `$${toDollars(a.cleared_balance)}`,
          uncleared_balance: `$${toDollars(a.uncleared_balance)}`,
        }));
      return JSON.stringify(accounts, null, 2);
    }

    // ── Tool 2: Get transactions ───────────────────────────────────────────
    case "get_transactions": {
      const sinceDate = input.since_date || defaultSinceDate(30);
      const filterAccountId = resolveAccountId(input.account_name);

      const resp = await ynabAPI.transactions.getTransactions(budgetId, sinceDate);
      let txns = resp.data.transactions.filter((t) => !t.deleted);

      // Filter by account if requested
      if (filterAccountId) {
        txns = txns.filter((t) => t.account_id === filterAccountId);
      }

      // Filter by until_date if provided
      if (input.until_date) {
        txns = txns.filter((t) => t.date <= input.until_date);
      }

      // Only outflows (expenses) — positive amounts are handled by find_credits
      const formatted = txns
        .filter((t) => t.amount < 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 100) // cap at 100 to keep context manageable
        .map((t) => ({
          date: t.date,
          payee: t.payee_name || "Unknown",
          category: t.category_name || "Uncategorized",
          amount: `$${toDollars(Math.abs(t.amount))}`,
          account: accountMap[t.account_id]?.name || t.account_id,
          memo: t.memo || "",
          cleared: t.cleared,
        }));

      return JSON.stringify({ count: formatted.length, transactions: formatted }, null, 2);
    }

    // ── Tool 3: Spending by category ──────────────────────────────────────
    case "get_spending_by_category": {
      // Default to current month
      const now = new Date();
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const sinceDate = input.since_date || firstOfMonth;
      const filterAccountId = resolveAccountId(input.account_name);

      const resp = await ynabAPI.transactions.getTransactions(budgetId, sinceDate);
      let txns = resp.data.transactions.filter((t) => !t.deleted && t.amount < 0);

      if (filterAccountId) txns = txns.filter((t) => t.account_id === filterAccountId);
      if (input.until_date) txns = txns.filter((t) => t.date <= input.until_date);

      // Aggregate by category
      const catTotals = {};
      for (const t of txns) {
        const cat = t.category_name || "Uncategorized";
        if (!catTotals[cat]) catTotals[cat] = { total: 0, count: 0 };
        catTotals[cat].total += Math.abs(t.amount);
        catTotals[cat].count += 1;
      }

      const sorted = Object.entries(catTotals)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([cat, data]) => ({
          category: cat,
          total: `$${toDollars(data.total)}`,
          transactions: data.count,
        }));

      const grandTotal = Object.values(catTotals).reduce((s, c) => s + c.total, 0);

      return JSON.stringify({
        period: `${sinceDate} to ${input.until_date || "today"}`,
        total_spent: `$${toDollars(grandTotal)}`,
        by_category: sorted,
      }, null, 2);
    }

    // ── Tool 4: Top merchants ──────────────────────────────────────────────
    case "get_top_merchants": {
      const sinceDate = input.since_date || defaultSinceDate(30);
      const limit = input.limit || 10;
      const filterAccountId = resolveAccountId(input.account_name);

      const resp = await ynabAPI.transactions.getTransactions(budgetId, sinceDate);
      let txns = resp.data.transactions.filter((t) => !t.deleted && t.amount < 0);

      if (filterAccountId) txns = txns.filter((t) => t.account_id === filterAccountId);

      const merchantTotals = {};
      for (const t of txns) {
        const payee = t.payee_name || "Unknown";
        if (!merchantTotals[payee]) merchantTotals[payee] = { total: 0, count: 0 };
        merchantTotals[payee].total += Math.abs(t.amount);
        merchantTotals[payee].count += 1;
      }

      const top = Object.entries(merchantTotals)
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, limit)
        .map(([merchant, data]) => ({
          merchant,
          total: `$${toDollars(data.total)}`,
          visits: data.count,
        }));

      return JSON.stringify({ since: sinceDate, top_merchants: top }, null, 2);
    }

    // ── Tool 5: Find credits / refunds ────────────────────────────────────
    case "find_credits": {
      const sinceDate = input.since_date || defaultSinceDate(60);

      const resp = await ynabAPI.transactions.getTransactions(budgetId, sinceDate);

      // Credits on credit card accounts = positive amounts (inflow)
      // Exclude transfer transactions
      const credits = resp.data.transactions
        .filter((t) => {
          if (t.deleted || t.amount <= 0) return false;
          const acct = accountMap[t.account_id];
          if (!acct) return false;
          if (acct.type !== "creditCard") return false;
          if (t.transfer_account_id) return false; // skip payments
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((t) => {
          const daysAgo = Math.floor(
            (Date.now() - new Date(t.date).getTime()) / (1000 * 60 * 60 * 24)
          );
          return {
            date: t.date,
            days_ago: daysAgo,
            payee: t.payee_name || "Unknown",
            amount: `$${toDollars(t.amount)}`,
            account: accountMap[t.account_id]?.name || t.account_id,
            category: t.category_name || "Uncategorized",
            memo: t.memo || "",
          };
        });

      return JSON.stringify({
        since: sinceDate,
        count: credits.length,
        credits,
      }, null, 2);
    }

    // ── Tool 6: Draft customer service message ────────────────────────────
    case "draft_customer_message": {
      const { merchant, issue, amount, order_ref, days_pending } = input;
      const ref = order_ref ? ` (ref: ${order_ref})` : "";
      const pending = days_pending ? ` This has been pending for ${days_pending} days.` : "";

      const templates = {
        refund:
          `I am writing to request a refund of $${amount} for a recent charge${ref}.${pending} ` +
          `I would appreciate confirmation that this refund has been initiated and an estimated timeline for when it will appear on my account.`,
        missing_order:
          `I placed an order totaling $${amount}${ref} and it has not arrived.${pending} ` +
          `Please provide an update on the status of my order or process a replacement/refund at your earliest convenience.`,
        billing_error:
          `I noticed an incorrect charge of $${amount} on my account${ref}.${pending} ` +
          `This charge does not appear to be valid. Please investigate and reverse this charge if it was made in error.`,
        damaged_item:
          `I received an item from my recent order totaling $${amount}${ref} and it arrived damaged. ` +
          `I would like to request a replacement or full refund. Please advise on how to proceed.`,
        overcharge:
          `I was charged $${amount}${ref}, which is more than the agreed price.${pending} ` +
          `Please review this transaction and issue a correction for the difference.`,
        follow_up:
          `I am following up on my previous inquiry regarding a $${amount} refund/issue${ref}.${pending} ` +
          `I have not yet received a resolution and would appreciate an update on the status.`,
      };

      const body = templates[issue] || templates.refund;

      return JSON.stringify({
        to: `${merchant} Customer Support`,
        subject: `Refund/Issue Request — $${amount}${ref}`,
        message: `Hello ${merchant} Customer Service,\n\n${body}\n\nThank you for your time and assistance.\n\nBest regards`,
        tip: "Add your name and any relevant order details before sending.",
      }, null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT LOOP
// Runs until Claude returns stop_reason "end_turn".
// Each round: Claude decides → tools execute → results feed back → repeat.
// ─────────────────────────────────────────────────────────────────────────────
async function runAgent(userPrompt) {
  const messages = [{ role: "user", content: userPrompt }];
  const toolsUsed = [];
  let round = 0;

  while (round < 10) {
    round++;

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system:
        "You are a personal finance assistant with live access to YNAB budget data " +
        "across Amex, Citi, and Chase accounts. Help the user understand spending, " +
        "track credits and potential refunds, and draft customer service messages.\n\n" +
        "Guidelines:\n" +
        "- Always call a tool to get real data before answering — never guess amounts\n" +
        "- Default date range is last 30 days unless the user says otherwise\n" +
        "- Amounts are USD. Be concise: '$47.23 at Whole Foods' not 'forty-seven dollars'\n" +
        "- For refund questions, use find_credits and note how many days each is pending\n" +
        "- When drafting messages, be professional and specific — use real amounts from the data\n" +
        "- Format spending summaries as clear lists, not paragraphs",
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return { response: textBlock?.text ?? "Done.", tools_used: toolsUsed, rounds: round };
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        toolsUsed.push({ tool: block.name, input: block.input });

        let result;
        try {
          result = await executeTool(block.name, block.input);
        } catch (err) {
          result = JSON.stringify({ error: err.message });
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return { response: "Agent stopped unexpectedly.", tools_used: toolsUsed, rounds: round };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/agent", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in .env" });
  }
  if (!process.env.YNAB_ACCESS_TOKEN) {
    return res.status(500).json({ error: "YNAB_ACCESS_TOKEN not set in .env" });
  }

  try {
    const result = await runAgent(prompt.trim());
    res.json(result);
  } catch (err) {
    console.error("Agent error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: "claude-sonnet-4-6",
    ynab_connected: !!budgetId,
    accounts: Object.values(accountMap).map((a) => a.name),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initYnab()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Finance agent running on http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to YNAB:", err.message);
    console.error("Check your YNAB_ACCESS_TOKEN in .env");
    process.exit(1);
  });
