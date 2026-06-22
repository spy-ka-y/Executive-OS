// Risk-assessment agent (server function).
//
// Deterministic-first design: the trained RandomForest (ONNX) decides the risk
// TIER and confidence; Gemini only writes the narrative explaining WHY. The LLM
// never eyeballs the tier from raw numbers, and cannot override it. This is the
// reliable equivalent of registering predictRiskLevel as a function-calling tool
// — instead of hoping the model chooses to call it, we always call it first and
// hand the structured result to the narrator.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RiskMetricsInput = z.object({
  revenue: z.number(),
  profit: z.number(),
  profit_margin: z.number(),
  marketing_spend: z.number(),
  headcount: z.number(),
  customers: z.number(),
  customer_concentration_pct: z.number(),
  churn_pct: z.number(),
  forecast_accuracy: z.number(),
});

export interface AssessRiskResult {
  ok: boolean;
  riskLevel: "Critical" | "High" | "Low" | null;
  confidence: number; // 0..1
  probabilities?: Record<string, number>;
  narrative: string;
  model: string;
  narratedBy: "gemini" | "fallback" | "none";
  error?: { code: string; message: string };
}

function buildNarrationPrompt(
  m: z.infer<typeof RiskMetricsInput>,
  riskLevel: string,
  confidence: number,
) {
  const system = [
    "You are the Chief Risk Officer agent for ExecutiveOS.",
    "A trained classifier has ALREADY decided the risk tier from the data. That decision is FINAL.",
    "Your ONLY job is to explain WHY this tier is justified, in 2-3 sentences.",
    "STRICT RULES:",
    `- Do NOT state, imply, or argue for any tier other than "${riskLevel}".`,
    "- Ground the explanation in the actual drivers: customer concentration, profit margin, churn.",
    "- Do NOT invent numbers. Only reference the values provided.",
    "- Plain prose. No JSON, no markdown headers.",
  ].join("\n");

  const user = [
    `MODEL DECISION: Risk_Level = ${riskLevel} (model confidence ${(confidence * 100).toFixed(1)}%).`,
    "BUSINESS METRICS:",
    `- Customer concentration: ${m.customer_concentration_pct}%`,
    `- Profit margin: ${m.profit_margin}%`,
    `- Churn: ${m.churn_pct}%`,
    `- Revenue: ${m.revenue}, Profit: ${m.profit}, Customers: ${m.customers}`,
    "",
    `Explain why ${riskLevel} risk is the correct tier for this profile.`,
  ].join("\n");

  return { system, user };
}

// Transparent fallback narrative when Gemini is unavailable. The TIER still
// comes from the model — only the prose is templated here, and it says so.
function fallbackNarrative(m: z.infer<typeof RiskMetricsInput>, riskLevel: string): string {
  const drivers: string[] = [];
  if (m.customer_concentration_pct > 70) drivers.push(`customer concentration at ${m.customer_concentration_pct}% (severe)`);
  else if (m.customer_concentration_pct > 60) drivers.push(`elevated customer concentration at ${m.customer_concentration_pct}%`);
  if (m.profit_margin <= 0) drivers.push(`a negative/zero profit margin (${m.profit_margin}%)`);
  else if (m.profit_margin <= 5) drivers.push(`a thin profit margin (${m.profit_margin}%)`);
  if (m.churn_pct >= 8) drivers.push(`high churn (${m.churn_pct}%)`);
  const reason = drivers.length ? drivers.join(" and ") : "a stable concentration and margin profile";
  return `Model-assigned risk tier: ${riskLevel}, driven by ${reason}. (Narrative generated without the LLM — the tier is the model's.)`;
}

export const assessRiskLevel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RiskMetricsInput.parse(d))
  .handler(async ({ data }): Promise<AssessRiskResult> => {
    // 1) The MODEL decides the tier (deterministic) — runs regardless of Gemini.
    let riskLevel: AssessRiskResult["riskLevel"] = null;
    let confidence = 0;
    let probabilities: Record<string, number> | undefined;
    let modelName = "RandomForest(ONNX)";
    try {
      const { predictRiskLevel } = await import("@/lib/ml/predict-risk.server");
      const pred = await predictRiskLevel(data);
      riskLevel = pred.riskLevel;
      confidence = pred.confidence;
      probabilities = pred.probabilities;
      modelName = pred.model;
    } catch (e) {
      // Honest: if the model can't run, we do NOT fabricate a tier.
      return {
        ok: false,
        riskLevel: null,
        confidence: 0,
        narrative: "",
        model: modelName,
        narratedBy: "none",
        error: { code: "model_unavailable", message: e instanceof Error ? e.message : String(e) },
      };
    }

    // 2) Gemini narrates around the structured decision (the "why").
    const { executeGeminiText, isGeminiConfigured } = await import("@/lib/ai/gemini.server");
    if (!isGeminiConfigured()) {
      return {
        ok: true, riskLevel, confidence, probabilities,
        narrative: fallbackNarrative(data, riskLevel), model: modelName, narratedBy: "fallback",
      };
    }
    try {
      const { system, user } = buildNarrationPrompt(data, riskLevel, confidence);
      const res = await executeGeminiText({ system, user, model: "gemini-2.5-flash" });
      return {
        ok: true, riskLevel, confidence, probabilities,
        narrative: res.text.trim(), model: modelName, narratedBy: "gemini",
      };
    } catch {
      return {
        ok: true, riskLevel, confidence, probabilities,
        narrative: fallbackNarrative(data, riskLevel), model: modelName, narratedBy: "fallback",
      };
    }
  });
