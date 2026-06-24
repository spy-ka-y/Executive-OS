// Server-only AI client. Provider is AWS Bedrock (Anthropic Claude) invoked via
// @aws-sdk/client-bedrock-runtime. This module is the single place the app talks
// to the model; AWS credentials are read from process.env (the SDK default
// credential provider chain) and never reach the browser (.server.ts).
//
// The exported surface (executeGeminiPrompt / executeGeminiText / pingGemini /
// isGeminiConfigured / GeminiError and the *Input/*Result types) is intentionally
// UNCHANGED so every existing caller keeps working without edits — only the
// underlying HTTP call swapped from the Gemini REST API to Bedrock InvokeModel.
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

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

// Credential resolution. IMPORTANT: Vercel functions run on AWS Lambda, which
// RESERVES the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
// names and overrides them at runtime with the execution role's own credentials
// (which have no Bedrock access). So we read our keys from custom, NON-reserved
// names first (BEDROCK_AWS_*), falling back to the standard names for local dev,
// and pass them to the SDK explicitly rather than via the default chain.
function accessKeyId(): string {
  return process.env.BEDROCK_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "";
}
function secretAccessKey(): string {
  return process.env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";
}
function sessionToken(): string | undefined {
  return process.env.BEDROCK_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN ?? undefined;
}
function awsRegion(): string {
  return (
    process.env.BEDROCK_AWS_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    "us-east-1"
  );
}

// Backward-compatible config accessor (kept for the existing surface). Bedrock
// authenticates with an AWS access key pair, so we surface the access key id.
export function getGeminiKey(): string {
  return accessKeyId();
}

export function isGeminiConfigured(): boolean {
  // Bedrock needs an access key id + secret (session token optional for STS).
  return Boolean(accessKeyId() && secretAccessKey());
}

// Fast, cheap Anthropic model on Bedrock. Override with BEDROCK_MODEL_ID.
const DEFAULT_MODEL = "anthropic.claude-3-haiku-20240307-v1:0";
const MAX_TOKENS = (() => {
  const v = Number(process.env.BEDROCK_MAX_TOKENS);
  return Number.isFinite(v) && v > 0 ? v : 4096;
})();

// Resolve the model id to invoke. Callers historically pass Gemini model names
// (e.g. the judge passes "gemini-2.5-pro"); those are not valid Bedrock ids, so
// anything that isn't a Bedrock-style "<provider>.<model>" id falls back to the
// configured default rather than failing the call.
function resolveModelId(requested?: string): string {
  const isBedrockId = (m?: string): m is string =>
    !!m && /^(us\.|eu\.|apac\.)?(anthropic|amazon|meta|mistral|cohere|ai21|deepseek)\./.test(m);
  if (isBedrockId(requested)) return requested;
  const env = process.env.BEDROCK_MODEL_ID?.trim();
  return env && env.length ? env : DEFAULT_MODEL;
}

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!_client) {
    // Pass credentials explicitly (see the credential-resolution note above) so
    // the user's keys are used instead of the Lambda execution role's.
    const token = sessionToken();
    _client = new BedrockRuntimeClient({
      region: awsRegion(),
      credentials: {
        accessKeyId: accessKeyId(),
        secretAccessKey: secretAccessKey(),
        ...(token ? { sessionToken: token } : {}),
      },
    });
  }
  return _client;
}

function classifyBedrockError(err: unknown): GeminiError {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e?.name ?? "";
  const status = e?.$metadata?.httpStatusCode ?? 0;
  const msg = e?.message ?? String(err);
  if (name === "ThrottlingException" || status === 429 || /throttl|rate.?limit|too many requests/i.test(msg))
    return new GeminiError("rate_limit", msg);
  if (name === "AccessDeniedException" || status === 403)
    // Bad/insufficient credentials or model access not enabled in the account.
    return new GeminiError("missing_key", msg);
  return new GeminiError("api_error", msg);
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

// Anthropic-on-Bedrock response envelope.
interface BedrockAnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function generate(input: GeminiPromptInput, json: boolean): Promise<RawResult> {
  if (!isGeminiConfigured())
    throw new GeminiError("missing_key", "AWS credentials are not configured on the server (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).");

  const modelId = resolveModelId(input.model);

  // Anthropic Messages API payload (Bedrock invoke). JSON vs free-text differ
  // only in temperature; the prompts and the downstream JSON extraction are
  // unchanged from the previous provider.
  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: MAX_TOKENS,
    temperature: json ? 0.4 : 0.5,
    system: input.system,
    messages: [{ role: "user", content: [{ type: "text", text: input.user }] }],
  };

  const t0 = Date.now();
  let resp;
  try {
    resp = await client().send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      }),
    );
  } catch (err) {
    throw classifyBedrockError(err);
  }
  const durationMs = Date.now() - t0;

  let data: BedrockAnthropicResponse;
  try {
    data = JSON.parse(new TextDecoder().decode(resp.body)) as BedrockAnthropicResponse;
  } catch (err) {
    throw new GeminiError("api_error", err instanceof Error ? err.message : String(err));
  }

  const text = (data.content ?? [])
    .filter((b) => (b.type ?? "text") === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GeminiError("empty_response", "Bedrock returned an empty response.");

  const usage = data.usage;
  return {
    text,
    model: modelId,
    durationMs,
    promptTokens: usage?.input_tokens ?? 0,
    responseTokens: usage?.output_tokens ?? 0,
    totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
  };
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
    // Best-effort fence/object extraction (defense against models that wrap JSON
    // in prose / fences).
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(candidate.slice(first, last + 1));
      } catch {
        throw new GeminiError("invalid_json", "Model returned non-JSON output", text);
      }
    } else {
      throw new GeminiError("invalid_json", "Model returned non-JSON output", text);
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
  if (!isGeminiConfigured())
    return { ok: false, code: "missing_key", message: "AWS credentials are not set on the server." };
  try {
    const r = await generate({ system: "Reply with the single word OK.", user: "ping" }, false);
    return { ok: true, model: r.model, latencyMs: r.durationMs };
  } catch (e) {
    if (e instanceof GeminiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "api_error", message: e instanceof Error ? e.message : String(e) };
  }
}
