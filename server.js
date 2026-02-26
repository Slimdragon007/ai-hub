/**
 * Claude Agent SDK — Model Advisor Agent
 * =======================================
 * This file teaches you the 3 core concepts of building an agent:
 *
 *  1. TOOLS   — Define what your agent CAN do (JSON schema)
 *  2. LOOP    — The agent thinks → calls tools → thinks again until done
 *  3. EXECUTE — Your code actually runs the tools and returns results
 *
 * Run:  node server.js
 * Test: curl -X POST http://localhost:3000/api/agent \
 *         -H "Content-Type: application/json" \
 *         -d '{"prompt":"Which model is best for writing code?"}'
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT 1: THE ANTHROPIC CLIENT
// One client, reads ANTHROPIC_API_KEY from .env automatically.
// ─────────────────────────────────────────────────────────────────────────────
const client = new Anthropic();

// ─────────────────────────────────────────────────────────────────────────────
// DATA: Model knowledge base (what the tools look up)
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_DB = {
  "claude-sonnet-4-6": {
    provider: "Anthropic",
    family: "Claude 4",
    speed: "fast",
    cost_input_per_mtok: 3,
    cost_output_per_mtok: 15,
    context_window: 200000,
    strengths: ["coding", "analysis", "writing", "instruction-following", "agents"],
    best_for: "Most tasks — excellent balance of speed, intelligence, and cost",
  },
  "claude-opus-4-6": {
    provider: "Anthropic",
    family: "Claude 4",
    speed: "moderate",
    cost_input_per_mtok: 5,
    cost_output_per_mtok: 25,
    context_window: 200000,
    strengths: ["complex reasoning", "research", "multi-step agents", "nuanced writing"],
    best_for: "Complex problems that need the highest intelligence available",
  },
  "claude-haiku-4-5": {
    provider: "Anthropic",
    family: "Claude 4",
    speed: "fastest",
    cost_input_per_mtok: 1,
    cost_output_per_mtok: 5,
    context_window: 200000,
    strengths: ["quick tasks", "classification", "summarization", "high-volume"],
    best_for: "High-volume, latency-sensitive tasks where cost matters most",
  },
  "gemini-2.5-flash": {
    provider: "Google",
    family: "Gemini 2",
    speed: "fast",
    cost_input_per_mtok: 0.15,
    cost_output_per_mtok: 0.6,
    context_window: 1000000,
    strengths: ["long context", "multimodal", "google search grounding"],
    best_for: "Very long documents, multimodal inputs, or Google ecosystem",
  },
  "gpt-4o": {
    provider: "OpenAI",
    family: "GPT-4",
    speed: "fast",
    cost_input_per_mtok: 2.5,
    cost_output_per_mtok: 10,
    context_window: 128000,
    strengths: ["general tasks", "vision", "function calling", "broad ecosystem"],
    best_for: "Teams already in the OpenAI ecosystem",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT 2: TOOL DEFINITIONS
// Tell Claude WHAT tools exist, WHAT they do, and WHAT inputs they need.
// Claude decides WHEN to call them — you never call them directly.
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "lookup_model",
    description:
      "Look up detailed specifications for a specific AI model by name. " +
      "Returns speed, cost, context window, strengths, and best use cases.",
    input_schema: {
      type: "object",
      properties: {
        model_name: {
          type: "string",
          description:
            "The model identifier, e.g. 'claude-sonnet-4-6', 'gpt-4o', 'gemini-2.5-flash'",
        },
      },
      required: ["model_name"],
    },
  },
  {
    name: "compare_models",
    description:
      "Compare two AI models side by side on a specific criterion. " +
      "Use this when the user wants to understand the difference between two models.",
    input_schema: {
      type: "object",
      properties: {
        model_a: { type: "string", description: "First model identifier" },
        model_b: { type: "string", description: "Second model identifier" },
        criteria: {
          type: "string",
          enum: ["cost", "speed", "context", "strengths", "overall"],
          description: "What aspect to compare",
        },
      },
      required: ["model_a", "model_b", "criteria"],
    },
  },
  {
    name: "get_recommendation",
    description:
      "Get the best model recommendation for a specific use case and set of priorities. " +
      "Call this when you have enough information about what the user needs.",
    input_schema: {
      type: "object",
      properties: {
        use_case: {
          type: "string",
          description: "What the user wants to use the model for",
        },
        priorities: {
          type: "array",
          items: {
            type: "string",
            enum: ["speed", "cost", "quality", "context_length", "multimodal"],
          },
          description: "Ordered list of priorities (most important first)",
        },
      },
      required: ["use_case", "priorities"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT 3: TOOL EXECUTION
// When Claude calls a tool, YOUR code runs it and returns the result.
// These are just plain JavaScript functions — no magic here.
// ─────────────────────────────────────────────────────────────────────────────
function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "lookup_model": {
      const key = toolInput.model_name.toLowerCase().replace(/\s+/g, "-");
      const model = MODEL_DB[key];
      if (!model) {
        return `Model "${toolInput.model_name}" not found. Known models: ${Object.keys(MODEL_DB).join(", ")}`;
      }
      return JSON.stringify(model, null, 2);
    }

    case "compare_models": {
      const a = MODEL_DB[toolInput.model_a.toLowerCase()];
      const b = MODEL_DB[toolInput.model_b.toLowerCase()];
      if (!a) return `Model "${toolInput.model_a}" not found.`;
      if (!b) return `Model "${toolInput.model_b}" not found.`;

      const { criteria } = toolInput;
      const comparison = {
        criteria,
        [toolInput.model_a]: criteria === "overall" ? a : { [criteria]: a[criteria] ?? a },
        [toolInput.model_b]: criteria === "overall" ? b : { [criteria]: b[criteria] ?? b },
      };
      return JSON.stringify(comparison, null, 2);
    }

    case "get_recommendation": {
      const { use_case, priorities } = toolInput;
      const scores = {};

      for (const [id, model] of Object.entries(MODEL_DB)) {
        let score = 0;
        if (priorities.includes("cost")) score += (10 - model.cost_input_per_mtok) * 2;
        if (priorities.includes("speed")) {
          score += model.speed === "fastest" ? 10 : model.speed === "fast" ? 7 : 4;
        }
        if (priorities.includes("quality")) {
          score += model.provider === "Anthropic" ? 8 : 6;
        }
        if (priorities.includes("context_length")) {
          score += Math.log10(model.context_window);
        }
        if (priorities.includes("multimodal")) {
          if (model.strengths.some((s) => s.includes("multimodal"))) score += 5;
        }
        scores[id] = score;
      }

      const ranked = Object.entries(scores).sort(([, a], [, b]) => b - a);
      const [topId] = ranked[0];
      const top = MODEL_DB[topId];

      return JSON.stringify({
        use_case,
        priorities,
        top_recommendation: topId,
        reasoning: top.best_for,
        ranked_options: ranked.map(([id, score]) => ({ model: id, score: Math.round(score) })),
      }, null, 2);
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT 4: THE AGENT LOOP
// This is the core of every agent. It runs until Claude says "end_turn".
//
//  Round 1: user message → Claude → tool_use blocks
//  Round 2: tool results → Claude → more tool_use OR end_turn
//  Round N: ...repeat until done
// ─────────────────────────────────────────────────────────────────────────────
async function runAgent(userPrompt) {
  // Start the conversation — just the user's question
  const messages = [{ role: "user", content: userPrompt }];

  // Track which tools were called (for the UI to display)
  const toolsUsed = [];
  let round = 0;

  while (round < 10) {
    // Safety: max 10 rounds to prevent infinite loops
    round++;

    // Ask Claude what to do next
    const response = await client.messages.create({
      model: "claude-sonnet-4-6", // ← Change to "claude-opus-4-6" for harder tasks
      max_tokens: 1024,
      system:
        "You are a knowledgeable AI model advisor for the 2026 AI Infrastructure Hub. " +
        "Help users choose the right AI model for their needs. " +
        "Always use the available tools to look up accurate specs before making recommendations. " +
        "Be concise and practical.",
      tools: TOOLS,
      messages,
    });

    // ── Case A: Claude is done — return the final text ──
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return {
        response: textBlock?.text ?? "Done.",
        tools_used: toolsUsed,
        rounds: round,
      };
    }

    // ── Case B: Claude wants to use tools ──
    if (response.stop_reason === "tool_use") {
      // Add Claude's response (including its tool_use blocks) to the conversation
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool Claude requested and collect results
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        // Record which tool was called (for the UI)
        toolsUsed.push({ tool: block.name, input: block.input });

        // YOUR CODE runs the tool — Claude gets the result
        const result = executeTool(block.name, block.input);

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id, // Must match the tool_use id exactly
          content: result,
        });
      }

      // Send all tool results back to Claude so it can continue reasoning
      messages.push({ role: "user", content: toolResults });

      // Loop: Claude now sees the tool results and decides what to do next
      continue;
    }

    // Unexpected stop reason
    break;
  }

  return { response: "Agent stopped unexpectedly.", tools_used: toolsUsed, rounds: round };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS ENDPOINT
// The HTML frontend calls this. Returns the agent's response and a log
// of every tool that was used — so you can see the agent loop in action.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/agent", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return res.status(400).json({ error: "prompt is required" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.",
    });
  }

  try {
    const result = await runAgent(prompt.trim());
    res.json(result);
  } catch (err) {
    console.error("Agent error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check — lets you verify the server is running
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: "claude-sonnet-4-6" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nClaude Agent server running on http://localhost:${PORT}`);
  console.log(`Test it: curl -X POST http://localhost:${PORT}/api/agent \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"prompt":"Which model is best for code generation?"}'`);
  console.log();
});
