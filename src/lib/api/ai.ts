// AI service layer. v1 = local heuristic stubs that produce realistic structured
// output from real KPI data. Future: swap to FastAPI multi-agent orchestrator
// by setting VITE_AI_BACKEND=fastapi and VITE_FASTAPI_URL.
//
// Each function below corresponds to one future endpoint. Keep the response
// shapes stable — they are the contract.
import type {
  CeoBrief,
  ChatMessage,
  ConsultantReport,
  ConsultantInvestmentThesis,
  CopilotAgent,
  KpiSummary,
  DatasetColumn,
  DatasetRow,
  GenerationMeta,
} from "./types";
import { computeBusinessIntelligence, formatMoney as fmtMoney, formatPct as fmtPct, type BusinessIntelligence } from "./intelligence";
import { revenueUpsideBand, shockExposure } from "./estimates";
import { getIndustryProfile, marginVerdict, type IndustryId } from "./industry";
import { z } from "zod";
import { callBrain, buildChatPrompt, buildCeoBriefPrompt, buildConsultantPrompt, type BrainResult } from "@/lib/ai/brain";
import { validateChatScope, renderInvalidated } from "@/lib/agents/brains/chat-brain";

// Map a failed/invalid brain result to the reason we show the user, so a
// built-in fallback is always labeled with WHY the live AI was not used.
function fallbackMeta(res: BrainResult | null): GenerationMeta {
  if (!res || res.ok) return { source: "builtin", reason: "unavailable" };
  switch (res.error.code) {
    case "rate_limit":
      return { source: "builtin", reason: "rate_limit" };
    case "missing_key":
      return { source: "builtin", reason: "missing_key" };
    case "budget_exceeded":
      return { source: "builtin", reason: "budget" };
    case "invalid_json":
    case "schema_invalid":
      return { source: "builtin", reason: "schema_invalid" };
    default:
      return { source: "builtin", reason: "unavailable" };
  }
}

const BACKEND = (import.meta.env.VITE_AI_BACKEND as string | undefined) ?? "local";
const FASTAPI_URL = (import.meta.env.VITE_FASTAPI_URL as string | undefined) ?? "";

// ── AI-brain response validators (lenient; on mismatch we fall back to the
//    built-in heuristic so the UI never breaks) ──────────────────────────────
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const CeoBriefAiSchema = z.object({
  summary: z.string().min(1),
  health_score: z.number(),
  risks: z.array(z.object({ title: z.string().min(1), description: z.string().min(1), severity: z.enum(["low", "med", "high"]) })).min(1),
  opportunities: z.array(z.object({ title: z.string().min(1), description: z.string().min(1), upside: z.string() })).min(1),
  priorities: z.array(z.object({ title: z.string().min(1), owner: z.string(), due: z.string() })).min(1),
  forecast_highlights: z.array(z.object({ label: z.string().min(1), value: z.string() })).min(1),
});

const ConsultantAiSchema = z.object({
  problems: z.array(z.object({
    title: z.string().min(1), description: z.string().min(1), evidence: z.string(),
    severity: z.enum(["low", "med", "high"]), financial_exposure: z.string(), strategic_recommendation: z.string(),
    category: z.enum(["concentration", "category", "region", "margin", "customer", "growth", "forecast"]).optional(),
  })).min(1),
  recommendations: z.array(z.object({
    title: z.string().min(1), description: z.string().min(1), impact: z.number(), effort: z.number(),
    timeframe: z.string(), expected_revenue_impact: z.string(), confidence: z.number(), owner: z.string(),
    strategic_risk: z.number().optional(),
  })).min(1),
  impact_score: z.number(), roi_score: z.number(), risk_score: z.number(),
  investment_thesis: z.object({
    revenue_upside: z.string(), margin_improvement: z.string(), risk_reduction: z.string(),
    verdict: z.string(), posture: z.enum(["Accelerate", "Optimize", "Stabilize", "Defend"]),
  }).nullable().optional(),
});

async function callFastApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${FASTAPI_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FastAPI ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}


function id() {
  return crypto.randomUUID();
}

// --- Agent routing ---------------------------------------------------------
function routeAgent(question: string): CopilotAgent {
  const q = question.toLowerCase();
  if (/(boardroom|board\s*meeting|cfo|cmo|coo|cro|cxo|perspective|debate)/.test(q)) return "Boardroom Agent";
  if (/(forecast|predict|projection|next\s*(month|quarter|year)|trajectory|trend)/.test(q)) return "Forecast Agent";
  if (/(scenario|simulate|trade.?off|what.?if|decision|stress\s*test|pricing change|headcount)/.test(q)) return "Decision Agent";
  if (/(recommend|strategy|strategic|growth opportunit|invest|action|prioriti|playbook|do next|next quarter|consult)/.test(q)) return "Consultant Agent";
  return "CEO Agent";
}

// --- AI Chat — Executive Copilot ------------------------------------------
export async function chat(params: {
  dataset_id: string | null;
  kpis: KpiSummary | null;
  rows?: DatasetRow[];
  schema?: DatasetColumn[];
  history: ChatMessage[];
  question: string;
  industry?: IndustryId;
}): Promise<ChatMessage> {
  // Scope gate (chat brain): off-theme questions are rejected with a structured
  // invalidated response — no model call, so it works even when quota is out.
  const scope = validateChatScope(params.question);
  if (!scope.valid) {
    return { id: id(), role: "assistant", content: renderInvalidated(scope), created_at: new Date().toISOString() };
  }

  if (BACKEND === "fastapi") return callFastApi("/chat", params);

  const agent = routeAgent(params.question);
  const q = params.question.toLowerCase();
  const hasData = !!(params.kpis && params.rows && params.schema && params.rows.length);
  const intel = hasData
    ? computeBusinessIntelligence(params.rows!, params.schema!, params.kpis)
    : null;

  // AI brain first — real, context-aware answer grounded in the dataset.
  let brainNote = "";
  if (params.question.trim()) {
    const { system, user } = buildChatPrompt({ question: params.question, intel, kpis: params.kpis, history: params.history, profile: getIndustryProfile(params.industry) });
    const res = await callBrain({ section: "chat", system, user, json: false });
    if (res.ok && res.text.trim()) {
      return { id: id(), role: "assistant", content: res.text.trim(), created_at: new Date().toISOString(), agent };
    }
    // AI unavailable — record WHY so the fallback is never mistaken for a real
    // AI answer (this is what made replies look "hardcoded").
    if (!res.ok) {
      brainNote =
        res.error.code === "rate_limit"
          ? "> ⚠️ _Live AI is rate-limited, the AWS Bedrock request quota for this account is exhausted (try again shortly, or request a quota increase). Showing built-in analysis until it recovers._\n\n"
          : res.error.code === "missing_key"
            ? "> ⚠️ _Live AI isn't configured, AWS Bedrock credentials are missing or model access isn't enabled on the server. Showing built-in analysis._\n\n"
            : res.error.code === "budget_exceeded"
              ? "> ⚠️ _The daily live-AI call budget for this server is spent (resets tomorrow). Showing built-in analysis._\n\n"
              : "> ⚠️ _Live AI is temporarily unavailable. Showing built-in analysis._\n\n";
    }
  }

  // Fallback — built-in heuristic reasoning (used if the AI brain is
  // unavailable so the Copilot always responds).
  let content: string;
  if (!intel) {
    content = "Upload a dataset on the Dashboard so I can ground my reasoning in your numbers. I work best with revenue, profit, region, category, and time-series columns.";
  } else if (/(boardroom|board summary|cfo.+cmo|all.?hands)/.test(q)) {
    content = boardroomSummary(intel, params.question);
  } else if (/(what should i do|next quarter|do next|priority|strategic recommendation|recommend.* (next|action))/.test(q)) {
    content = strategicRecommendation(intel);
  } else {
    content = oirAnswer(intel, params.question, agent);
  }

  return {
    id: id(),
    role: "assistant",
    content: brainNote + content,
    created_at: new Date().toISOString(),
    agent,
  };
}

function section(label: string, body: string) {
  return `**${label}:**\n${body}`;
}

function oirAnswer(intel: BusinessIntelligence, question: string, agent: CopilotAgent): string {
  const q = question.toLowerCase();
  const r = intel.bestRegion;
  const c = intel.bestCategory;
  const w = intel.worstRegion;
  const wc = intel.worstCategory;

  let observation = "";
  let insight = "";
  let recommendation = "";
  let outcome = "";

  if (/(region|geograph|market|territory)/.test(q) && r) {
    observation = `${r.name} leads with ${fmtMoney(r.total)} (${fmtPct(r.share * 100)} of total ${intel.metricName.toLowerCase()}).${w ? ` ${w.name} trails at ${fmtMoney(w.total)}.` : ""}`;
    insight = `Demand strength in ${r.name} indicates product-market fit and a repeatable go-to-market motion.${w ? ` ${w.name}'s underperformance suggests either coverage gaps or weak channel economics.` : ""}`;
    recommendation = `Reallocate marketing and sales coverage toward ${r.name}${c ? `, especially for ${c.name}` : ""}. Defer expansion investment in ${w?.name ?? "weaker regions"} until unit economics improve.`;
    outcome = `Concentrating spend in proven geography typically yields a 6–12% revenue lift within two quarters.`;
  } else if (/(category|product|segment|sku|line|invest|allocat)/.test(q) && c) {
    observation = `${c.name} contributes ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} at ${fmtPct(c.margin ?? 0)} margin.${wc && wc !== c ? ` ${wc.name} contributes only ${fmtPct((wc.share) * 100)}.` : ""}`;
    insight = `${c.name} is the structural growth engine. ${wc && wc !== c && (wc.margin ?? 0) < (c.margin ?? 0) ? `${wc.name} dilutes blended margin and consumes management attention disproportionate to its contribution.` : "Investment dollars in this category compound fastest."}`;
    recommendation = `Increase inventory, marketing, and product investment in ${c.name}. ${wc && wc !== c ? `Run a profitability turnaround for ${wc.name} within 60 days or rationalize.` : "Maintain disciplined capital allocation across the rest of the portfolio."}`;
    outcome = `Margin expansion of 100–200 bps and revenue lift of 5–10% within two quarters.`;
  } else if (/(risk|exposure|concentration)/.test(q)) {
    const risks: string[] = [];
    if (intel.categoryConcentrationPct >= 40) risks.push(`Category concentration: ${c?.name} = ${fmtPct(intel.categoryConcentrationPct)} of revenue.`);
    if (intel.customerConcentrationPct >= 35) risks.push(`Customer concentration: top 5 buyers = ${fmtPct(intel.customerConcentrationPct)} of revenue.`);
    if (intel.marginPct < 12) risks.push(`Margin thin at ${fmtPct(intel.marginPct)} — limited absorption for cost shocks.`);
    if (intel.trendConsistency < 55) risks.push(`Revenue volatility high (consistency ${intel.trendConsistency}/100).`);
    if (intel.growthPct < 0) risks.push(`Growth negative at ${fmtPct(intel.growthPct)} — trajectory risk.`);
    observation = risks.length ? risks.join(" ") : "No critical risks detected at the current data granularity.";
    insight = risks.length ? "These exposures compound: a single category or customer loss cascades into margin and forecast confidence." : "The portfolio is structurally balanced — focus risk monitoring on macro shocks.";
    recommendation = risks.length ? `Diversify revenue base: build a second growth engine outside ${c?.name ?? "the top category"}, tier customer accounts, and run a quarterly stress test.` : "Maintain current diversification and review quarterly.";
    outcome = `Concentration reduced to <30% within 3–4 quarters; forecast confidence improves by ~15 points.`;
  } else if (/(forecast|predict|trajectory|next)/.test(q)) {
    observation = `Trend is ${intel.trendDirection} at ${fmtPct(intel.growthPct)} half-over-half, with ${intel.trendConsistency}/100 consistency.`;
    insight = `${intel.trendDirection === "up" ? "Growth is durable — momentum supports a bolder posture." : intel.trendDirection === "down" ? "Trajectory has inflected negatively — defensive measures are warranted." : "Plateau detected — current playbook has reached natural ceiling."}`;
    recommendation = `${intel.trendDirection === "up" ? `Press the advantage: lean into ${c?.name ?? "top category"} in ${r?.name ?? "leading region"} and refresh the forecast monthly.` : intel.trendDirection === "down" ? `Stabilize first: protect margin, freeze discretionary spend, and rebuild pipeline before reinvesting.` : `Pilot one new lever (pricing, channel, or product) and measure 30-day uplift.`}`;
    outcome = `Forward revenue range projects upside of ${fmtPct(intel.forecastUpsidePct)} over the next equivalent period if recommended actions execute on plan.`;
  } else if (/(losing money|loss|leak|underperform|weak)/.test(q)) {
    observation = `${wc ? `${wc.name} runs at ${fmtPct(wc.margin ?? 0)} margin` : "Margin pressure is broad-based"}${w ? `; ${w.name} region trails at ${fmtMoney(w.total)}` : ""}.`;
    insight = `Capital is leaking into low-yield segments. Each dollar spent there crowds out investment in ${c?.name ?? "the top category"}.`;
    recommendation = `Set a 60-day profitability gate for ${wc?.name ?? "underperforming segments"}. If margin does not cross ${fmtPct(Math.max(8, (intel.marginPct) * 0.6))}, sunset or restructure.`;
    outcome = `Expected margin recovery of 80–180 bps and freed-up capital for high-ROI reinvestment.`;
  } else if (/(revenue|grow|increase|sales)/.test(q)) {
    observation = `Revenue ${fmtMoney(intel.totalRevenue)} at ${fmtPct(intel.growthPct)} growth. ${r ? `${r.name} drives ${fmtPct(intel.regionConcentrationPct)} of it.` : ""}`;
    insight = `Growth is concentrated in ${c?.name ?? "the leading category"}${r ? ` and ${r.name}` : ""}. The fastest path to incremental revenue is depth, not breadth.`;
    recommendation = `Triple down on ${c?.name ?? "top category"} in ${r?.name ?? "leading region"}; add an adjacent SKU or upsell motion to existing buyers before pursuing new segments.`;
    outcome = `Revenue lift of 8–14% within two quarters with marginal sales & marketing cost increase.`;
  } else if (/(summar|overview|brief|executive)/.test(q)) {
    return executiveSummary(intel);
  } else {
    observation = intel.highlights.slice(0, 2).join(" ");
    insight = `The dataset's structural story is ${c?.name ? `${c.name} dominance` : "broad category mix"}${r ? ` anchored in ${r.name}` : ""}, with ${intel.trendDirection} momentum.`;
    recommendation = `Focus the next quarter on ${c?.name ?? "the top category"}${r ? ` × ${r.name}` : ""}: align marketing, inventory, and sales coverage behind that wedge.`;
    outcome = `Tighter execution typically yields a 6–10% revenue lift and 80–150 bps margin improvement.`;
  }

  return [
    section("Observation", observation),
    section("Insight", insight),
    section("Recommendation", recommendation),
    section("Expected Outcome", outcome),
    `\n_— ${agent}_`,
  ].join("\n\n");
}

function executiveSummary(intel: BusinessIntelligence): string {
  const r = intel.bestRegion, c = intel.bestCategory;
  return [
    `**Executive Snapshot:** Revenue ${fmtMoney(intel.totalRevenue)} · Profit ${fmtMoney(intel.totalProfit)} · Margin ${fmtPct(intel.marginPct)} · Growth ${fmtPct(intel.growthPct)}.`,
    `**Where value lives:** ${c ? `${c.name} (${fmtPct(intel.categoryConcentrationPct)} of revenue)` : "Portfolio is diversified across categories"}${r ? `, anchored in ${r.name}` : ""}.`,
    `**Watch-outs:** ${intel.categoryConcentrationPct >= 40 ? `Category concentration risk in ${c?.name}.` : ""} ${intel.customerConcentrationPct >= 35 ? `Top-5 customer dependency at ${fmtPct(intel.customerConcentrationPct)}.` : ""} ${intel.marginPct < 12 ? "Thin margin — limited shock absorption." : ""}`.trim(),
    `**Next quarter posture:** ${intel.trendDirection === "up" ? `Press the advantage in ${c?.name ?? "the top category"} × ${r?.name ?? "leading region"}.` : intel.trendDirection === "down" ? "Stabilize margin, protect cash, and rebuild pipeline." : "Pilot one new growth lever and measure 30-day uplift."}`,
    `\n_— CEO Agent_`,
  ].join("\n\n");
}

function strategicRecommendation(intel: BusinessIntelligence): string {
  const r = intel.bestRegion, c = intel.bestCategory;
  const confidence = Math.min(95, Math.max(45, Math.round(50 + intel.trendConsistency * 0.4 + (c ? 10 : 0))));
  const riskLevel = intel.categoryConcentrationPct >= 50 || intel.marginPct < 10 ? "High" : intel.categoryConcentrationPct >= 35 ? "Medium" : "Low";
  return [
    `**Top Priority:** Scale ${c?.name ?? "the top category"}${r ? ` in ${r.name}` : ""}.`,
    `**Reason:** ${c ? `${c.name} already delivers ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} at ${fmtPct(c.margin ?? 0)} margin — strongest unit economics in the portfolio.` : `Structural strength concentrated in this segment.`} Trend is ${intel.trendDirection} at ${fmtPct(intel.growthPct)}.`,
    `**Expected Impact:** ${(() => { const b = revenueUpsideBand(intel, intel.totalRevenue); return b.computable ? `Revenue ${b.display} over the next equivalent period (based on your realized growth).` : "Revenue upside is qualitative here — add a date column so I can quantify it from your trend."; })()}`,
    `**Risk Level:** ${riskLevel} — execution risk dominated by ${intel.categoryConcentrationPct >= 40 ? "increasing concentration" : "macro demand variability"}.`,
    `**Confidence Score:** ${confidence}/100.`,
    `\n_— Consultant Agent_`,
  ].join("\n\n");
}

function boardroomSummary(intel: BusinessIntelligence, topic: string): string {
  const r = intel.bestRegion, c = intel.bestCategory;
  return [
    `**Topic:** ${topic}`,
    `**CEO Perspective:** The business is ${intel.trendDirection === "up" ? "growing" : intel.trendDirection === "down" ? "contracting" : "plateaued"} at ${fmtPct(intel.growthPct)}. Our highest-conviction move is doubling down on ${c?.name ?? "the top category"}${r ? ` in ${r.name}` : ""} — that's where the compounding lives.`,
    `**CFO Perspective:** Margin sits at ${fmtPct(intel.marginPct)} on ${fmtMoney(intel.totalRevenue)} revenue. Any reallocation must preserve margin; I want a defensible 12-month payback on incremental spend.`,
    `**COO Perspective:** ${c ? `${c.name} concentration is ${fmtPct(intel.categoryConcentrationPct)} — operationally we can absorb 20–30% more volume without capacity expansion.` : "Operations have headroom; focus is the bottleneck, not capacity."} Sequencing matters more than scope.`,
    `**CMO Perspective:** Demand signal is strongest in ${r?.name ?? "our leading market"}. A 20% reweighting of upper-funnel investment toward ${c?.name ?? "the top category"} would compound the existing trajectory.`,
    `**Final Recommendation:** Approve a focused 90-day plan to scale ${c?.name ?? "top category"} in ${r?.name ?? "leading region"} with capped opex increase, ring-fenced margin guardrails, and a monthly forecast refresh.`,
    `\n_— Boardroom Agent_`,
  ].join("\n\n");
}

// --- CEO Brief — dataset-specific ------------------------------------------
export async function generateCeoBrief(params: {
  dataset_id: string;
  kpis: KpiSummary;
  rows?: DatasetRow[];
  schema?: DatasetColumn[];
  industry?: IndustryId;
}): Promise<Omit<CeoBrief, "id" | "created_at">> {
  if (BACKEND === "fastapi") return callFastApi("/ceo-brief", params);

  const m = params.kpis.metrics;
  const get = (k: string) => m.find((x) => x.key === k);
  const rev = get("revenue")?.value ?? 0;
  const profit = get("profit")?.value ?? 0;
  const margin = get("margin")?.value ?? 0;
  const growth = get("growth")?.value ?? 0;

  const intel: BusinessIntelligence | null =
    params.rows && params.schema ? computeBusinessIntelligence(params.rows, params.schema, params.kpis) : null;

  // AI brain first — fall back to the heuristic below if it is unavailable or
  // returns a malformed payload.
  let brainRes: BrainResult | null = null;
  {
    const { system, user } = buildCeoBriefPrompt(intel, params.kpis, getIndustryProfile(params.industry));
    brainRes = await callBrain({ section: "ceo-brief", system, user, json: true });
    if (brainRes.ok && brainRes.parsed) {
      const parsed = CeoBriefAiSchema.safeParse(brainRes.parsed);
      if (parsed.success) {
        return {
          dataset_id: params.dataset_id,
          summary: parsed.data.summary,
          risks: parsed.data.risks.slice(0, 5),
          opportunities: parsed.data.opportunities.slice(0, 4),
          priorities: parsed.data.priorities.slice(0, 5),
          forecast_highlights: parsed.data.forecast_highlights.slice(0, 4),
          health_score: clamp(parsed.data.health_score),
          meta: { source: "ai" },
        };
      }
    }
  }

  const consistency = intel?.trendConsistency ?? 60;
  const anomalyPenalty = Math.min(15, params.kpis.anomalies.length * 4);
  const health = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        35 + margin * 0.5 + Math.min(35, growth * 2.2) + consistency * 0.15 - anomalyPenalty,
      ),
    ),
  );

  const profile = getIndustryProfile(params.industry);
  const healthFactors: string[] = [];
  const mv = marginVerdict(margin, profile);
  if (mv === "healthy") healthFactors.push(`healthy ${fmtPct(margin)} profit margin for a ${profile.label.toLowerCase()}`);
  else if (mv === "moderate") healthFactors.push(`moderate ${fmtPct(margin)} margin for a ${profile.label.toLowerCase()}`);
  else healthFactors.push(`thin ${fmtPct(margin)} margin for a ${profile.label.toLowerCase()}`);
  if (growth >= 5) healthFactors.push(`strong ${fmtPct(growth)} revenue growth`);
  else if (growth >= 0) healthFactors.push(`flat ${fmtPct(growth)} growth`);
  else healthFactors.push(`negative ${fmtPct(growth)} growth`);
  if (consistency >= 70) healthFactors.push(`stable trend (${consistency}/100 consistency)`);
  else if (consistency >= 50) healthFactors.push(`moderate volatility (${consistency}/100)`);
  else healthFactors.push(`high volatility (${consistency}/100)`);
  if (params.kpis.anomalies.length === 0) healthFactors.push("no critical anomalies");
  else healthFactors.push(`${params.kpis.anomalies.length} flagged anomalies`);
  const healthExplanation = `Score driven by ${healthFactors.join(", ")}.`;

  // Dataset-specific narrative
  let summary: string;
  if (intel) {
    const c = intel.bestCategory;
    const r = intel.bestRegion;
    const w = intel.worstCategory;
    const parts: string[] = [];
    parts.push(`Revenue closed at ${fmtMoney(rev)} with ${fmtMoney(profit)} profit (${fmtPct(margin)} margin) and a ${growth >= 0 ? "positive" : "negative"} ${fmtPct(growth)} half-over-half trajectory.`);
    if (c && r) parts.push(`${c.name} is the structural growth engine, contributing ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()}, while ${r.name} leads regional performance at ${fmtMoney(r.total)} (${fmtPct(intel.regionConcentrationPct)} of total).`);
    else if (c) parts.push(`${c.name} dominates the portfolio at ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()}.`);
    else if (r) parts.push(`${r.name} carries the business with ${fmtMoney(r.total)} in ${intel.metricName.toLowerCase()}.`);
    if (w && c && w !== c) parts.push(`${w.name} is the weakest segment at ${fmtPct(w.share * 100)} share and ${fmtPct(w.margin ?? 0)} margin — a likely drag on blended profitability.`);
    parts.push(`Strategic posture: ${growth >= 5 ? `press the advantage in ${c?.name ?? "the top segment"}` : growth >= 0 ? "harvest strength and reinvest selectively" : "stabilize margin and rebuild pipeline before reinvesting"}.`);
    parts.push(healthExplanation);
    summary = parts.join(" ");
  } else {
    summary = `Revenue ${fmtMoney(rev)} · Profit ${fmtMoney(profit)} at ${fmtPct(margin)} margin · Growth ${fmtPct(growth)}. ${healthExplanation}`;
  }

  // Risks
  const risks: Omit<CeoBrief, "id" | "created_at">["risks"] = [];
  if (intel?.bestCategory && intel.categoryConcentrationPct >= 35) {
    risks.push({
      title: `${intel.bestCategory.name} concentration risk`,
      description: `${intel.bestCategory.name} represents ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()}. A demand shock to this category would directly hit ${fmtMoney(intel.bestCategory.total)} in revenue.`,
      severity: intel.categoryConcentrationPct >= 55 ? "high" : "med",
    });
  }
  if (intel && intel.customerConcentrationPct >= 35) {
    risks.push({
      title: "Customer concentration risk",
      description: `Top 5 customers contribute ${fmtPct(intel.customerConcentrationPct)} of revenue — loss of one materially impacts forecast.`,
      severity: intel.customerConcentrationPct >= 50 ? "high" : "med",
    });
  }
  risks.push({
    title: "Margin deterioration risk",
    description: `Current margin is ${fmtPct(margin)}. Scenario: a 200 bps compression would erase ${fmtMoney(rev * 0.02)} of profit (2% of ${fmtMoney(rev)} revenue) — limited absorption capacity for input cost shocks.`,
    severity: margin < 10 ? "high" : margin < 20 ? "med" : "low",
  });
  if (intel?.worstRegion && intel.bestRegion && intel.worstRegion !== intel.bestRegion) {
    risks.push({
      title: `${intel.worstRegion.name} underperformance`,
      description: `${intel.worstRegion.name} delivers only ${fmtMoney(intel.worstRegion.total)} (${fmtPct(intel.worstRegion.share * 100)}) versus ${intel.bestRegion.name}'s ${fmtMoney(intel.bestRegion.total)}. Coverage or product-market fit gap.`,
      severity: "med",
    });
  }
  if (params.kpis.anomalies.length > 0) {
    const a = params.kpis.anomalies[0];
    risks.push({
      title: "Forecast uncertainty",
      description: `${params.kpis.anomalies.length} statistical anomalies in the series (largest: ${a.label} at ${fmtMoney(a.value)}). Forecast confidence degrades beyond 4 periods.`,
      severity: "low",
    });
  }

  // Opportunities
  const opps: Omit<CeoBrief, "id" | "created_at">["opportunities"] = [];
  if (intel && intel.bestCategory && intel.bestRegion) {
    const band = revenueUpsideBand(intel, intel.bestCategory.total);
    opps.push({
      title: `Expand ${intel.bestCategory.name} in ${intel.bestRegion.name}`,
      description: `${intel.bestCategory.name} already proves product-market fit; ${intel.bestRegion.name} demonstrates channel strength. Doubling down on this intersection is the highest-confidence growth move.`,
      upside: band.computable ? `${band.display} revenue` : "Add a date column to quantify",
    });
  } else if (intel && intel.bestCategory) {
    const band = revenueUpsideBand(intel, intel.bestCategory.total);
    opps.push({
      title: `Scale ${intel.bestCategory.name} investment`,
      description: `${intel.bestCategory.name} contributes ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} — incremental marketing dollars compound fastest here.`,
      upside: band.computable ? `${band.display} revenue` : "Add a date column to quantify",
    });
  }
  if (intel?.worstCategory && intel.bestCategory && intel.worstCategory !== intel.bestCategory && (intel.worstCategory.margin ?? 0) < (intel.bestCategory.margin ?? 0)) {
    // Data-derived: closing the actual margin gap on the laggard's actual share.
    const gap = (intel.bestCategory.margin ?? 0) - (intel.worstCategory.margin ?? 0);
    const blendedUpliftPts = gap * intel.worstCategory.share;
    opps.push({
      title: `Improve ${intel.worstCategory.name} profitability`,
      description: `${intel.worstCategory.name} runs at ${fmtPct(intel.worstCategory.margin ?? 0)} margin vs ${fmtPct(intel.bestCategory.margin ?? 0)} for ${intel.bestCategory.name}. Restructure pricing, mix, or cost base.`,
      upside: `up to +${fmtPct(blendedUpliftPts)} blended margin`,
    });
  }
  if (intel?.marketingRoi !== null && intel?.marketingRoi !== undefined && intel.marketingRoi < 5 && intel.bestCategory) {
    opps.push({
      title: "Reallocate marketing to highest-ROI category",
      description: `Blended marketing ROI is ${intel.marketingRoi.toFixed(2)}x. Concentrating spend on ${intel.bestCategory.name} should lift efficiency materially.`,
      upside: "Higher marketing efficiency",
    });
  }
  if (growth >= 0) {
    opps.push({
      title: "Cross-sell to existing customers",
      description: `${intel?.bestCategory ? `Customers buying ${intel.bestCategory.name} are natural targets for adjacent SKUs.` : "Existing buyer base under-monetized on adjacencies."} Lower CAC than net-new acquisition.`,
      upside: "Lower-CAC expansion revenue",
    });
  }
  if (opps.length === 0) {
    opps.push({
      title: "Stabilize and reset",
      description: "Negative growth requires a focus on retention and unit economics before reinvestment.",
      upside: "Margin protection",
    });
  }

  // Priority actions
  const priorities: Omit<CeoBrief, "id" | "created_at">["priorities"] = [];
  if (intel?.bestCategory && intel.bestRegion) {
    priorities.push({ title: `Increase ${intel.bestCategory.name} inventory & sales coverage in ${intel.bestRegion.name}`, owner: "COO", due: "30d" });
    priorities.push({ title: `Reweight marketing budget toward ${intel.bestRegion.name} × ${intel.bestCategory.name}`, owner: "CMO", due: "21d" });
  } else if (intel?.bestCategory) {
    priorities.push({ title: `Scale investment in ${intel.bestCategory.name}`, owner: "CRO", due: "30d" });
  }
  if (intel?.worstCategory && intel.bestCategory && intel.worstCategory !== intel.bestCategory) {
    priorities.push({ title: `Profitability turnaround for ${intel.worstCategory.name} (60-day gate)`, owner: "CFO", due: "60d" });
  }
  if (intel && intel.categoryConcentrationPct >= 45) {
    priorities.push({ title: "Build second growth engine to reduce category concentration", owner: "CEO", due: "90d" });
  }
  priorities.push({ title: "Refresh rolling forecast and stress-test downside", owner: "CFO", due: "14d" });
  if (priorities.length < 4) priorities.push({ title: "Quarterly board operating review", owner: "CEO", due: "30d" });

  // Forecast highlights — use the real OLS forecast with its prediction interval
  // and backtested error when we have a usable series; otherwise stay qualitative.
  const forecast_highlights: { label: string; value: string }[] = [];
  if (intel?.forecast && intel.forecast.points.length) {
    const p = intel.forecast.points[0];
    forecast_highlights.push({ label: "Next-period revenue (modeled)", value: fmtMoney(p.value) });
    forecast_highlights.push({ label: "95% prediction range", value: `${fmtMoney(p.lower)} to ${fmtMoney(p.upper)}` });
    forecast_highlights.push({
      label: "Forecast accuracy (backtest)",
      value: intel.forecast.backtestMape != null ? `±${intel.forecast.backtestMape}% MAPE` : "not enough history",
    });
    forecast_highlights.push({ label: "Trend fit", value: `${intel.trend.strength} (R² ${intel.trend.r2.toFixed(2)})` });
  } else {
    forecast_highlights.push({ label: "Next-period revenue (mid)", value: fmtMoney(rev * (1 + growth / 100 / 2)) });
    forecast_highlights.push({ label: "Trend consistency", value: `${consistency}/100` });
    forecast_highlights.push({ label: "Forecast", value: "Add a date column for a modeled forecast" });
  }

  return {
    dataset_id: params.dataset_id,
    summary,
    risks: risks.slice(0, 5),
    opportunities: opps.slice(0, 4),
    priorities: priorities.slice(0, 5),
    forecast_highlights,
    health_score: health,
    meta: fallbackMeta(brainRes),
  };
}


// --- Consultant Report — dataset-specific strategic findings --------------
export async function generateConsultantReport(params: {
  dataset_id: string;
  kpis: KpiSummary;
  rows?: DatasetRow[];
  schema?: DatasetColumn[];
  industry?: IndustryId;
}): Promise<Omit<ConsultantReport, "id" | "created_at">> {
  if (BACKEND === "fastapi") return callFastApi("/consultant", params);

  const m = params.kpis.metrics;
  const rev = m.find((x) => x.key === "revenue")?.value ?? 0;
  const profit = m.find((x) => x.key === "profit")?.value ?? 0;
  const margin = m.find((x) => x.key === "margin")?.value ?? 0;
  const growth = m.find((x) => x.key === "growth")?.value ?? 0;

  const intel: BusinessIntelligence | null =
    params.rows && params.schema && params.rows.length
      ? computeBusinessIntelligence(params.rows, params.schema, params.kpis)
      : null;

  // AI brain first — fall back to the heuristic findings below on any failure.
  let brainRes: BrainResult | null = null;
  {
    const { system, user } = buildConsultantPrompt(intel, params.kpis, getIndustryProfile(params.industry));
    brainRes = await callBrain({ section: "consultant", system, user, json: true });
    if (brainRes.ok && brainRes.parsed) {
      const parsed = ConsultantAiSchema.safeParse(brainRes.parsed);
      if (parsed.success) {
        return {
          dataset_id: params.dataset_id,
          problems: parsed.data.problems.slice(0, 7),
          recommendations: parsed.data.recommendations.slice(0, 6).map((r) => ({ ...r, confidence: clamp(r.confidence) })),
          impact_score: clamp(parsed.data.impact_score),
          roi_score: clamp(parsed.data.roi_score),
          risk_score: clamp(parsed.data.risk_score),
          investment_thesis: parsed.data.investment_thesis ?? null,
          meta: { source: "ai" },
        };
      }
    }
  }

  const problems: ConsultantReport["problems"] = [];
  const recommendations: ConsultantReport["recommendations"] = [];

  const sev = (score: number): "low" | "med" | "high" => (score >= 70 ? "high" : score >= 40 ? "med" : "low");

  // 1. Revenue / Region concentration
  if (intel?.bestRegion && intel.regionConcentrationPct >= 30) {
    const exposure = intel.bestRegion.total;
    problems.push({
      title: `${intel.bestRegion.name} regional concentration`,
      description: `${intel.bestRegion.name} contributes ${fmtPct(intel.regionConcentrationPct)} of ${intel.metricName.toLowerCase()} — a single-market dependency that amplifies downside if local demand softens.`,
      evidence: `${intel.bestRegion.name}: ${fmtMoney(intel.bestRegion.total)}${intel.worstRegion && intel.worstRegion !== intel.bestRegion ? ` vs ${intel.worstRegion.name}: ${fmtMoney(intel.worstRegion.total)}` : ""}.`,
      financial_exposure: `${shockExposure(exposure, 15, 30).display} at risk under a 15-30% regional demand shock (scenario).`,
      strategic_recommendation: `Stand up a second region playbook${intel.worstRegion ? ` starting with ${intel.worstRegion.name} unit economics` : ""}; cap ${intel.bestRegion.name} share of revenue below 50% within 3 quarters.`,
      severity: sev(intel.regionConcentrationPct),
      category: "concentration",
    });
  }

  // 2. Category performance
  if (intel?.bestCategory) {
    const c = intel.bestCategory;
    const wc = intel.worstCategory;
    problems.push({
      title: `${c.name} dominance & portfolio imbalance`,
      description: `${c.name} drives ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} at ${fmtPct(c.margin ?? 0)} margin${wc && wc !== c ? `, while ${wc.name} lags at ${fmtPct((wc.share) * 100)} share and ${fmtPct(wc.margin ?? 0)} margin` : ""}. Portfolio reward is concentrated; reinvestment must follow the winner.`,
      evidence: `${c.name}: ${fmtMoney(c.total)} (${fmtPct(intel.categoryConcentrationPct)}). ${wc && wc !== c ? `${wc.name}: ${fmtMoney(wc.total)} (${fmtPct((wc.share) * 100)}).` : ""}`,
      financial_exposure: (() => {
        const up = revenueUpsideBand(intel, c.total);
        const reinvest = up.computable ? `${up.display} reinvestment upside on ${c.name}` : `Reinvestment upside on ${c.name} (add a date column to quantify)`;
        // Margin drag = the profit lost by the laggard running below the leader's margin.
        const drag = wc && wc !== c ? Math.max(0, ((c.margin ?? 0) - (wc.margin ?? 0)) / 100 * wc.total) : 0;
        return `${reinvest}${drag > 0 ? `; ${fmtMoney(drag)} profit drag from ${wc!.name}'s margin gap.` : "."}`;
      })(),
      strategic_recommendation: `Lock a 90-day capital plan that overweights ${c.name}${wc && wc !== c ? ` and gates ${wc.name} on a profitability turnaround` : ""}.`,
      severity: intel.categoryConcentrationPct >= 55 ? "high" : "med",
      category: "category",
    });
  }

  // 3. Region performance gap
  if (intel?.bestRegion && intel.worstRegion && intel.worstRegion !== intel.bestRegion) {
    const gap = intel.bestRegion.total - intel.worstRegion.total;
    problems.push({
      title: `${intel.worstRegion.name} go-to-market underperformance`,
      description: `${intel.worstRegion.name} delivers only ${fmtMoney(intel.worstRegion.total)} vs ${intel.bestRegion.name}'s ${fmtMoney(intel.bestRegion.total)}. Coverage, channel mix, or product fit is broken.`,
      evidence: `Performance gap: ${fmtMoney(gap)} (${fmtPct((gap / Math.max(1, intel.bestRegion.total)) * 100)} delta).`,
      financial_exposure: `${fmtMoney(Math.max(0, intel.bestRegion.total * 0.6 - intel.worstRegion.total))} recoverable revenue if ${intel.worstRegion.name} reaches 60% of ${intel.bestRegion.name}'s revenue.`,
      strategic_recommendation: `Run a 60-day diagnostic on ${intel.worstRegion.name}: channel economics, pricing, and rep productivity. Decide reinvest vs. retreat.`,
      severity: "med",
      category: "region",
    });
  }

  // 4. Margin analysis
  if (margin < 25) {
    problems.push({
      title: "Margin compression vulnerability",
      description: `Blended margin of ${fmtPct(margin)} leaves limited absorption for input-cost shocks, FX moves, or competitive pricing.`,
      evidence: `Profit ${fmtMoney(profit)} on ${fmtMoney(rev)} revenue. A 200 bps margin compression would erase ${fmtMoney(rev * 0.02)} of profit.`,
      financial_exposure: `${fmtMoney(rev * 0.02)}–${fmtMoney(rev * 0.04)} profit at risk under 200–400 bps compression.`,
      strategic_recommendation: `Zero-based cost review on the bottom-quartile-margin segments; renegotiate top-3 vendor contracts; pilot tiered pricing on highest-conviction cohort.`,
      severity: margin < 10 ? "high" : margin < 18 ? "med" : "low",
      category: "margin",
    });
  }

  // 5. Customer analysis
  if (intel && intel.customerConcentrationPct >= 25 && intel.topCustomers.length) {
    const topName = intel.topCustomers[0]?.name ?? "Top customer";
    problems.push({
      title: "Customer concentration risk",
      description: `Top 5 customers represent ${fmtPct(intel.customerConcentrationPct)} of revenue. Loss of one materially impacts the forecast and erodes negotiating leverage.`,
      evidence: `Top buyer: ${topName} at ${fmtMoney(intel.topCustomers[0]?.total ?? 0)}. Top 5 cumulative: ${fmtMoney((intel.topCustomers.slice(0, 5).reduce((a, b) => a + b.total, 0)))}.`,
      financial_exposure: `${fmtMoney(intel.topCustomers[0]?.total ?? 0)} at risk from losing the single largest customer (${topName}).`,
      strategic_recommendation: `Tier the customer base, deploy named-account executive sponsors on the top 5, and stand up a mid-market acquisition motion to dilute concentration below 30% in 4 quarters.`,
      severity: intel.customerConcentrationPct >= 50 ? "high" : "med",
      category: "customer",
    });
  }

  // 6. Growth trends
  if (Math.abs(growth) >= 2 || (intel && intel.trendConsistency < 60)) {
    const direction = growth >= 5 ? "expansion" : growth >= 0 ? "plateau" : "contraction";
    problems.push({
      title: growth >= 0 ? `Growth ${direction} requires capital reallocation` : "Negative growth trajectory",
      description: growth >= 0
        ? `Half-over-half growth is ${fmtPct(growth)} with ${intel?.trendConsistency ?? 60}/100 consistency. Momentum exists but is uneven across segments — capital is likely mis-deployed.`
        : `Half-over-half decline of ${fmtPct(growth)} indicates structural pressure on the core motion, not a one-period anomaly.`,
      evidence: `Trend direction: ${intel?.trendDirection ?? "flat"}; series consistency ${intel?.trendConsistency ?? 60}/100.`,
      financial_exposure: growth < 0
        ? `${fmtMoney(Math.abs(rev * (growth / 100)))} forward-period erosion if trajectory persists.`
        : (() => { const b = revenueUpsideBand(intel, rev); return b.computable ? `${b.display} of upside left on the table without active reallocation.` : "Upside left on the table (add a date column to quantify)."; })(),
      strategic_recommendation: growth < 0
        ? "Freeze discretionary opex, protect margin, rebuild pipeline before reinvesting in growth experiments."
        : `Move 15–20% of marketing and sales coverage from low-yield segments into ${intel?.bestCategory?.name ?? "the top category"}${intel?.bestRegion ? ` × ${intel.bestRegion.name}` : ""}.`,
      severity: growth < -5 ? "high" : Math.abs(growth) >= 5 ? "med" : "low",
      category: "growth",
    });
  }

  // 7. Forecast risk
  if (params.kpis.anomalies.length > 0 || (intel && intel.trendConsistency < 55)) {
    const an = params.kpis.anomalies[0];
    problems.push({
      title: "Forecast confidence degradation",
      description: `Statistical noise and trend inconsistency compound beyond a 4-period horizon, making board-level commitments fragile.`,
      evidence: `${params.kpis.anomalies.length} flagged anomalies${an ? ` (largest: ${an.label} at ${fmtMoney(an.value)})` : ""}; consistency ${intel?.trendConsistency ?? 60}/100.`,
      financial_exposure: `±${fmtMoney(rev * (100 - (intel?.trendConsistency ?? 60)) / 100)} of forward-period swing, derived from your series volatility (consistency ${intel?.trendConsistency ?? 60}/100).`,
      strategic_recommendation: "Move from periodic to a rolling 13-week forecast; instrument leading indicators (pipeline coverage, churn signal, sell-through) for monthly recalibration.",
      severity: (intel?.trendConsistency ?? 60) < 45 ? "high" : "med",
      category: "forecast",
    });
  }

  // === Recommendations — business-specific initiatives ====================
  const bestCat = intel?.bestCategory?.name ?? "the top category";
  const bestReg = intel?.bestRegion?.name ?? "the leading region";
  const worstCat = intel?.worstCategory?.name;
  const worstReg = intel?.worstRegion?.name;
  // Data-derived upside band for the flagship growth wedge; gated when there is
  // no usable time series to ground it.
  const flagshipBand = intel ? revenueUpsideBand(intel, intel.bestCategory?.total ?? rev) : null;
  const bandRevenue = (b: typeof flagshipBand, suffix: string, fallback: string) =>
    b && b.computable ? `${b.display}${suffix}` : fallback;

  recommendations.push({
    title: `Scale ${bestCat} in ${bestReg}`,
    description: `Concentrate sales coverage, inventory, and upper-funnel marketing on the proven ${bestCat} × ${bestReg} wedge.`,
    impact: 88, // growth potential
    effort: 35, // execution difficulty
    timeframe: "60-90 days",
    expected_revenue_impact: bandRevenue(flagshipBand, "", "Add a date column to quantify upside"),
    confidence: Math.min(92, 60 + (intel?.trendConsistency ?? 50) * 0.3),
    owner: "Chief Revenue Officer",
    strategic_risk: 22,
  });

  if (worstCat && intel?.bestCategory && worstCat !== bestCat) {
    recommendations.push({
      title: `${worstCat} profitability turnaround`,
      description: `60-day gated turnaround: pricing reset, SKU rationalization, and cost-to-serve review. Sunset if margin gate is missed.`,
      impact: 62,
      effort: 55,
      timeframe: "60 days",
      expected_revenue_impact: (() => {
        const gapPts = Math.max(0, ((intel.bestCategory.margin ?? 0) - (intel.worstCategory?.margin ?? 0)) * (intel.worstCategory?.share ?? 0));
        return gapPts > 0 ? `up to +${fmtPct(gapPts)} blended margin (closing the gap to ${bestCat})` : "Blended margin recovery";
      })(),
      confidence: 70,
      owner: "Chief Financial Officer",
      strategic_risk: 35,
    });
  }

  if (intel && intel.customerConcentrationPct >= 30) {
    recommendations.push({
      title: "Customer diversification program",
      description: `Tiered named-account model on top 5; mid-market acquisition motion to dilute top-5 share from ${fmtPct(intel.customerConcentrationPct)} → <30% in 4 quarters.`,
      impact: 70,
      effort: 65,
      timeframe: "2-4 quarters",
      expected_revenue_impact: bandRevenue(intel ? revenueUpsideBand(intel, rev) : null, " new-logo revenue; reduced churn exposure", "Reduced churn exposure; new-logo upside (add a date column to quantify)"),
      confidence: 65,
      owner: "Chief Growth Officer",
      strategic_risk: 45,
    });
  }

  if (worstReg && intel?.bestRegion && worstReg !== bestReg) {
    recommendations.push({
      title: `${worstReg} go-to-market reset`,
      description: `60-day diagnostic on coverage, pricing, and channel economics; decide reinvest-vs-retreat with a documented capital case.`,
      impact: 58,
      effort: 60,
      timeframe: "60 days",
      expected_revenue_impact: `+${fmtMoney(Math.max(0, intel.bestRegion.total * 0.6 - (intel.worstRegion?.total ?? 0)))} recoverable if ${worstReg} reaches 60% of ${bestReg}'s revenue`,
      confidence: 60,
      owner: "Chief Operating Officer",
      strategic_risk: 50,
    });
  }

  recommendations.push({
    title: "Rolling 13-week forecast & KPI cadence",
    description: "Replace periodic forecasting with continuous rolling forecast; instrument leading indicators for monthly recalibration.",
    impact: 55,
    effort: 30,
    timeframe: "30 days",
    expected_revenue_impact: `±${fmtMoney(rev * (100 - (intel?.trendConsistency ?? 60)) / 100 * 0.5)} tighter forecast variance (halving current series volatility)`,
    confidence: 85,
    owner: "Chief Financial Officer",
    strategic_risk: 15,
  });

  if (margin < 25) {
    recommendations.push({
      title: "Margin defense package",
      description: "Zero-based vendor review on top-3 categories, tiered pricing pilot on highest-conviction cohort, freeze on non-strategic opex.",
      impact: 66,
      effort: 50,
      timeframe: "90 days",
      expected_revenue_impact: "Blended margin expansion from vendor + pricing actions",
      confidence: 72,
      owner: "Chief Financial Officer",
      strategic_risk: 30,
    });
  }

  // Scores (re-purposed): Growth Potential / Execution Difficulty / Strategic Risk
  const growth_potential = Math.min(100, Math.max(35, Math.round(55 + growth * 1.8 + (intel?.bestCategory ? 10 : 0))));
  const execution_difficulty = Math.min(95, Math.max(20, Math.round(30 + (intel?.categoryConcentrationPct ?? 30) * 0.4 + recommendations.length * 3)));
  const strategic_risk = Math.min(95, Math.max(15, Math.round(
    25
    + (intel?.categoryConcentrationPct ?? 0) * 0.25
    + (intel?.customerConcentrationPct ?? 0) * 0.3
    + (margin < 15 ? 15 : 0)
    + (growth < 0 ? 18 : 0)
  )));

  // Investment thesis
  const posture: ConsultantInvestmentThesis["posture"] =
    growth >= 6 && margin >= 18 ? "Accelerate" : growth >= 0 ? "Optimize" : margin < 12 ? "Defend" : "Stabilize";
  const thesisBand = intel ? revenueUpsideBand(intel, rev) : null;
  const verdict =
    posture === "Accelerate"
      ? `Recommended posture: ACCELERATE. Concentrate capital on ${bestCat} × ${bestReg}, instrument the rolling forecast, and pre-fund a second growth engine. Conviction is supported by ${fmtPct(growth)} growth and ${fmtPct(margin)} margin.`
      : posture === "Optimize"
      ? `Recommended posture: OPTIMIZE. The portfolio has working motions but mis-allocated capital. Reweight toward ${bestCat} × ${bestReg}${worstCat ? `, run a 60-day gate on ${worstCat}` : ""}, and lock the cadence. Expected operating leverage is meaningful within 2 quarters.`
      : posture === "Stabilize"
      ? `Recommended posture: STABILIZE. Protect margin first, rebuild pipeline second, then reinvest. Avoid bold bets until the rolling forecast shows two clean periods.`
      : `Recommended posture: DEFEND. Margin and growth signals demand a defensive posture: protect cash, exit unprofitable segments, and reset the cost base before any growth initiative is funded.`;

  const investment_thesis: ConsultantInvestmentThesis = {
    revenue_upside: thesisBand && thesisBand.computable
      ? `${thesisBand.display} over the next equivalent period if recommended initiatives execute (based on your realized growth)`
      : "Add a date column to quantify the revenue upside",
    margin_improvement: "Blended margin expansion from mix + cost actions",
    risk_reduction: intel
      ? `Top-category share ${fmtPct(intel.categoryConcentrationPct)} → target <40%; customer concentration ${fmtPct(intel.customerConcentrationPct)} → target <30% in 4 quarters.`
      : `Diversify revenue base and harden forecast confidence within 2 quarters.`,
    verdict,
    posture,
  };

  return {
    dataset_id: params.dataset_id,
    problems: problems.slice(0, 7),
    recommendations: recommendations.slice(0, 6),
    impact_score: growth_potential,
    roi_score: execution_difficulty,
    risk_score: strategic_risk,
    investment_thesis,
    meta: fallbackMeta(brainRes),
  };
}
