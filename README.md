# The 2026 AI Infrastructure Hub

A live, search-grounded guide to the current AI ecosystem. This project was built to remove the marketing smoke and provide agency founders, media buyers, and everyday users with verified technical specifications for the latest foundational models.

## The Mission

In a market moving this fast, static information dies the moment it is published. This hub is built on a "Live Search" architecture. Instead of relying on memory, the integrated Strategy Hub uses Google Search grounding to verify model releases and benchmarks in real-time.

We value peace, honesty, and technical accuracy over hype.

## Core Ecosystems Tracked

| Provider | Model | Strength |
|---|---|---|
| Anthropic | Claude 4.6 Sonnet | Creative writing, Computer Use, human tone |
| OpenAI | ChatGPT 5.3 | Logic, math, Deep Research |
| Google | Gemini 3.1 Pro | 10M context, Google Workspace integration |
| Google | Gemini 3 Flash | Speed, mobile summaries |
| Perplexity | Perplexity | Fact-finding with cited sources |
| Meta | Meta AI | Social (WhatsApp, Instagram) |
| Mistral / DeepSeek | Open Alternatives | Privacy, open-source logic |

## Key Features

**Parallax Architecture** — A high-end editorial flow optimized for both Desktop and iOS mobile browsers.

**Recipe Finder** — Type a goal in plain English. A local matching engine maps it to one of 20 curated AI workflows using the tools you already own.

**Daily Plan Generator** — A Gemini-powered playbook builder that scours the live web and returns a custom 3-step AI strategy for any task you describe.

**Strategy Hub** — An interactive AI consultant (floating chat panel) with live Google Search access. Ask it to verify any model release, benchmark, or workflow.

**Live Audio Briefing** — A one-tap spoken summary of the hub using Gemini TTS.

**Simple Comparison Matrix** — A sticky-column table comparing the top four models across everyday tasks like writing tone, fact checking, and organization.

## Setup and Deployment

This project is a single, self-contained `index.html` file. No build step or server is required.

### 1. Add Your Gemini API Key

Open `index.html` and locate this line near the bottom of the file (around line 439):

```js
const apiKey = "";
```

Replace the empty string with your Gemini API key:

```js
const apiKey = "YOUR_GEMINI_API_KEY_HERE";
```

You can get a free key at [aistudio.google.com](https://aistudio.google.com).

**Note:** The API key is used client-side for the Strategy Hub chat, Plan Generator, and Audio Briefing. The Recipe Finder works entirely offline with no key required.

### 2. Deploy to GitHub Pages

1. Push your updated `index.html` to the `main` branch of your repository.
2. Go to **Settings > Pages** in your GitHub repository.
3. Under "Source", select **Deploy from a branch** and choose `main` / `/ (root)`.
4. GitHub will provide a public URL in the format `https://yourusername.github.io/ai-hub/`.

## Project Structure

```
ai-hub/
  index.html   — The entire application (UI, logic, recipes, API calls)
  README.md    — This file
```

## Tech Stack

- **Tailwind CSS** (CDN) — Utility-first styling
- **Lucide Icons** (CDN) — Clean icon set
- **Google Fonts** — Inter and Newsreader
- **Gemini API** — Strategy Hub, Plan Generator, Audio Briefing (requires API key)
- **Vanilla JS** — No frameworks, no build step
