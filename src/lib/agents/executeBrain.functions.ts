// Shared AI "brain" server function. Every interactive section routes its
// user input through this single server-side entry point — there is no other
// model-call/fetch path. The GEMINI_API_KEY never leaves the server.
//
// Two modes:
//   - json: false (default) → returns the model's free-text (markdown) output.
//   - json: true            → returns text + a parsed JSON object.
//
// Prompt construction lives in the shared client module src/lib/ai/brain.ts;
// this handler only assembles the final system/user strings, dispatches the
// Gemini call, and maps errors to a typed result.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ExecuteBrainInput = z.object({
  section: z.string().min(1),
  system: z.string().min(1),
  user: z.string().min(1),
  json: z.boolean().optional().default(false),
  model: z.string().optional(),
});

export interface BrainMeta {
  section: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface BrainError {
  code: string;
  message: string;
  raw?: string;
}

// JSON-serializable value — server functions require serializable return types.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type BrainResult =
  | { ok: true; text: string; parsed: JsonValue | null; meta: BrainMeta }
  | { ok: false; error: BrainError };

export const executeBrain = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ExecuteBrainInput.parse(d))
  .handler(async ({ data }): Promise<BrainResult> => {
    const { executeGeminiPrompt, executeGeminiText, isGeminiConfigured, GeminiError } =
      await import("@/lib/ai/gemini.server");
    const cost = await import("@/lib/ai/cost-control.server");

    if (!isGeminiConfigured()) {
      return {
        ok: false,
        error: { code: "missing_key", message: "GEMINI_API_KEY is not configured on the server." },
      };
    }

    const model = data.model ?? cost.defaultModel();

    // 1) Serve identical prompts from cache (no model call, no cost).
    const key = cost.cacheKey({ section: data.section, json: data.json, model, system: data.system, user: data.user });
    const cached = cost.getCached<BrainResult>(key);
    if (cached) return cached;

    // 2) Stop once the daily live-call budget is spent — the caller falls back
    //    to the built-in engine and shows the honest "built-in" banner.
    if (cost.isOverBudget()) {
      return {
        ok: false,
        error: {
          code: "budget_exceeded",
          message:
            "Daily live-AI call budget reached for this server. Showing built-in analysis; it resets tomorrow, or raise LLM_DAILY_CALL_BUDGET.",
        },
      };
    }

    try {
      if (data.json) {
        const res = await executeGeminiPrompt({ system: data.system, user: data.user, model });
        cost.recordCall(res.promptTokens, res.responseTokens);
        const result: BrainResult = {
          ok: true,
          text: res.raw,
          parsed: (res.parsed ?? null) as JsonValue | null,
          meta: {
            section: data.section,
            model: res.model,
            durationMs: res.durationMs,
            promptTokens: res.promptTokens,
            responseTokens: res.responseTokens,
            totalTokens: res.totalTokens,
          },
        };
        cost.setCached(key, result);
        return result;
      }
      const res = await executeGeminiText({ system: data.system, user: data.user, model });
      cost.recordCall(res.promptTokens, res.responseTokens);
      const result: BrainResult = {
        ok: true,
        text: res.text,
        parsed: null,
        meta: {
          section: data.section,
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

export const getBrainStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isGeminiConfigured } = await import("@/lib/ai/gemini.server");
  const { usageSnapshot, defaultModel } = await import("@/lib/ai/cost-control.server");
  return { connected: isGeminiConfigured(), model: defaultModel() ?? "Claude 3 Haiku (Bedrock)", usage: usageSnapshot() };
});

// On-demand live connectivity test. Actually calls Gemini and returns the real
// outcome so the user can diagnose "why is it using built-in analysis?" after
// deploy, instead of guessing. (Costs one tiny model call.)
export const pingBrain = createServerFn({ method: "POST" }).handler(async () => {
  const { pingGemini } = await import("@/lib/ai/gemini.server");
  return pingGemini();
});
