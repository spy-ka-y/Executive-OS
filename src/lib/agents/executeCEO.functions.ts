// Phase 10 · CEO Executor (server function). Receives the assembled
// executive context payload + user prompt + CEO agent contract from the
// client, dispatches a real Gemini call on the server, validates the
// response against the Zod schema, and returns a typed result. The
// GEMINI_API_KEY never leaves the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AgentResponseSchema, type AgentResponse } from "@/lib/schemas/agentResponse";

const ExecuteCEOInput = z.object({
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
  contextPayload: z.record(z.unknown()),
  agentPrompt: z.record(z.unknown()),
  contract: z.record(z.unknown()),
});

export interface ExecuteCEOMeta {
  model: string;
  durationMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface ExecuteCEOError {
  code: string;
  message: string;
  raw?: string;
  issues?: string[];
}

export type ExecuteCEOResult =
  | { ok: true; response: AgentResponse; meta: ExecuteCEOMeta; raw: string }
  | { ok: false; error: ExecuteCEOError };

function assemblePrompts(input: z.infer<typeof ExecuteCEOInput>) {
  const system = [
    input.systemPrompt,
    "",
    "ROLE: You are the CEO agent. Reason in character using the CEO contract below.",
    "Cite the metrics and prior decisions you relied on (use them in referencedData / referencedDecisions).",
    "",
    "STRICT OUTPUT RULES:",
    "- Return ONLY a valid JSON object. No markdown. No code fences. No prose.",
    "- The object MUST conform to this schema:",
    '{ "agent": "CEO", "observation": string, "insight": string, "recommendation": string, "rationale": string, "stance": "Support"|"Conditional"|"Neutral"|"Oppose", "confidence": number(0-100), "referencedData": string[], "referencedDecisions": string[] }',
    "",
    "CEO AGENT CONTRACT:",
    JSON.stringify(input.contract),
    "",
    "CEO PROMPT OBJECT:",
    JSON.stringify(input.agentPrompt),
  ].join("\n");

  const user = [
    input.userPrompt,
    "",
    "CONTEXT PAYLOAD (briefing object):",
    JSON.stringify(input.contextPayload),
  ].join("\n");

  return { system, user };
}

export const executeCEO = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ExecuteCEOInput.parse(d))
  .handler(async ({ data }): Promise<ExecuteCEOResult> => {
    const { executeGeminiPrompt, isGeminiConfigured, GeminiError } = await import(
      "@/lib/ai/gemini.server"
    );
    const cost = await import("@/lib/ai/cost-control.server");

    if (!isGeminiConfigured()) {
      return { ok: false, error: { code: "missing_key", message: "GEMINI_API_KEY is not configured on the server." } };
    }

    const { system, user } = assemblePrompts(data);
    const model = cost.defaultModel() ?? "gemini-2.5-flash";

    // Cache + daily budget so a multi-agent meeting can't run up cost or quota.
    const key = cost.cacheKey({ section: "boardroom-ceo", json: true, model, system, user });
    const cached = cost.getCached<ExecuteCEOResult>(key);
    if (cached) return cached;
    if (cost.isOverBudget()) {
      return { ok: false, error: { code: "budget_exceeded", message: "Daily live-AI call budget reached; the boardroom is using its heuristic baseline." } };
    }

    try {
      const res = await executeGeminiPrompt({ system, user, model });
      cost.recordCall(res.promptTokens, res.responseTokens);
      const validated = AgentResponseSchema.safeParse(res.parsed);
      if (!validated.success) {
        return {
          ok: false,
          error: {
            code: "schema_invalid",
            message: "Gemini response failed schema validation.",
            raw: res.raw,
            issues: validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
          },
        };
      }
      const response: AgentResponse = { ...validated.data, agent: "CEO" };
      const result: ExecuteCEOResult = {
        ok: true,
        response,
        raw: res.raw,
        meta: {
          model: res.model,
          durationMs: res.durationMs,
          promptTokens: res.promptTokens,
          responseTokens: res.responseTokens,
          totalTokens: res.totalTokens,
        },
      };
      cost.setCached(key, result);
      return result;
    } catch (e) {
      if (e instanceof GeminiError) {
        return { ok: false, error: { code: e.code, message: e.message, raw: e.raw } };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: { code: "api_error", message: msg } };
    }
  });

export const getGeminiStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isGeminiConfigured } = await import("@/lib/ai/gemini.server");
  return { connected: isGeminiConfigured(), model: "Claude 3 Haiku (Bedrock)" };
});
