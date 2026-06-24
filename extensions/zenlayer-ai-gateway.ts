import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Zenlayer AI Gateway — OpenAI-compatible gateway fronting many vendors.
// Docs: https://gateway.theturbo.ai/v1  (OpenAI-style /v1/chat/completions)

const BASE_URL = "https://gateway.theturbo.ai/v1";
const API_KEY_ENV = "ZENLAYER_AI_GATEWAY_API_KEY";
const AUTH_FILE = `${process.env.HOME || ""}/.pi/agent/auth.json`;
const PROVIDER_NAME = "zenlayer-ai-gateway";

// ---------------------------------------------------------------------------
// Cost estimates (USD per 1M tokens) — VENDOR LIST prices, not the gateway's
// actual billing (which it does not expose). cacheWrite set only for
// Anthropic (1.25x input); others left 0. Unverified models stay 0.
// ---------------------------------------------------------------------------
const costGpt4o       = { input: 2.5,  output: 10,  cacheRead: 1.25,  cacheWrite: 0 };
const costGpt4oMini   = { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 };
const costGpt41       = { input: 2,    output: 8,   cacheRead: 0.5,   cacheWrite: 0 };
const costGpt5        = { input: 1.25, output: 10,  cacheRead: 0.125, cacheWrite: 0 };
const costOpus        = { input: 5,    output: 25,  cacheRead: 0.5,   cacheWrite: 6.25 };
const costSonnet      = { input: 3,    output: 15,  cacheRead: 0.3,   cacheWrite: 3.75 };
const costHaiku       = { input: 1,    output: 5,   cacheRead: 0.1,   cacheWrite: 1.25 };
const costGlm5        = { input: 1,    output: 3.2, cacheRead: 0.2,   cacheWrite: 0 };
const costKimi        = { input: 0.6,  output: 2.5, cacheRead: 0,     cacheWrite: 0 };
const costDeepseekV4  = { input: 1.74, output: 3.48,cacheRead: 0.174, cacheWrite: 0 };
const costGrok43      = { input: 1.25, output: 2.5, cacheRead: 0,     cacheWrite: 0 };
const costGemini31Pro = { input: 2,    output: 12,  cacheRead: 0,     cacheWrite: 0 };
const costQwen37Max   = { input: 2.4,  output: 12,  cacheRead: 0,     cacheWrite: 0 };
const costQwen3Coder  = { input: 0.86, output: 3.44,cacheRead: 0,     cacheWrite: 0 };
const defaultCost     = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// ---------------------------------------------------------------------------
// Compat presets. supportsStore:false because the gateway does not implement
// OpenAI's /v1/store conversation API. supportsReasoningEffort:true lets pi
// send OpenAI-style `reasoning_effort`; verified the gateway accepts it on
// non-OpenAI reasoning models (e.g. glm-5.2) without erroring.
// ---------------------------------------------------------------------------
const defaultCompat = {
  supportsDeveloperRole: false,
  supportsStore: false,
  maxTokensField: "max_tokens" as const,
};
const reasoningCompat = {
  ...defaultCompat,
  supportsReasoningEffort: true,
};

// Anthropic levels: pi off..xhigh -> Claude none/low/medium/high.
// minimal & xhigh map to null (use model default).
const anthropicThinkingLevelMap = {
  off: "none",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
};

// Non-chat model ids served by the gateway (embeddings, image/video/audio
// gen, transcription, tts). Excluded from registration. The prefix list
// catches ids like `viduq1`, `veo-3.1-...`, `sora-2` that have no separator
// after the vendor token.
const NON_CHAT_PREFIXES = ["vidu", "veo", "sora", "imagen", "gpt-image", "whisper", "tts-", "text-embedding", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"];
const NON_CHAT =
  /(?:^|[-_])(embedding|transcribe|tts|whisper|imagen|veo|sora|vidu|gpt-image|image|generate|moderation|audio|realtime)(?:[-_]|$)/i;
function isNonChat(id: string): boolean {
  if (NON_CHAT_PREFIXES.some((p) => id.startsWith(p))) return true;
  return NON_CHAT.test(id);
}

// ---------------------------------------------------------------------------
// Per-family metadata rules. Keyed off the gateway's `owned_by` value.
// Each returns a full model spec (minus `id`, which the caller supplies).
// ---------------------------------------------------------------------------
type ModelSpec = {
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: typeof defaultCost;
  contextWindow: number;
  maxTokens: number;
  compat: typeof defaultCompat;
  thinkingLevelMap?: typeof anthropicThinkingLevelMap;
};

function niceName(id: string): string {
  if (id === "chat-latest") return "GPT-5.5 Instant";
  const known: Record<string, string> = {
    "glm-5.2": "GLM-5.2",
    "glm-5.1": "GLM-5.1",
    "glm-5": "GLM-5",
    "glm-5-turbo": "GLM-5 Turbo",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "grok-4.3": "Grok 4.3",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro (Preview)",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
    "qwen3.7-max": "Qwen3.7 Max",
    "qwen3-coder-next": "Qwen3 Coder Next",
    "kimi-k2.6": "Kimi K2.6",
    "kimi-k2-thinking": "Kimi K2 Thinking",
  };
  if (known[id]) return known[id];
  return id
    .split("-")
    .map((p) =>
      p === "gpt" ? "GPT" : p === "claude" ? "Claude" : p === "glm" ? "GLM" : p === "api" ? "API" : p.toUpperCase() === p ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(" ");
}

function openAiMeta(id: string): ModelSpec {
  const isCodex = id.includes("codex");
  const reasoning = id.startsWith("gpt-5") || id.startsWith("o1") || id.startsWith("o3");
  const ctx = id.startsWith("gpt-4.1") ? 1047576 : id.startsWith("gpt-5") || id === "chat-latest" ? 400000 : 128000;
  const cost = id.startsWith("gpt-4.1") ? costGpt41 : id.startsWith("gpt-5") || id === "chat-latest" ? costGpt5 : id === "gpt-4o" ? costGpt4o : id === "gpt-4o-mini" ? costGpt4oMini : defaultCost;
  return {
    name: niceName(id),
    reasoning,
    input: isCodex ? ["text"] : ["text", "image"],
    cost,
    contextWindow: ctx,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function anthropicMeta(id: string): ModelSpec {
  const cost = id.startsWith("claude-opus") ? costOpus : id.startsWith("claude-sonnet") ? costSonnet : id.startsWith("claude-haiku") ? costHaiku : defaultCost;
  return {
    name: niceName(id),
    reasoning: true,
    thinkingLevelMap: anthropicThinkingLevelMap,
    input: ["text", "image"],
    cost,
    contextWindow: 200000,
    maxTokens: 16384,
    compat: reasoningCompat,
  };
}

function glmMeta(id: string): ModelSpec {
  const reasoning = id.startsWith("glm-5");
  const ctx = id === "glm-5.2" ? 1000000 : id.startsWith("glm-5") ? 200000 : 128000;
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost: id.startsWith("glm-5") ? costGlm5 : defaultCost,
    contextWindow: ctx,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function kimiMeta(id: string): ModelSpec {
  const reasoning = id.includes("thinking");
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost: costKimi,
    contextWindow: 256000,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function deepseekMeta(id: string): ModelSpec {
  const reasoning = id === "deepseek-r1" || id === "deepseek-v4-pro";
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost: id.startsWith("deepseek-v4") ? costDeepseekV4 : defaultCost,
    contextWindow: 128000,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function qwenMeta(id: string): ModelSpec {
  const reasoning = /(?:^|[-_])(max|plus|thinking)(?:[-_]|$)/i.test(id) && !id.includes("coder");
  const cost = id.includes("coder") ? costQwen3Coder : id.includes("max") ? costQwen37Max : defaultCost;
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost,
    contextWindow: 256000,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function grokMeta(id: string): ModelSpec {
  const nonReasoning = id.includes("non-reasoning");
  const reasoning = !nonReasoning && (id.includes("reasoning") || id.startsWith("grok-4") || id === "grok-4.3");
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost: id === "grok-4.3" ? costGrok43 : defaultCost,
    contextWindow: id.startsWith("grok-4") ? 1000000 : 131072,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function geminiMeta(id: string): ModelSpec {
  return {
    name: niceName(id),
    reasoning: true,
    input: ["text", "image"],
    cost: costGemini31Pro,
    contextWindow: 1000000,
    maxTokens: 16384,
    compat: reasoningCompat,
  };
}

function genericMeta(id: string): ModelSpec {
  // Perplexity sonar / MiniMax / unknown — conservative defaults.
  const reasoning = /reasoning/i.test(id);
  return {
    name: niceName(id),
    reasoning,
    input: ["text"],
    cost: defaultCost,
    contextWindow: 128000,
    maxTokens: 16384,
    compat: reasoning ? reasoningCompat : defaultCompat,
  };
}

function metadataFor(id: string, ownedBy: string): ModelSpec {
  switch ((ownedBy || "").toLowerCase()) {
    case "openai": return openAiMeta(id);
    case "anthropic": return anthropicMeta(id);
    case "zhipu": return glmMeta(id);
    case "moonshot": return kimiMeta(id);
    case "deepseek": return deepseekMeta(id);
    case "alibaba": return qwenMeta(id);
    case "grok": return grokMeta(id);
    case "google": return geminiMeta(id);
    default: return genericMeta(id);
  }
}

// ---------------------------------------------------------------------------
// Static fallback catalog (used if discovery fetch fails / no key available).
// Keeps the provider usable; glm-5.2 (default) is always present.
// ---------------------------------------------------------------------------
function fallbackModels() {
  const ids: Array<[id: string, ownedBy: string]> = [
    ["glm-5.2", "zhipu"], ["glm-5.1", "zhipu"], ["glm-5", "zhipu"], ["glm-5-turbo", "zhipu"],
    ["glm-4.7", "zhipu"], ["glm-4.6", "zhipu"], ["glm-4.5", "zhipu"],
    ["gpt-5.5", "openai"], ["gpt-5.4", "openai"], ["gpt-5.4-pro", "openai"], ["gpt-5.3-codex", "openai"],
    ["gpt-5.2", "openai"], ["gpt-5.2-codex", "openai"], ["gpt-5.1", "openai"], ["gpt-5.1-codex", "openai"],
    ["gpt-5", "openai"], ["gpt-5-mini", "openai"], ["gpt-5-codex", "openai"], ["chat-latest", "openai"],
    ["gpt-4.1", "openai"], ["gpt-4o", "openai"],
    ["claude-opus-4-8", "anthropic"], ["claude-opus-4-7", "anthropic"], ["claude-sonnet-4-6", "anthropic"], ["claude-sonnet-4-5-20250929", "anthropic"],
    ["kimi-k2.6", "moonshot"], ["kimi-k2-thinking", "moonshot"],
    ["deepseek-v4-pro", "deepseek"], ["deepseek-r1", "deepseek"],
    ["qwen3.7-max", "alibaba"], ["qwen3-coder-next", "alibaba"],
    ["grok-4.3", "grok"],
    ["gemini-3.1-pro-preview", "google"],
  ];
  return ids.map(([id, owned]) => ({ id, ...metadataFor(id, owned) }));
}

// ---------------------------------------------------------------------------
// Key resolution for the discovery fetch.
// pi's request auth uses apiKey config (env var, resolved by pi). For the
// /v1/models fetch at registration time we resolve the same env var, falling
// back to the key pi stored via /login in auth.json.
// ---------------------------------------------------------------------------
async function resolveKey(): Promise<string | undefined> {
  if (process.env[API_KEY_ENV]) return process.env[API_KEY_ENV];
  try {
    const fs = await import("node:fs");
    const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    const entry = auth?.[PROVIDER_NAME];
    if (entry?.key) return entry.key;
  } catch {
    // auth.json missing or unreadable — not fatal, fallback catalog used.
  }
  return undefined;
}

async function discoverModels(key: string): Promise<{ id: string; owned_by: string }[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    return data
      .map((m: any) => ({ id: String(m.id), owned_by: String(m.owned_by ?? m.owner ?? "") }))
      .filter((m: { id: string }) => !!m.id && !isNonChat(m.id));
  } catch {
    return null;
  }
}

export default async function (pi: ExtensionAPI) {
  let models = fallbackModels();

  const key = await resolveKey();
  if (key) {
    const discovered = await discoverModels(key);
    if (discovered && discovered.length) {
      models = discovered.map((m) => ({ id: m.id, ...metadataFor(m.id, m.owned_by) }));
    }
  }

  pi.registerProvider(PROVIDER_NAME, {
    name: "Zenlayer AI Gateway",
    baseUrl: BASE_URL,
    // Env-var reference (pi resolves $VAR). /login key in auth.json overrides.
    apiKey: `$${API_KEY_ENV}`,
    api: "openai-completions",
    authHeader: true,
    headers: {
      Accept: "application/json",
      // Generated once per process. If the gateway offers session affinity via
      // a different mechanism, prefer that instead.
      "X-Conversation-Id": crypto.randomUUID(),
    },
    models,
  });
}
