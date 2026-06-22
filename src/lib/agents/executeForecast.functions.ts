// Forecasting agent (server function).
//
// Deterministic-first: the trained GradientBoostingRegressor (ONNX) produces the
// Revenue NUMBER and a calibrated confidence interval; Gemini only writes the
// commentary ("Q3 revenue is forecast at $X, driven mainly by Y"). The LLM never
// invents the number and cannot change it.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ForecastInput = z.object({
  date: z.string().min(4),
  region: z.string(),
  category: z.string(),
  business_unit: z.string(),
  marketing_spend: z.number(),
  customers: z.number(),
  churn_pct: z.number(),
});

export interface ForecastAgentResult {
  ok: boolean;
  predictedRevenue: number | null;
  confidenceInterval: { lower: number; upper: number; level: number } | null;
  commentary: string;
  model: string;
  narratedBy: "gemini" | "fallback" | "none";
  error?: { code: string; message: string };
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function buildCommentaryPrompt(
  inp: z.infer<typeof ForecastInput>,
  predicted: number,
  ci: { lower: number; upper: number; level: number },
) {
  const system = [
    "You are the Forecasting agent for ExecutiveOS.",
    "A trained regression model has ALREADY produced the revenue number and its 90% interval. Those figures are FINAL.",
    "Write 2-3 sentences of commentary around that number — what is driving it and how to read the interval.",
    "STRICT RULES:",
    "- Do NOT change, round differently, or contradict the model's number or interval.",
    "- Attribute drivers only to the provided inputs (category, marketing spend, customers, churn, season/time).",
    "- Do NOT invent any other numbers. Plain prose, no JSON.",
  ].join("\n");

  const user = [
    `MODEL FORECAST: ${money(predicted)} (90% interval ${money(ci.lower)}–${money(ci.upper)}) for period ${inp.date}.`,
    "DRIVERS / INPUTS:",
    `- Category: ${inp.category}, Region: ${inp.region}, Business Unit: ${inp.business_unit}`,
    `- Marketing spend: ${money(inp.marketing_spend)}, Customers: ${inp.customers}, Churn: ${inp.churn_pct}%`,
    "",
    "Write the executive commentary for this forecast.",
  ].join("\n");

  return { system, user };
}

function fallbackCommentary(
  inp: z.infer<typeof ForecastInput>,
  predicted: number,
  ci: { lower: number; upper: number },
): string {
  return (
    `Revenue for ${inp.date} is forecast at ${money(predicted)} ` +
    `(90% interval ${money(ci.lower)}–${money(ci.upper)}), driven by ${inp.category} demand, ` +
    `${money(inp.marketing_spend)} marketing spend and ${inp.customers} customers, net of ${inp.churn_pct}% churn. ` +
    `(Commentary generated without the LLM — the number is the model's.)`
  );
}

export const forecastAgent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ForecastInput.parse(d))
  .handler(async ({ data }): Promise<ForecastAgentResult> => {
    // 1) The MODEL produces the number (deterministic) — runs regardless of Gemini.
    let predictedRevenue: number;
    let confidenceInterval: ForecastAgentResult["confidenceInterval"];
    let modelName = "GradientBoostingRegressor(ONNX)";
    try {
      const { forecastRevenue } = await import("@/lib/ml/forecast-revenue.server");
      const res = await forecastRevenue(data);
      predictedRevenue = res.predictedRevenue;
      confidenceInterval = res.confidenceInterval;
      modelName = res.model;
    } catch (e) {
      return {
        ok: false, predictedRevenue: null, confidenceInterval: null, commentary: "",
        model: modelName, narratedBy: "none",
        error: { code: "model_unavailable", message: e instanceof Error ? e.message : String(e) },
      };
    }

    // 2) Gemini narrates around the number (the "why").
    const { executeGeminiText, isGeminiConfigured } = await import("@/lib/ai/gemini.server");
    if (!isGeminiConfigured()) {
      return {
        ok: true, predictedRevenue, confidenceInterval,
        commentary: fallbackCommentary(data, predictedRevenue, confidenceInterval),
        model: modelName, narratedBy: "fallback",
      };
    }
    try {
      const { system, user } = buildCommentaryPrompt(data, predictedRevenue, confidenceInterval);
      const res = await executeGeminiText({ system, user, model: "gemini-2.5-flash" });
      return { ok: true, predictedRevenue, confidenceInterval, commentary: res.text.trim(), model: modelName, narratedBy: "gemini" };
    } catch {
      return {
        ok: true, predictedRevenue, confidenceInterval,
        commentary: fallbackCommentary(data, predictedRevenue, confidenceInterval),
        model: modelName, narratedBy: "fallback",
      };
    }
  });
