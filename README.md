# zenlayer-ai-gateway (pi package)

A [pi](https://pi.dev) provider extension for the **Zenlayer AI Gateway** (`https://gateway.theturbo.ai/v1`) — an OpenAI-compatible gateway that fronts OpenAI, Anthropic, Zhipu GLM, Moonshot Kimi, DeepSeek, Alibaba Qwen, xAI Grok, Google Gemini, MiniMax, and Perplexity models behind a single `/v1/chat/completions` endpoint.

## What it does

- Registers a `zenlayer-ai-gateway` provider (api: `openai-completions`, bearer auth).
- **Auto-discovers models** at startup from the gateway's `/v1/models` endpoint and filters to chat-capable models (embeddings, image/video/audio gen are excluded).
- Attaches **per-family metadata** (context window, cost estimates, input modalities, reasoning flag, compat) using the gateway's `owned_by` field as the grouping key.
- Falls back to a built-in static catalog if the discovery fetch fails or no API key is available.
- Honors pi thinking levels: reasoning models accept OpenAI-style `reasoning_effort` (verified against glm-5.2, which the gateway accepts without error); Anthropic models use a custom `thinkingLevelMap`.

## Install

### From GitHub (recommended)

```bash
pi install git:github.com/markoinla/zenlayer-ai-gateway-pi
```

This adds an entry to `~/.pi/agent/settings.json` `packages`. Then set the API key and defaults:

```bash
export ZENLAYER_AI_GATEWAY_API_KEY=sk-...
```

```jsonc
// ~/.pi/agent/settings.json
{
  "defaultProvider": "zenlayer-ai-gateway",
  "defaultModel": "glm-5.2",
  "defaultThinkingLevel": "medium"
}
```

Restart pi (or `/reload`).

### Local path (development)

If you're hacking on the extension from a working copy:

```bash
pi install /Users/marko.stankovic/Desktop/PROJECTS/ZENLAYER/zenlayer-ai-gateway-pi
```

Edit `extensions/zenlayer-ai-gateway.ts`, then `/reload` to pick up changes — no commit or push required.

> The key is read from the `ZENLAYER_AI_GATEWAY_API_KEY` env var. If pi has logged in the provider (`/login`), the key stored in `~/.pi/agent/auth.json` overrides the env var for requests **and** is used as a fallback for the `/v1/models` discovery fetch when the env var is unset.

## Cost & metadata caveats

- Costs are **vendor list prices** (USD per 1M tokens), treated as estimates — the gateway does not expose its actual billing. The pi footer cost figure is approximate.
- Context windows and max output tokens are sourced from upstream vendor docs; where a gateway imposes a lower cap you will discover it via an error when exceeding it.
- The gateway's `/v1/models` returns only `id` + `owned_by` (no metadata), which is why per-family rules live in this file.
