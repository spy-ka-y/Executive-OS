// Server-only Gemini client. Calls the Gemini REST API directly via `fetch` —
// no SDK, no native/node-only dependencies — so it bundles cleanly for any
// target (Vercel node, edge, workers) and never leaks into the client bundle.
// The GEMINI_API_KEY is read from process.env and never reaches the browser.
//
// The exported surface (executeGeminiPrompt / executeGeminiText / pingGemini /
// isGeminiConfigured / GeminiError) is unchanged so callers need no edits.

export class GeminiError extends Error {
  readonly code:
    | "missing_key"
    | "api_error"
    | "rate_limit"
    | "invalid_json"
    | "empty_response";
  readonly raw?: string;
  constructor(code: GeminiError["code"], message: string, raw?: string) {
    super(message);
    this.code = code;
    this.raw = raw;
  }
}

export function getGeminiKey(): string {
  return (
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    ""
  );
}

export function isGeminiConfigured(): boolean {
  return getGeminiKey().length > 0;
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Current GA models. flash leads for decision-quality; flash-lite is the
// higher-free-quota fallback; 2.0-flash is a final fallback. GEMINI_MODEL
// (resolved by the caller) overrides the lead model.
const DEFAULT_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

function modelsToTry(requested?: string): string[] {
  if (!requested) return DEFAULT_MODEL_CHAIN;
  return [requested, ...DEFAULT_MODEL_CHAIN.filter((m) => m !== requested)];
}

function classifyStatus(status: number, msg: string): { code: GeminiError["code"]; retryable: boolean } {
  if (status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(msg)) return { code: "rate_limit", retryable: true };
  if (status >= 400) return { code: "api_error", retryable: true };
  return { code: "api_error", retryable: false };
}

export interface GeminiPromptInput {
  system: string;
  user: string;
  model?: string;
}

interface RawResult {
  text: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

interface GeminiApiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

async function generate(input: GeminiPromptInput, json: boolean): Promise<RawResult> {
  const key = getGeminiKey();
  if (!key) throw new GeminiError("missing_key", "GEMINI_API_KEY is not configured on the server.");

  const body = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.user }] }],
    generationConfig: {
      temperature: json ? 0.4 : 0.5,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };

  let lastError: GeminiError | null = null;
  for (const model of modelsToTry(input.model)) {
    const t0 = Date.now();
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network/transport failure — try the next model, then give up.
      lastError = new GeminiError("api_error", err instanceof Error ? err.message : String(err));
      continue;
    }
    const durationMs = Date.now() - t0;

    if (!resp.ok) {
      let detail = `${resp.status} ${resp.statusText}`;
      try {
        const j = (await resp.json()) as GeminiApiResponse;
        if (j.error?.message) detail = j.error.message;
      } catch {
        /* ignore parse failure */
      }
      const { code, retryable } = classifyStatus(resp.status, detail);
      lastError = new GeminiError(code, detail);
      if (retryable) continue;
      throw lastError;
    }

    let data: GeminiApiResponse;
    try {
      data = (await resp.json()) as GeminiApiResponse;
    } catch (err) {
      lastError = new GeminiError("api_error", err instanceof Error ? err.message : String(err));
      continue;
    }

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      lastError = new GeminiError("empty_response", "Gemini returned an empty response.");
      continue;
    }

    const usage = data.usageMetadata;
    return {
      text,
      model,
      durationMs,
      promptTokens: usage?.promptTokenCount ?? 0,
      responseTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
    };
  }

  throw lastError ?? new GeminiError("api_error", "All Gemini models failed.");
}

export interface GeminiPromptResult {
  parsed: unknown;
  raw: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export async function executeGeminiPrompt(input: GeminiPromptInput): Promise<GeminiPromptResult> {
  const res = await generate(input, true);
  const text = res.text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Best-effort fence/object extraction (defense against models that ignore
    // responseMimeType and wrap JSON in prose / fences).
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(candidate.slice(first, last + 1));
      } catch {
        throw new GeminiError("invalid_json", "Gemini returned non-JSON output", text);
      }
    } else {
      throw new GeminiError("invalid_json", "Gemini returned non-JSON output", text);
    }
  }

  return {
    parsed,
    raw: text,
    model: res.model,
    durationMs: res.durationMs,
    promptTokens: res.promptTokens,
    responseTokens: res.responseTokens,
    totalTokens: res.totalTokens,
  };
}

export interface GeminiTextResult {
  text: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

// Free-text variant: returns the model's natural-language output (e.g. markdown)
// instead of forcing/parsing JSON. Used for conversational sections like Copilot.
export async function executeGeminiText(input: GeminiPromptInput): Promise<GeminiTextResult> {
  return generate(input, false);
}

// Live connectivity probe so the UI/health route can show the REAL reason when
// live AI is unavailable, instead of a silent fallback. (One tiny model call.)
export async function pingGemini(): Promise<
  { ok: true; model: string; latencyMs: number } | { ok: false; code: string; message: string }
> {
  if (!isGeminiConfigured()) return { ok: false, code: "missing_key", message: "GEMINI_API_KEY is not set on the server." };
  try {
    const r = await generate({ system: "Reply with the single word OK.", user: "ping" }, false);
    return { ok: true, model: r.model, latencyMs: r.durationMs };
  } catch (e) {
    if (e instanceof GeminiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "api_error", message: e instanceof Error ? e.message : String(e) };
  }
}
