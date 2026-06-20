// End-to-end "insight agent": decides the risk tier deterministically (by the
// documented threshold rule), refuses when core fields are missing, then has
// Gemini write the recommended initiative + narrative. Mirrors the
// deterministic-first pattern in executeRisk.functions.ts (rule decides the
// WHAT; the LLM only explains the WHY). Plain async — callable from the eval
// runner and the product without the server-function RPC layer.
import { executeGeminiPrompt } from "../ai/gemini.server";

export type RiskTier = "Critical" | "High" | "Low";

export interface InsightMetrics {
  region?: string | null;
  category?: string | null;
  revenue?: number | null;
  profit_margin?: number | null;
  customer_concentration_pct?: number | null;
  churn_pct?: number | null;
}

export interface InsightResult {
  riskLevel: RiskTier | null;
  initiative: string;
  narrative: string;
  insufficientData: boolean;
  missingFields: string[];
  tierSource: "rule" | "none";
  narratedBy: "gemini" | "fallback" | "none";
}

export interface NarrationInput {
  tier: RiskTier;
  metrics: InsightMetrics;
}
export interface NarrationOutput {
  initiative: string;
  narrative: string;
}
export type Narrator = (input: NarrationInput) => Promise<NarrationOutput>;

const REFUSAL_INITIATIVE = "N/A — request missing fields";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Which numeric fields are absent — used both to gate the tier and to write an
// honest refusal that names exactly what is missing.
function missingNumericFields(m: InsightMetrics): string[] {
  const fields: Array<keyof InsightMetrics> = [
    "revenue",
    "profit_margin",
    "customer_concentration_pct",
    "churn_pct",
  ];
  return fields.filter((f) => !isNum(m[f]));
}

// Deterministic tier from the documented threshold rule. Core fields are
// profit_margin AND customer_concentration_pct; if either is missing we refuse
// (tier = null) rather than guess.
export function decideTier(m: InsightMetrics): {
  tier: RiskTier | null;
  missingFields: string[];
} {
  const missingFields = missingNumericFields(m);
  if (!isNum(m.profit_margin) || !isNum(m.customer_concentration_pct)) {
    return { tier: null, missingFields };
  }
  const conc = m.customer_concentration_pct;
  const margin = m.profit_margin;
  let tier: RiskTier;
  if (conc > 70) tier = "Critical";
  else if (conc > 60) tier = "High";
  else if (margin <= 0) tier = "Critical";
  else if (margin <= 5) tier = "High";
  else tier = "Low";
  return { tier, missingFields };
}

// Templated initiative + narrative when Gemini is unavailable. The TIER is still
// the rule's; only the prose is templated, and it says so. No invented numbers
// beyond the inputs already provided.
export function fallbackNarration(tier: RiskTier, m: InsightMetrics): NarrationOutput {
  const conc = isNum(m.customer_concentration_pct) ? m.customer_concentration_pct : null;
  const margin = isNum(m.profit_margin) ? m.profit_margin : null;
  const concDriven = conc !== null && conc > 60;
  const marginDriven = margin !== null && margin <= 5;

  let initiative: string;
  if (tier === "Low") initiative = "Regional Expansion";
  else if (concDriven) initiative = "Customer Diversification";
  else if (marginDriven) initiative = "Margin Defense Program";
  else initiative = "Risk Mitigation Review";

  const drivers: string[] = [];
  if (concDriven) drivers.push(`customer concentration at ${conc}%`);
  if (marginDriven) drivers.push(`a profit margin of ${margin}%`);
  const reason = drivers.length ? drivers.join(" and ") : "the assessed metric profile";
  const narrative =
    `Rule-assigned risk tier: ${tier}, driven by ${reason}. Recommended initiative: ` +
    `${initiative}. (Narrative generated without the LLM — the tier is the rule's.)`;
  return { initiative, narrative };
}

function buildNarrationPrompt(tier: RiskTier, m: InsightMetrics) {
  const system = [
    "You are the Chief Strategy agent for ExecutiveOS.",
    `A deterministic rule has ALREADY assigned the risk tier: "${tier}". That decision is FINAL.`,
    "Your job: (1) recommend ONE initiative appropriate to this tier and its dominant driver,",
    "and (2) write a 2-3 sentence insight narrative explaining the assessment.",
    "STRICT RULES:",
    `- Do NOT state, imply, or argue for any tier other than "${tier}".`,
    "- Ground everything in the provided numbers. Do NOT invent any number not given.",
    "- For Low risk, recommend a growth/expansion move, NOT a defensive one.",
    "- For concentration-driven risk, prefer diversification; for margin-driven risk, prefer a margin program.",
    "- Return ONLY a JSON object: { \"initiative\": string, \"narrative\": string }. No markdown, no prose outside JSON.",
  ].join("\n");

  const provided: string[] = [];
  if (isNum(m.revenue)) provided.push(`- Revenue: ${m.revenue}`);
  if (isNum(m.profit_margin)) provided.push(`- Profit margin: ${m.profit_margin}%`);
  if (isNum(m.customer_concentration_pct)) provided.push(`- Customer concentration: ${m.customer_concentration_pct}%`);
  if (isNum(m.churn_pct)) provided.push(`- Churn: ${m.churn_pct}%`);
  if (m.region) provided.push(`- Region: ${m.region}`);
  if (m.category) provided.push(`- Category: ${m.category}`);

  const user = [
    `ASSIGNED TIER: ${tier}.`,
    "PROVIDED METRICS (the ONLY numbers you may cite):",
    ...provided,
    "",
    "Return the initiative and narrative as JSON.",
  ].join("\n");

  return { system, user };
}

// Real narrator: Gemini writes the initiative + narrative around the locked tier.
// Throws on any failure so runInsightPipeline can fall back transparently.
export const geminiNarrator: Narrator = async ({ tier, metrics }) => {
  const { system, user } = buildNarrationPrompt(tier, metrics);
  const res = await executeGeminiPrompt({ system, user, model: "gemini-2.5-flash" });
  const p = res.parsed as { initiative?: unknown; narrative?: unknown };
  const initiative = typeof p?.initiative === "string" ? p.initiative.trim() : "";
  const narrative = typeof p?.narrative === "string" ? p.narrative.trim() : "";
  if (!initiative || !narrative) {
    throw new Error("Gemini narrator returned an incomplete object.");
  }
  return { initiative, narrative };
};

export async function runInsightPipeline(
  m: InsightMetrics,
  narrate: Narrator = geminiNarrator,
): Promise<InsightResult> {
  const { tier, missingFields } = decideTier(m);

  if (tier === null) {
    const fieldList = missingFields.join(", ");
    return {
      riskLevel: null,
      initiative: REFUSAL_INITIATIVE,
      narrative:
        `Core financial fields are missing (${fieldList}). I cannot assign a risk tier ` +
        `without them and will not guess. Please provide the missing fields to proceed.`,
      insufficientData: true,
      missingFields,
      tierSource: "none",
      narratedBy: "none",
    };
  }

  try {
    const { initiative, narrative } = await narrate({ tier, metrics: m });
    return {
      riskLevel: tier,
      initiative,
      narrative,
      insufficientData: false,
      missingFields,
      tierSource: "rule",
      narratedBy: "gemini",
    };
  } catch {
    const fb = fallbackNarration(tier, m);
    return {
      riskLevel: tier,
      initiative: fb.initiative,
      narrative: fb.narrative,
      insufficientData: false,
      missingFields,
      tierSource: "rule",
      narratedBy: "fallback",
    };
  }
}
