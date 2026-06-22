// Mission Control + Boardroom intelligence synthesis.
// Derives executive objectives, initiatives, KPI targets, roadmap, agent
// consensus and strategy-health scoring from the shared BusinessIntelligence
// layer. Kept side-effect-free so Mission Control and Boardroom can reason
// over the same source of truth.
import type { BusinessIntelligence } from "./intelligence";
import { formatMoney as fmtMoney, formatPct as fmtPct } from "./intelligence";
import { revenueUpsideBand } from "./estimates";
import type { KpiSummary, SimulationScenario } from "./types";

export type Priority = "Critical" | "High" | "Medium" | "Low";
export type InitiativeStatus = "Backlog" | "Planned" | "In Progress" | "Completed";

export interface MissionObjective {
  id: string;
  title: string;
  rationale: string;
  priority: Priority;
  owner: string;
  progress: number; // 0-100
  status: InitiativeStatus;
  impact: string;
}

export type RiskLevel = "Low" | "Moderate" | "Elevated" | "High";

export interface MissionInitiative {
  id: string;
  title: string;
  rationale: string;
  /** Why this opportunity exists right now — dataset-grounded one-liner. */
  why: string;
  /** Source signal that produced this initiative. */
  driver:
    | "KPI"
    | "Risk"
    | "Forecast"
    | "Region"
    | "Category"
    | "Customer"
    | "Growth"
    | "Margin";
  revenueImpact: number;
  profitImpact: number;
  riskLevel: RiskLevel;
  confidence: number; // 0-100
  effort: number; // 0-100
  impactScore: number; // 0-100
  owner: string;
  agents: string[]; // supporting agents
  status: InitiativeStatus;
  priority: Priority;
  timelineDays: 30 | 45 | 60 | 90;
}

export interface StrategyScore {
  growthOpportunity: number;
  executionFeasibility: number;
  riskExposure: number;
  forecastSupport: number;
  overall: number; // 0-100
  verdict: "Aggressive Growth" | "Balanced Execution" | "Stabilize & Defend" | "Restructure";
}

export interface MissionKpiTarget {
  key: string;
  label: string;
  current: string;
  target: string;
  progress: number; // 0-100
  status: "On Track" | "At Risk" | "Off Track" | "Achieved";
}

export interface AgentRecommendation {
  agent: string;
  recommendation: string;
  rationale: string;
  confidence: number; // 0-100
  stance: "Support" | "Conditional" | "Oppose";
}

export interface StrategyHealth {
  executionReadiness: number;
  growthPotential: number;
  riskExposure: number;
  forecastStrength: number;
  operationalAlignment: number;
  overall: number;
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2));

function priorityFromScore(s: number): Priority {
  if (s >= 80) return "Critical";
  if (s >= 60) return "High";
  if (s >= 40) return "Medium";
  return "Low";
}

// ---------- Objectives -----------------------------------------------------
export function deriveObjectives(intel: BusinessIntelligence | null, kpis: KpiSummary | null): MissionObjective[] {
  if (!intel || !kpis) return [];
  const rev = intel.totalRevenue;
  const c = intel.bestCategory;
  const r = intel.bestRegion;
  const out: MissionObjective[] = [];

  out.push({
    id: uid(),
    title: c && r ? `Scale ${c.name} in ${r.name}` : "Accelerate top growth engine",
    rationale: c && r
      ? `${c.name} contributes ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} and ${r.name} leads at ${fmtMoney(r.total)}. Doubling down on this wedge is the highest-conviction move.`
      : "Concentrate capital on the segment with the strongest unit economics.",
    priority: "Critical",
    owner: "CRO",
    progress: 45,
    status: "In Progress",
    impact: (() => { const b = revenueUpsideBand(intel, rev); return b.computable ? `${b.display} Revenue` : "Add date column for upside"; })(),
  });

  if (intel.marginPct < 25) {
    out.push({
      id: uid(),
      title: "Expand Profit Margin",
      rationale: `Blended margin ${fmtPct(intel.marginPct)} leaves limited shock absorption. A targeted cost + pricing program lifts blended margin 150–300 bps.`,
      priority: intel.marginPct < 12 ? "Critical" : "High",
      owner: "CFO",
      progress: 20,
      status: "Planned",
      impact: "Higher blended margin",
    });
  }

  if (intel.categoryConcentrationPct >= 40 || intel.customerConcentrationPct >= 35) {
    out.push({
      id: uid(),
      title: "Diversify Revenue Base",
      rationale: `Concentration risk: top category ${fmtPct(intel.categoryConcentrationPct)}, top-5 customers ${fmtPct(intel.customerConcentrationPct)}. Build a second engine to dilute exposure.`,
      priority: "High",
      owner: "CEO",
      progress: 15,
      status: "Planned",
      impact: "Lower concentration risk",
    });
  }

  if (intel.worstRegion && intel.bestRegion && intel.worstRegion !== intel.bestRegion) {
    const gap = intel.bestRegion.total - intel.worstRegion.total;
    out.push({
      id: uid(),
      title: `Reset ${intel.worstRegion.name} Go-to-Market`,
      rationale: `${intel.worstRegion.name} trails ${intel.bestRegion.name} by ${fmtMoney(gap)}. A 60-day diagnostic decides reinvest vs. retreat.`,
      priority: "Medium",
      owner: "COO",
      progress: 10,
      status: "Backlog",
      impact: `+${fmtMoney(Math.max(0, intel.bestRegion.total * 0.6 - intel.worstRegion.total))} Recoverable`,
    });
  }

  out.push({
    id: uid(),
    title: "Tighten Forecast & Cadence",
    rationale: `Trend consistency ${intel.trendConsistency}/100. Move from periodic to rolling 13-week forecast to hold board-level commitments.`,
    priority: intel.trendConsistency < 55 ? "High" : "Medium",
    owner: "CFO",
    progress: 35,
    status: "In Progress",
    impact: `Forecast variance ↓`,
  });

  return out.slice(0, 5);
}

// ---------- Dynamic Initiative Engine -------------------------------------
// Recommendations are generated from eight signals: KPI performance, risks,
// forecast trends, regional performance, category performance, customer
// concentration, revenue growth, and margin. Each initiative re-derives every
// time the dataset, KPIs or risk picture change.

function riskLevelFromScores(riskExposure: number, dependency: number): RiskLevel {
  const blended = riskExposure * 0.6 + dependency * 0.4;
  if (blended >= 70) return "High";
  if (blended >= 50) return "Elevated";
  if (blended >= 30) return "Moderate";
  return "Low";
}

/** Confidence is a weighted blend of KPI Health, Forecast Strength and inverse
 *  Risk Exposure, biased by the driver and the initiative's intrinsic effort. */
function confidenceFor(
  driver: MissionInitiative["driver"],
  signals: { kpiHealth: number; forecastStrength: number; riskExposure: number },
  effort: number,
): number {
  const { kpiHealth, forecastStrength, riskExposure } = signals;
  const inverseRisk = 100 - riskExposure;
  // Per-driver weighting — different signals matter more depending on the lever.
  const weights: Record<MissionInitiative["driver"], [number, number, number]> = {
    KPI:       [0.55, 0.25, 0.20],
    Forecast:  [0.20, 0.60, 0.20],
    Risk:      [0.20, 0.20, 0.60],
    Growth:    [0.35, 0.45, 0.20],
    Margin:    [0.45, 0.20, 0.35],
    Region:    [0.40, 0.30, 0.30],
    Category:  [0.40, 0.35, 0.25],
    Customer:  [0.30, 0.20, 0.50],
  };
  const [wK, wF, wR] = weights[driver];
  const base = kpiHealth * wK + forecastStrength * wF + inverseRisk * wR;
  // Effort drag: every 10 effort points trims ~3 confidence points.
  const adj = base - (effort - 30) * 0.3;
  return Math.round(Math.max(15, Math.min(96, adj)));
}

function impactToPriority(score: number): Priority {
  return priorityFromScore(score);
}

function timeline(effort: number, riskExposure: number): 30 | 45 | 60 | 90 {
  const blended = effort * 0.7 + riskExposure * 0.3;
  if (blended < 30) return 30;
  if (blended < 50) return 45;
  if (blended < 70) return 60;
  return 90;
}

interface Signals {
  kpiHealth: number;
  forecastStrength: number;
  riskExposure: number;
}

export function deriveInitiatives(intel: BusinessIntelligence | null, kpis: KpiSummary | null = null): MissionInitiative[] {
  if (!intel) return [];
  const rev = intel.totalRevenue;
  const marginRatio = Math.max(0.02, intel.marginPct / 100);
  // Impact estimates are grounded in the firm's OWN realized growth band rather
  // than a fixed coefficient: a fast-growing business surfaces larger upside
  // than a flat one. `upsideScale` rescales the per-lever weights relative to
  // the legacy 8% anchor; when there is no usable time series we fall back to a
  // conservative 0.6 and the UI discloses the figures are estimates.
  const realizedMidPct = intel.upsideBandPct
    ? (intel.upsideBandPct.low + intel.upsideBandPct.high) / 2
    : null;
  const upsideScale = realizedMidPct !== null ? clamp(realizedMidPct / 8, 0.25, 2.5) : 0.6;
  const c = intel.bestCategory;
  const r = intel.bestRegion;
  const wc = intel.worstCategory;
  const wr = intel.worstRegion;

  // --- Core signals (live, derived from current intel) -------------------
  const growth = intel.growthPct;
  const kpiHealth = Math.round(
    Math.max(0, Math.min(100,
      40
      + Math.max(-20, Math.min(25, growth)) * 1.6
      + Math.max(-15, Math.min(25, intel.marginPct - 10)) * 1.1
      + (intel.trendConsistency - 50) * 0.3,
    )),
  );
  const forecastStrength = Math.round(Math.min(95, 28 + intel.trendConsistency * 0.6 + Math.max(0, growth) * 1.2));
  const riskExposureRaw =
    18
    + intel.categoryConcentrationPct * 0.40
    + intel.customerConcentrationPct * 0.30
    + (intel.marginPct < 12 ? 16 : intel.marginPct < 18 ? 8 : 0)
    + (growth < 0 ? 18 : growth < 3 ? 6 : 0)
    + (intel.trendConsistency < 40 ? 10 : 0);
  const riskExposure = Math.round(Math.max(8, Math.min(95, riskExposureRaw)));
  const signals: Signals = { kpiHealth, forecastStrength, riskExposure };

  const out: MissionInitiative[] = [];

  // 1. CATEGORY × REGION — top growth wedge
  if (c && r) {
    const upliftRev = rev * (0.08 + Math.max(0, growth) / 250);
    const effort = 30 + (intel.categoryConcentrationPct >= 55 ? 10 : 0);
    out.push({
      id: uid(),
      title: `Scale ${c.name} in ${r.name}`,
      why: `${c.name} delivers ${fmtPct(intel.categoryConcentrationPct)} of ${intel.metricName.toLowerCase()} and ${r.name} is the strongest region at ${fmtMoney(r.total)} — proven product-market fit with room to compound.`,
      rationale: `Reweight marketing, inventory and quota toward the ${c.name}/${r.name} wedge for ${timeline(effort, riskExposure)} days; instrument cohort tracking to defend margin.`,
      driver: "Category",
      revenueImpact: upliftRev,
      profitImpact: upliftRev * marginRatio,
      riskLevel: riskLevelFromScores(riskExposure, intel.categoryConcentrationPct),
      confidence: confidenceFor("Category", signals, effort),
      effort,
      impactScore: 78 + (growth > 0 ? 8 : 0),
      owner: "CRO",
      agents: ["CEO Agent", "Forecast Agent", "Consultant Agent"],
      status: "In Progress",
      priority: "Critical",
      timelineDays: timeline(effort, riskExposure),
    });
  }

  // 2. MARGIN — only when margin is compressed
  if (intel.marginPct < 25) {
    const lift = intel.marginPct < 12 ? 0.035 : intel.marginPct < 18 ? 0.025 : 0.018;
    const effort = 55;
    out.push({
      id: uid(),
      title: "Margin Defense Program",
      why: `Blended margin sits at ${fmtPct(intel.marginPct)} — below the ${intel.marginPct < 15 ? "viability" : "resilience"} threshold; small input shocks compress profit disproportionately.`,
      rationale: "Zero-based vendor review, contract repricing, and tiered pricing pilot on highest-conviction cohort. Designed to lift blended margin without slowing top-line.",
      driver: "Margin",
      revenueImpact: rev * 0.02,
      profitImpact: rev * lift,
      riskLevel: riskLevelFromScores(riskExposure, intel.marginPct < 12 ? 75 : 45),
      confidence: confidenceFor("Margin", signals, effort),
      effort,
      impactScore: intel.marginPct < 12 ? 82 : 68,
      owner: "CFO",
      agents: ["CFO Agent", "Consultant Agent"],
      status: "Planned",
      priority: intel.marginPct < 12 ? "Critical" : "High",
      timelineDays: 90,
    });
  }

  // 3. CUSTOMER CONCENTRATION — risk-driven
  if (intel.customerConcentrationPct >= 30) {
    const effort = 65;
    out.push({
      id: uid(),
      title: "Customer Diversification Motion",
      why: `Top-5 customers represent ${fmtPct(intel.customerConcentrationPct)} of revenue — losing one of them removes ${fmtMoney(rev * (intel.customerConcentrationPct / 100) / 5)}.`,
      rationale: "Tiered named-account model on top 5 plus a mid-market acquisition motion to dilute top-5 share toward <30%.",
      driver: "Customer",
      revenueImpact: rev * 0.06,
      profitImpact: rev * 0.06 * marginRatio * 0.9,
      riskLevel: riskLevelFromScores(riskExposure, intel.customerConcentrationPct),
      confidence: confidenceFor("Customer", signals, effort),
      effort,
      impactScore: 55 + Math.min(25, (intel.customerConcentrationPct - 30) * 0.7),
      owner: "CRO",
      agents: ["CEO Agent", "Risk Agent", "Consultant Agent"],
      status: "Backlog",
      priority: intel.customerConcentrationPct >= 50 ? "Critical" : "High",
      timelineDays: 90,
    });
  }

  // 4. WORST CATEGORY — turnaround gate
  if (wc && c && wc !== c) {
    const effort = 50;
    out.push({
      id: uid(),
      title: `${wc.name} Turnaround Gate`,
      why: `${wc.name} returns only ${fmtPct(wc.margin ?? 0)} margin vs. ${fmtPct(c.margin ?? 0)} on ${c.name}, dragging blended economics.`,
      rationale: `60-day profitability gate: pricing reset, SKU rationalization, cost-to-serve review. Sunset if margin target missed at the gate.`,
      driver: "Category",
      revenueImpact: -rev * 0.01,
      profitImpact: rev * 0.015,
      riskLevel: riskLevelFromScores(riskExposure, 40),
      confidence: confidenceFor("Category", signals, effort),
      effort,
      impactScore: 50,
      owner: "CFO",
      agents: ["CFO Agent", "Risk Agent"],
      status: "Planned",
      priority: "Medium",
      timelineDays: 60,
    });
  }

  // 5. WORST REGION — GTM reset
  if (wr && r && wr !== r) {
    const gap = r.total - wr.total;
    const effort = 60;
    out.push({
      id: uid(),
      title: `${wr.name} GTM Reset`,
      why: `${wr.name} trails ${r.name} by ${fmtMoney(gap)} — coverage, channel mix, or rep productivity is materially below benchmark.`,
      rationale: "Diagnose coverage, channel economics and rep productivity; decide reinvest vs. retreat with a documented capital case.",
      driver: "Region",
      revenueImpact: gap * 0.2,
      profitImpact: gap * 0.2 * marginRatio,
      riskLevel: riskLevelFromScores(riskExposure, 35),
      confidence: confidenceFor("Region", signals, effort),
      effort,
      impactScore: Math.min(72, 45 + (gap / Math.max(1, rev)) * 80),
      owner: "COO",
      agents: ["COO Agent", "Consultant Agent"],
      status: "Backlog",
      priority: "Medium",
      timelineDays: 60,
    });
  }

  // 6. FORECAST DISCIPLINE — when consistency is shaky
  if (intel.trendConsistency < 75) {
    const effort = 25;
    out.push({
      id: uid(),
      title: "Rolling 13-Week Forecast",
      why: `Trend consistency is ${intel.trendConsistency}/100 — periodic forecasting cannot hold board-level commitments with this variance.`,
      rationale: "Move to continuous rolling forecast; instrument leading indicators and recalibrate monthly.",
      driver: "Forecast",
      revenueImpact: rev * 0.01,
      profitImpact: rev * 0.012,
      riskLevel: riskLevelFromScores(riskExposure, 100 - intel.trendConsistency),
      confidence: confidenceFor("Forecast", signals, effort),
      effort,
      impactScore: 48 + (intel.trendConsistency < 50 ? 18 : 6),
      owner: "CFO",
      agents: ["CFO Agent", "Forecast Agent"],
      status: "In Progress",
      priority: intel.trendConsistency < 50 ? "High" : "Medium",
      timelineDays: 30,
    });
  }

  // 7. GROWTH — adjacent SKU when momentum is healthy
  if (growth > 2 && c) {
    const effort = 70;
    out.push({
      id: uid(),
      title: `Adjacent SKU Launch in ${c.name}`,
      why: `Growth runs at ${fmtPct(growth)} with ${c.name} as the engine — existing buyers convert on adjacent SKUs at materially lower CAC than net-new.`,
      rationale: "Ship an adjacent SKU into the existing buyer base; ride the installed motion before opening new acquisition channels.",
      driver: "Growth",
      revenueImpact: rev * 0.045,
      profitImpact: rev * 0.045 * marginRatio,
      riskLevel: riskLevelFromScores(riskExposure, 30),
      confidence: confidenceFor("Growth", signals, effort),
      effort,
      impactScore: 60 + Math.min(15, growth),
      owner: "CMO",
      agents: ["CEO Agent", "CMO Agent"],
      status: "Backlog",
      priority: "Medium",
      timelineDays: 90,
    });
  }

  // 7b. GROWTH — defensive reset when momentum has stalled or reversed
  if (growth <= 0) {
    const effort = 55;
    out.push({
      id: uid(),
      title: "Demand Recovery Plan",
      why: `Growth is ${fmtPct(growth)} — pipeline coverage, pricing or channel mix is failing to convert at prior rates.`,
      rationale: "Triage the funnel by stage and segment; reset pricing tests and concentrate sales motion on the top-converting cohort.",
      driver: "Growth",
      revenueImpact: rev * 0.05,
      profitImpact: rev * 0.05 * marginRatio,
      riskLevel: riskLevelFromScores(riskExposure, 60),
      confidence: confidenceFor("Growth", signals, effort),
      effort,
      impactScore: 75,
      owner: "CRO",
      agents: ["CEO Agent", "CRO Agent", "Consultant Agent"],
      status: "Planned",
      priority: "Critical",
      timelineDays: 60,
    });
  }

  // 8. KPI MISS — triggered when blended KPI health is low
  if (kpiHealth < 55 && kpis) {
    const effort = 45;
    out.push({
      id: uid(),
      title: "KPI Recovery Sprint",
      why: `Blended KPI health is ${kpiHealth}/100 — multiple board KPIs are simultaneously below plan, indicating a systemic, not local, issue.`,
      rationale: "30-day cross-functional sprint to lift the two weakest KPIs; weekly review with named owners and a defined exit criterion.",
      driver: "KPI",
      revenueImpact: rev * 0.03,
      profitImpact: rev * 0.03 * marginRatio,
      riskLevel: riskLevelFromScores(riskExposure, 55),
      confidence: confidenceFor("KPI", signals, effort),
      effort,
      impactScore: 70,
      owner: "COO",
      agents: ["CEO Agent", "CFO Agent", "COO Agent"],
      status: "Planned",
      priority: "High",
      timelineDays: 30,
    });
  }

  // 9. RISK — explicit hedge when exposure is high
  if (riskExposure >= 55) {
    const effort = 40;
    out.push({
      id: uid(),
      title: "Strategic Risk Hedge",
      why: `Composite risk exposure is ${riskExposure}/100 driven by concentration (${fmtPct(intel.categoryConcentrationPct)} category / ${fmtPct(intel.customerConcentrationPct)} customer) and margin sensitivity.`,
      rationale: "Stand up a parallel risk-hedge track: contract diversification, second-source supply, and a margin floor before scaling.",
      driver: "Risk",
      revenueImpact: rev * 0.015,
      profitImpact: rev * 0.02,
      riskLevel: riskLevelFromScores(riskExposure, riskExposure),
      confidence: confidenceFor("Risk", signals, effort),
      effort,
      impactScore: 62,
      owner: "CFO",
      agents: ["Risk Agent", "CFO Agent"],
      status: "Backlog",
      priority: riskExposure >= 70 ? "Critical" : "High",
      timelineDays: 45,
    });
  }

  // Ground every dollar impact in the firm's realized growth (see upsideScale).
  for (const i of out) {
    i.revenueImpact = Math.round(i.revenueImpact * upsideScale);
    i.profitImpact = Math.round(i.profitImpact * upsideScale);
  }

  // --- Auto re-rank ------------------------------------------------------
  // Composite rank: impact + confidence + (risk urgency for risk-bearing).
  out.sort((a, b) => {
    const aScore = a.impactScore * 0.55 + a.confidence * 0.35 + (a.driver === "Risk" || a.driver === "Margin" ? 10 : 0);
    const bScore = b.impactScore * 0.55 + b.confidence * 0.35 + (b.driver === "Risk" || b.driver === "Margin" ? 10 : 0);
    return bScore - aScore;
  });

  // Reassign priority bands from rank-adjusted impact so the ladder is stable.
  for (let i = 0; i < out.length; i++) {
    const decay = i * 6;
    const ranked = Math.max(20, out[i].impactScore - decay);
    out[i].priority = impactToPriority(ranked);
  }

  return out;
}

// ---------- KPI Targets ----------------------------------------------------
export function deriveKpiTargets(intel: BusinessIntelligence | null, kpis: KpiSummary | null): MissionKpiTarget[] {
  if (!intel || !kpis) return [];
  const list: MissionKpiTarget[] = [];
  const status = (cur: number, tgt: number, higherBetter = true): MissionKpiTarget["status"] => {
    const ratio = higherBetter ? cur / tgt : tgt / Math.max(0.0001, cur);
    if (ratio >= 1) return "Achieved";
    if (ratio >= 0.85) return "On Track";
    if (ratio >= 0.6) return "At Risk";
    return "Off Track";
  };
  const pct = (cur: number, tgt: number) => Math.max(0, Math.min(100, Math.round((cur / Math.max(0.0001, tgt)) * 100)));

  const growthTarget = Math.max(8, intel.growthPct + 4);
  list.push({
    key: "growth",
    label: "Revenue Growth",
    current: fmtPct(intel.growthPct),
    target: fmtPct(growthTarget),
    progress: pct(intel.growthPct, growthTarget),
    status: status(intel.growthPct, growthTarget),
  });

  const marginTarget = Math.max(intel.marginPct + 2, 20);
  list.push({
    key: "margin",
    label: "Profit Margin",
    current: fmtPct(intel.marginPct),
    target: fmtPct(marginTarget),
    progress: pct(intel.marginPct, marginTarget),
    status: status(intel.marginPct, marginTarget),
  });

  list.push({
    key: "forecast",
    label: "Forecast Accuracy",
    current: `${intel.trendConsistency}/100`,
    target: "85/100",
    progress: pct(intel.trendConsistency, 85),
    status: status(intel.trendConsistency, 85),
  });

  if (intel.categoryConcentrationPct > 0) {
    const concTarget = 40;
    list.push({
      key: "diversification",
      label: "Category Diversification",
      current: fmtPct(intel.categoryConcentrationPct),
      target: `< ${fmtPct(concTarget)}`,
      progress: Math.max(0, Math.min(100, Math.round(((100 - intel.categoryConcentrationPct) / (100 - concTarget)) * 100))),
      status: status(concTarget, intel.categoryConcentrationPct, false),
    });
  }

  if (intel.regions.length > 0) {
    list.push({
      key: "regions",
      label: "Regional Expansion",
      current: `${intel.regions.length} active`,
      target: `${Math.max(intel.regions.length + 1, 4)} active`,
      progress: pct(intel.regions.length, Math.max(intel.regions.length + 1, 4)),
      status: status(intel.regions.length, Math.max(intel.regions.length + 1, 4)),
    });
  }

  if (intel.topCustomers.length) {
    const concTarget = 30;
    list.push({
      key: "customers",
      label: "Customer Concentration",
      current: fmtPct(intel.customerConcentrationPct),
      target: `< ${fmtPct(concTarget)}`,
      progress: Math.max(0, Math.min(100, Math.round(((100 - intel.customerConcentrationPct) / (100 - concTarget)) * 100))),
      status: status(concTarget, intel.customerConcentrationPct, false),
    });
  }

  return list;
}

// ---------- Roadmap --------------------------------------------------------
export function buildRoadmap(initiatives: MissionInitiative[]): Record<30 | 45 | 60 | 90, MissionInitiative[]> {
  const map: Record<30 | 45 | 60 | 90, MissionInitiative[]> = { 30: [], 45: [], 60: [], 90: [] };
  for (const i of initiatives) {
    const bucket = i.timelineDays === 45 ? 45 : i.timelineDays === 30 ? 30 : i.timelineDays === 60 ? 60 : 90;
    map[bucket].push(i);
  }
  return map;
}

// ---------- Agent Consensus -----------------------------------------------
export function buildAgentConsensus(intel: BusinessIntelligence | null): {
  recs: AgentRecommendation[];
  consensusScore: number;
  consensusRecommendation: string;
  expectedOutcome: string;
} {
  if (!intel) {
    return { recs: [], consensusScore: 0, consensusRecommendation: "Upload a dataset to convene the executive panel.", expectedOutcome: "—" };
  }
  const c = intel.bestCategory;
  const r = intel.bestRegion;
  const focus = `${c?.name ?? "the top category"}${r ? ` in ${r.name}` : ""}`;
  const recs: AgentRecommendation[] = [
    {
      agent: "CEO Agent",
      recommendation: `Press the advantage in ${focus}.`,
      rationale: `Trend is ${intel.trendDirection} at ${fmtPct(intel.growthPct)}; compounding lives where unit economics already work.`,
      confidence: Math.min(95, 70 + intel.trendConsistency * 0.2),
      stance: intel.growthPct >= 0 ? "Support" : "Conditional",
    },
    {
      agent: "Forecast Agent",
      recommendation: `Forecast supports +${fmtPct(intel.forecastUpsidePct)} upside if focus holds.`,
      rationale: `Consistency ${intel.trendConsistency}/100; momentum is ${intel.trendDirection}.`,
      confidence: 60 + Math.round(intel.trendConsistency * 0.3),
      stance: intel.trendDirection === "down" ? "Conditional" : "Support",
    },
    {
      agent: "Risk Agent",
      recommendation: intel.categoryConcentrationPct >= 40 || intel.customerConcentrationPct >= 35
        ? "Pair growth move with a diversification gate."
        : "Risk profile permits acceleration.",
      rationale: `Category concentration ${fmtPct(intel.categoryConcentrationPct)}, customer ${fmtPct(intel.customerConcentrationPct)}, margin ${fmtPct(intel.marginPct)}.`,
      confidence: intel.categoryConcentrationPct >= 50 ? 55 : 78,
      stance: intel.categoryConcentrationPct >= 50 ? "Conditional" : "Support",
    },
    {
      agent: "Consultant Agent",
      recommendation: `Sequence: scale ${focus}, gate underperformers, rebuild forecast cadence.`,
      rationale: `Capital must follow proven unit economics; underperformers need a 60-day gate not indefinite subsidy.`,
      confidence: 80,
      stance: "Support",
    },
    {
      agent: "Execution Agent",
      recommendation: "Sequence one initiative per quarter; capacity is the constraint.",
      rationale: "Operationally we can absorb one strategic initiative without disruption.",
      confidence: 75,
      stance: "Support",
    },
  ];

  const stanceScore = (s: AgentRecommendation["stance"]) => (s === "Support" ? 1 : s === "Conditional" ? 0.55 : 0);
  const consensusScore = Math.round(
    (recs.reduce((a, b) => a + stanceScore(b.stance) * (b.confidence / 100), 0) / recs.length) * 100,
  );
  const consensusRecommendation = `Approve a focused 90-day program to scale ${focus} with capped opex, ring-fenced margin guardrails${intel.categoryConcentrationPct >= 45 ? `, and a parallel diversification track` : ""}.`;
  const outcomeBand = revenueUpsideBand(intel, intel.totalRevenue);
  const expectedOutcome = outcomeBand.computable
    ? `${outcomeBand.display} revenue over the next equivalent period (based on your realized growth); concentration trending toward target.`
    : "Add a date column so the revenue outcome can be derived from your trend; concentration trending toward target.";
  return { recs, consensusScore, consensusRecommendation, expectedOutcome };
}

// ---------- Strategy Health -----------------------------------------------
export function strategyHealth(intel: BusinessIntelligence | null, kpis: KpiSummary | null): StrategyHealth {
  if (!intel || !kpis) return { executionReadiness: 0, growthPotential: 0, riskExposure: 0, forecastStrength: 0, operationalAlignment: 0, overall: 0 };
  const executionReadiness = Math.round(Math.min(95, 50 + (intel.trendConsistency * 0.3) + (intel.marginPct >= 15 ? 10 : 0)));
  const growthPotential = Math.round(Math.min(95, 45 + Math.max(0, intel.growthPct) * 2 + (intel.bestCategory ? 10 : 0)));
  const riskExposureRaw = 20 + intel.categoryConcentrationPct * 0.4 + intel.customerConcentrationPct * 0.3 + (intel.marginPct < 12 ? 15 : 0) + (intel.growthPct < 0 ? 18 : 0);
  const riskExposure = Math.round(Math.max(10, Math.min(95, riskExposureRaw)));
  const forecastStrength = Math.round(Math.min(95, 30 + intel.trendConsistency * 0.6));
  const operationalAlignment = Math.round(Math.min(95, 55 + (intel.marketingRoi ? Math.min(20, intel.marketingRoi * 2) : 10) + (intel.hasDimensions ? 10 : 0)));
  const overall = Math.round(
    (executionReadiness * 0.2 + growthPotential * 0.25 + (100 - riskExposure) * 0.2 + forecastStrength * 0.2 + operationalAlignment * 0.15),
  );
  return { executionReadiness, growthPotential, riskExposure, forecastStrength, operationalAlignment, overall };
}

// ---------- Strategy Score (dynamic, four pillars) ------------------------
/** Mission Control's headline composite. Drives downstream consumers
 *  (Boardroom, Execution Center, Reports) so they share one source of truth. */
export function strategyScore(
  intel: BusinessIntelligence | null,
  kpis: KpiSummary | null = null,
  initiatives: MissionInitiative[] = [],
): StrategyScore {
  if (!intel) {
    return {
      growthOpportunity: 0,
      executionFeasibility: 0,
      riskExposure: 0,
      forecastSupport: 0,
      overall: 0,
      verdict: "Restructure",
    };
  }
  const growth = intel.growthPct;
  // Growth Opportunity — top-line momentum + initiative-implied upside.
  const initiativeUpside = initiatives.length
    ? Math.min(25, (initiatives.reduce((a, i) => a + Math.max(0, i.revenueImpact), 0) / Math.max(1, intel.totalRevenue)) * 100)
    : 0;
  const growthOpportunity = Math.round(Math.max(0, Math.min(98,
    42
    + Math.max(-20, Math.min(25, growth)) * 1.6
    + (intel.bestCategory ? 8 : 0)
    + (intel.bestRegion ? 6 : 0)
    + initiativeUpside * 0.8,
  )));

  // Execution Feasibility — capacity to deliver: trend consistency, margin
  // headroom, average initiative effort, and KPI evidence.
  const avgEffort = initiatives.length
    ? initiatives.reduce((a, i) => a + i.effort, 0) / initiatives.length
    : 50;
  const avgConfidence = initiatives.length
    ? initiatives.reduce((a, i) => a + i.confidence, 0) / initiatives.length
    : 60;
  const executionFeasibility = Math.round(Math.max(10, Math.min(98,
    35
    + intel.trendConsistency * 0.3
    + Math.max(-10, Math.min(15, intel.marginPct - 10)) * 0.9
    + (60 - avgEffort) * 0.25
    + avgConfidence * 0.25
    + (kpis ? 4 : 0),
  )));

  // Risk Exposure — composite (lower is better; reported as raw score 0-100).
  const riskExposure = Math.round(Math.max(8, Math.min(95,
    18
    + intel.categoryConcentrationPct * 0.40
    + intel.customerConcentrationPct * 0.30
    + (intel.marginPct < 12 ? 16 : intel.marginPct < 18 ? 8 : 0)
    + (growth < 0 ? 18 : growth < 3 ? 6 : 0)
    + (intel.trendConsistency < 40 ? 10 : 0),
  )));

  // Forecast Support — trend consistency + directional momentum + upside.
  const forecastSupport = Math.round(Math.max(10, Math.min(98,
    28
    + intel.trendConsistency * 0.6
    + Math.max(0, growth) * 1.4
    + Math.min(20, intel.forecastUpsidePct) * 0.8,
  )));

  // Overall — pillars blended; risk subtracts.
  const overall = Math.round(Math.max(0, Math.min(100,
    growthOpportunity * 0.30
    + executionFeasibility * 0.25
    + (100 - riskExposure) * 0.25
    + forecastSupport * 0.20,
  )));

  let verdict: StrategyScore["verdict"];
  if (overall >= 75 && riskExposure < 55) verdict = "Aggressive Growth";
  else if (overall >= 55) verdict = "Balanced Execution";
  else if (overall >= 40) verdict = "Stabilize & Defend";
  else verdict = "Restructure";

  return { growthOpportunity, executionFeasibility, riskExposure, forecastSupport, overall, verdict };
}


// ---------- Boardroom — multi-agent debate --------------------------------
export interface BoardroomAgentResponse {
  agent: "CEO" | "CFO" | "CMO" | "COO" | "Risk" | "Forecast" | "Consultant";
  role: string;
  observation: string;
  insight: string;
  recommendation: string;
  rationale: string;
  confidence: number;
  support: number; // 0-100
}

export interface BoardDecision {
  recommendedAction: string;
  expectedRevenueImpact: string;
  expectedProfitImpact: string;
  riskLevel: "Low" | "Medium" | "High";
  recommendedOwner: string;
  timeline: string;
  confidence: number;
  consensusScore: number;
  keyAgreements: string[];
  keyDisagreements: string[];
  nextActions: string[];
}

type Theme =
  | "expansion"
  | "pricing"
  | "hiring"
  | "investment"
  | "risk"
  | "priority"
  | "customer"
  | "category"
  | "growth"
  | "cost"
  | "general";

function detectTheme(topic: string): Theme {
  const t = topic.toLowerCase();
  if (/(expand|international|new region|new market|geograph|abroad|overseas)/.test(t)) return "expansion";
  if (/(price|pricing|discount|raise prices|lower prices|reduce pric)/.test(t)) return "pricing";
  if (/(hire|hiring|headcount|salespeople|sales team|recruit|staff)/.test(t)) return "hiring";
  if (/(invest|budget|spend|marketing|advertis|campaign|capital allocation)/.test(t)) return "investment";
  if (/(risk|threat|exposure|downside|vulnerab)/.test(t)) return "risk";
  if (/(priority|focus|next quarter|top priority|what should we do)/.test(t)) return "priority";
  if (/(customer|churn|acquisition|retention|loyalty)/.test(t)) return "customer";
  if (/(category|product line|new product|launch new)/.test(t)) return "category";
  if (/(revenue|grow|growth|scale|increase sales)/.test(t)) return "growth";
  if (/(cost|cut|efficien|reduce expense|opex|overhead)/.test(t)) return "cost";
  return "general";
}

interface AgentTake {
  observation: string;
  insight: string;
  recommendation: string;
  rationale: string;
  supportBias: number;
  confidenceBias?: number;
}

function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

interface AgentCtx {
  focus: string;
  growth: number;
  baseGrowth: number;
  margin: number;
  baseMargin: number;
  rev: number;
  projRev: number;
  projProfit: number;
  revenueDelta: number;
  scenarioActive: boolean;
  s: SimulationScenario;
  intel: BusinessIntelligence | null;
  c: BusinessIntelligence["bestCategory"];
  r: BusinessIntelligence["bestRegion"];
  wr: BusinessIntelligence["worstRegion"];
  concCat: number;
  concCust: number;
  consistency: number;
  projMargin: number;
  projGrowth: number;
}

export function executiveDebate(
  topic: string,
  intel: BusinessIntelligence | null,
  scenario?: SimulationScenario | null,
): { responses: BoardroomAgentResponse[]; decision: BoardDecision } {
  const rev = intel?.totalRevenue ?? 1_000_000;
  const baseMargin = intel?.marginPct ?? 18;
  const baseGrowth = intel?.growthPct ?? 5;
  const c = intel?.bestCategory ?? null;
  const r = intel?.bestRegion ?? null;
  const wr = intel?.worstRegion ?? null;
  const focus = `${c?.name ?? "the top category"}${r ? ` in ${r.name}` : ""}`;
  const concCat = intel?.categoryConcentrationPct ?? 0;
  const concCust = intel?.customerConcentrationPct ?? 0;
  const consistency = intel?.trendConsistency ?? 60;
  const theme = detectTheme(topic);

  const s: SimulationScenario = scenario ?? { priceChangePct: 0, marketingSpendDeltaPct: 0, headcountDelta: 0, churnDeltaPct: 0 };
  const volDelta = (s.priceChangePct * -0.012) + (s.marketingSpendDeltaPct * 0.0018) + (s.headcountDelta * 0.004) + (s.churnDeltaPct * -0.006);
  const priceDelta = s.priceChangePct / 100;
  const projRev = rev * (1 + volDelta) * (1 + priceDelta);
  const revenueDelta = projRev - rev;
  const projMargin = baseMargin + s.priceChangePct * 0.7 - s.marketingSpendDeltaPct * 0.06 - s.headcountDelta * 0.05 + s.churnDeltaPct * -0.2;
  const projProfit = projRev * (projMargin / 100) - rev * (baseMargin / 100);
  const projGrowth = baseGrowth + volDelta * 100 * 0.5;
  const scenarioActive = !!scenario && (s.priceChangePct !== 0 || s.marketingSpendDeltaPct !== 0 || s.headcountDelta !== 0 || s.churnDeltaPct !== 0);
  const scenarioNote = scenarioActive
    ? ` Scenario: price ${s.priceChangePct >= 0 ? "+" : ""}${s.priceChangePct}%, marketing ${s.marketingSpendDeltaPct >= 0 ? "+" : ""}${s.marketingSpendDeltaPct}%, headcount ${s.headcountDelta >= 0 ? "+" : ""}${s.headcountDelta}, churn ${s.churnDeltaPct >= 0 ? "+" : ""}${s.churnDeltaPct}% → projected revenue ${fmtMoney(projRev)} (${revenueDelta >= 0 ? "+" : ""}${fmtMoney(revenueDelta)}), margin ${fmtPct(projMargin)}.`
    : "";

  const actx: AgentCtx = { focus, growth: projGrowth, baseGrowth, margin: projMargin, baseMargin, rev, projRev, projProfit, revenueDelta, scenarioActive, s, intel: intel ?? null, c, r, wr, concCat, concCust, consistency, projMargin, projGrowth };

  const takes: Record<BoardroomAgentResponse["agent"], AgentTake> = {
    CEO: ceoTake(theme, topic, actx),
    CFO: cfoTake(theme, topic, actx),
    CMO: cmoTake(theme, topic, actx),
    COO: cooTake(theme, topic, actx),
    Risk: riskTake(theme, topic, actx),
    Forecast: forecastTake(theme, topic, actx),
    Consultant: consultantTake(theme, topic, actx),
  };

  const baseSupports: Record<BoardroomAgentResponse["agent"], number> = {
    CEO: 70, CFO: 70, CMO: 70, COO: 70, Risk: 70, Forecast: 70, Consultant: 75,
  };

  const responses: BoardroomAgentResponse[] = (Object.keys(takes) as BoardroomAgentResponse["agent"][]).map((agent) => {
    const t = takes[agent];
    const support = clamp(baseSupports[agent] + t.supportBias + (consistency - 60) * 0.15);
    const confidence = clamp(72 + (t.confidenceBias ?? 0) + (consistency - 60) * 0.2);
    const roleMap: Record<BoardroomAgentResponse["agent"], string> = {
      CEO: "Growth · Expansion · Market Leadership",
      CFO: "Profitability · Capital Allocation · Cash Flow",
      CMO: "Demand · Brand · Channel Mix",
      COO: "Operations · Capacity · Sequencing",
      Risk: "Operational · Strategic · Concentration Risk",
      Forecast: "Projections · Scenarios · Trajectory",
      Consultant: "Strategy · Prioritization · Transformation",
    };
    return {
      agent,
      role: roleMap[agent],
      observation: t.observation + (agent === "CEO" ? scenarioNote : ""),
      insight: t.insight,
      recommendation: t.recommendation,
      rationale: t.rationale,
      confidence: Math.round(confidence),
      support: Math.round(support),
    };
  });

  const consensusScore = Math.round(responses.reduce((a, b) => a + b.support, 0) / responses.length);
  const supports = responses.filter((x) => x.support >= 75);
  const dissents = responses.filter((x) => x.support < 60);
  const conditional = responses.filter((x) => x.support >= 60 && x.support < 75);

  const riskLevel: BoardDecision["riskLevel"] =
    (theme === "expansion" && concCat >= 40) ? "High"
    : (theme === "pricing" && s.priceChangePct <= -10) ? "High"
    : (concCat >= 50 || projMargin < 10) ? "High"
    : (concCat >= 35 || consensusScore < 60) ? "Medium"
    : "Low";

  const action = boardAction(theme, { focus, s, consensusScore, intel: intel ?? null });
  const owner = ownerFor(theme);
  const timeline = timelineFor(theme);
  // Non-scenario baseline upside is grounded in the firm's realized growth band
  // (midpoint), not a fixed coefficient; falls back conservatively if no series.
  const realizedMid = intel?.upsideBandPct ? (intel.upsideBandPct.low + intel.upsideBandPct.high) / 2 / 100 : null;
  const upside = scenarioActive ? revenueDelta : rev * (realizedMid ?? 0.04);
  const profitUp = scenarioActive ? projProfit : upside * (baseMargin / 100);

  const decision: BoardDecision = {
    recommendedAction: action,
    expectedRevenueImpact: `${upside >= 0 ? "+" : ""}${fmtMoney(upside)} over 2 quarters`,
    expectedProfitImpact: `${profitUp >= 0 ? "+" : ""}${fmtMoney(profitUp)}`,
    riskLevel,
    recommendedOwner: owner,
    timeline,
    confidence: consensusScore,
    consensusScore,
    keyAgreements: buildAgreements(supports, theme, focus),
    keyDisagreements: buildDisagreements(dissents, conditional, theme, focus),
    nextActions: nextActionsFor(theme, focus, owner),
  };

  return { responses, decision };
}

// ---------- Per-agent take builders ---------------------------------------

function ceoTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { focus, growth, projRev, revenueDelta, scenarioActive, c, r, intel, baseMargin } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} Lead market ${r?.name ?? "—"} generates ${fmtMoney(r?.total ?? 0)}; expansion is a CEO-level capital decision.`,
        insight: `Expansion only compounds if the core is undefeated. We are at ${fmtPct(growth)} growth — strong enough to fund a second front, not strong enough to abandon the first.`,
        recommendation: `Approve a staged expansion: pilot one analog market for 2 quarters before committing capex.`,
        rationale: `Sequenced expansion preserves optionality; full-spectrum launch dilutes management bandwidth.`,
        supportBias: growth >= 5 ? 12 : -8,
      };
    case "pricing":
      return {
        observation: `${topic} Pricing is a one-way door for brand perception.`,
        insight: scenarioActive && revenueDelta < 0
          ? `The simulated move loses ${fmtMoney(-revenueDelta)} in revenue — that is a discount program, not a growth move.`
          : `Pricing changes should fund a strategic narrative, not patch a quarter.`,
        recommendation: scenarioActive ? `Pursue value-based pricing rather than across-the-board change; protect ${focus} list price.` : `Hold list price; capture upside via mix and bundling.`,
        rationale: `Pricing power is the cleanest signal of brand health.`,
        supportBias: scenarioActive && baseMargin < 18 ? -10 : 4,
      };
    case "hiring":
      return {
        observation: `${topic} Headcount is the most lagging lever we have.`,
        insight: `Hiring ahead of ${focus} demand is how growth companies stall; hiring behind it is how they break.`,
        recommendation: `Approve targeted hires only in revenue-producing roles tied to ${focus}; freeze G&A.`,
        rationale: `Revenue per head matters more than absolute hires.`,
        supportBias: growth >= 5 ? 8 : -10,
      };
    case "investment":
      return {
        observation: `${topic} ${focus} continues to be the highest-ROI deployment of incremental capital.`,
        insight: scenarioActive ? `Projected revenue moves to ${fmtMoney(projRev)} — that's the bar this investment must clear.` : `Spread bets at this stage usually underperform a concentrated push.`,
        recommendation: `Direct 70% of incremental capital to ${focus}; reserve 30% for asymmetric bets.`,
        rationale: `Concentration of bets is the CEO's lever; the org will not concentrate without explicit direction.`,
        supportBias: 8,
      };
    case "risk":
      return {
        observation: `${topic} The largest risk we carry is strategic, not operational.`,
        insight: `Concentration in ${c?.name ?? "the top category"} is a feature today and a liability if demand shifts.`,
        recommendation: `Sponsor an explicit diversification thesis at the next board meeting — owned by me.`,
        rationale: `The CEO must name the risk before the board will fund mitigation.`,
        supportBias: -4,
      };
    case "priority":
      return {
        observation: `${topic} We have capacity for exactly one decisive bet this cycle.`,
        insight: `${focus} is the only initiative with proven unit economics today.`,
        recommendation: `Make scaling ${focus} the company-wide top priority for the next 90 days.`,
        rationale: `Clarity at the top creates throughput at the bottom.`,
        supportBias: 14,
      };
    case "customer":
      return {
        observation: `${topic} Top-5 customers carry ${fmtPct(intel?.customerConcentrationPct ?? 0)} of revenue.`,
        insight: `Customer concentration is a slow-motion governance issue; the time to act is when growth is healthy.`,
        recommendation: `Launch a mid-market acquisition motion alongside existing enterprise focus.`,
        rationale: `Two acquisition motions hedge one another's failure modes.`,
        supportBias: (intel?.customerConcentrationPct ?? 0) >= 35 ? -6 : 6,
      };
    case "category":
      return {
        observation: `${topic} ${c?.name ?? "Top category"} has earned the right to an adjacent SKU.`,
        insight: `New categories ride existing brand permission; net-new categories typically don't.`,
        recommendation: `Approve an adjacent launch inside ${c?.name ?? "the core category"}; do not pursue an unrelated category.`,
        rationale: `Brand adjacency lowers CAC and de-risks launch.`,
        supportBias: 6,
      };
    case "growth":
      return {
        observation: `${topic} Growth currently ${fmtPct(growth)}.`,
        insight: `Doubling growth requires a 2x bet in one place, not a 1.2x bet in five.`,
        recommendation: `Commit to a measurable growth target: ${fmtPct(Math.max(10, growth + 5))} next half.`,
        rationale: `Public commitment forces internal allocation discipline.`,
        supportBias: growth >= 0 ? 10 : -6,
      };
    case "cost":
      return {
        observation: `${topic} Cost discipline buys the right to invest.`,
        insight: `Cuts that touch revenue-producing capacity repay themselves with interest — in lost revenue.`,
        recommendation: `Pursue G&A and tooling cuts; protect customer-facing capacity.`,
        rationale: `Optics matter — cuts in the wrong places signal weakness.`,
        supportBias: 4,
      };
    default:
      return {
        observation: `${topic} CEO read: ${focus} is still the central play.`,
        insight: `Without a more specific framing, default to the highest-conviction bet on the table.`,
        recommendation: `Reframe the question against ${focus} and our capital plan.`,
        rationale: `Ambiguity at the top compounds into wasted execution cycles.`,
        supportBias: 0,
      };
  }
}

function cfoTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { margin, baseMargin, projProfit, scenarioActive, s, rev } = ctx;
  switch (theme) {
    case "pricing":
      return {
        observation: `${topic} Current margin ${fmtPct(baseMargin)}, scenario projects ${fmtPct(margin)}.`,
        insight: s.priceChangePct < -5
          ? `A ${s.priceChangePct}% cut compresses margin to ${fmtPct(margin)} — that's a profit decision in the disguise of a growth decision.`
          : s.priceChangePct > 5 ? `A ${s.priceChangePct}% increase only holds if churn stays inside 2%.` : `Hold price; protect margin floor.`,
        recommendation: scenarioActive && s.priceChangePct < 0 ? `Reject the broad discount; pilot targeted pricing on lowest-elasticity cohort.` : `Approve only if payback < 12 months and margin floor ${fmtPct(Math.max(10, baseMargin - 2))} holds.`,
        rationale: `Margin is the strategic asset; revenue is the operational one.`,
        supportBias: scenarioActive && s.priceChangePct <= -10 ? -25 : margin >= baseMargin ? 4 : -12,
      };
    case "hiring":
      return {
        observation: `${topic} Each new hire commits ~$120–180k loaded cost annually.`,
        insight: s.headcountDelta > 5 ? `+${s.headcountDelta} headcount adds ~${fmtMoney(s.headcountDelta * 150000)} in run-rate cost.` : `Headcount can be backloaded to track booked revenue.`,
        recommendation: `Tie any approval to a revenue-per-head floor; revisit at 90 days.`,
        rationale: `Hires are the easiest cost to add and the hardest to remove.`,
        supportBias: scenarioActive && s.headcountDelta > 8 ? -18 : 6,
      };
    case "investment":
      return {
        observation: `${topic} Marketing spend ${s.marketingSpendDeltaPct >= 0 ? "+" : ""}${s.marketingSpendDeltaPct}% in scenario.`,
        insight: `Marketing investment must be ROI-gated, not narrative-gated.`,
        recommendation: `Approve incremental marketing only with channel-level payback < 9 months.`,
        rationale: `Unmeasured marketing is the most common margin leak at this scale.`,
        supportBias: s.marketingSpendDeltaPct > 25 ? -14 : 4,
      };
    case "expansion":
      return {
        observation: `${topic} Expansion is capex + opex + opportunity cost.`,
        insight: `A second market typically takes 4 quarters to pay back; underwrite accordingly.`,
        recommendation: `Approve only the pilot tranche; release Phase 2 capital against milestone gates.`,
        rationale: `Tranche-based funding is how we protect optionality.`,
        supportBias: -6,
      };
    case "risk":
      return {
        observation: `${topic} Financial risk centers on margin durability at ${fmtPct(baseMargin)}.`,
        insight: `A single 200 bps margin compression equals ${fmtMoney(rev * 0.02)} of profit.`,
        recommendation: `Stand up a monthly margin-walk review owned by Finance.`,
        rationale: `Visibility is the cheapest hedge available to us.`,
        supportBias: 6,
      };
    case "customer":
      return {
        observation: `${topic} Customer concentration is a credit risk, not just a sales risk.`,
        insight: `Loss of any top-5 customer threatens covenants and forecast credibility.`,
        recommendation: `Diversify aggressively; finance the motion from G&A savings.`,
        rationale: `Concentration is uniquely punished by lenders and acquirers.`,
        supportBias: 8,
      };
    case "cost":
      return {
        observation: `${topic} Cost program candidates: tooling, vendor consolidation, contractor base.`,
        insight: `2–3% blended cost reduction is the realistic floor without touching capacity.`,
        recommendation: `Approve a zero-based vendor review with a 60-day reporting cadence.`,
        rationale: `Zero-based is the only review that produces real savings.`,
        supportBias: 14,
      };
    case "growth":
      return {
        observation: `${topic} Growth without margin discipline is destruction in slow motion.`,
        insight: `Projected profit move: ${fmtMoney(projProfit)} under current scenario.`,
        recommendation: `Approve growth bets above ${fmtPct(baseMargin)} contribution margin only.`,
        rationale: `Margin-gated growth is the only sustainable growth.`,
        supportBias: projProfit >= 0 ? 6 : -10,
      };
    default:
      return {
        observation: `${topic} CFO-frame: every yes is a no to something else.`,
        insight: `Capital allocation is the question behind the question.`,
        recommendation: `Score the request against our top-3 capital priorities before approving.`,
        rationale: `Discipline at the gate beats discipline after the fact.`,
        supportBias: 0,
      };
  }
}

function cmoTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { focus, c, r, scenarioActive, s, intel, projRev } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} ${r?.name ?? "Lead market"} is brand-validated; analog markets unproven.`,
        insight: `Brand permission is geographic — it does not travel automatically.`,
        recommendation: `Pilot brand-building campaign in one analog market before commercial expansion.`,
        rationale: `Brand-led entry compresses CAC payback by 30–40%.`,
        supportBias: 8,
      };
    case "pricing":
      return {
        observation: `${topic} Pricing is a brand signal as much as a P&L lever.`,
        insight: s.priceChangePct < 0 ? `Discounting trains the market to wait.` : `Premium positioning needs proof, not just price.`,
        recommendation: scenarioActive && s.priceChangePct < 0 ? `Replace blanket discount with bundling that protects perceived value.` : `Test value-tier ladder before any list-price move.`,
        rationale: `Mix is more durable than price.`,
        supportBias: scenarioActive && s.priceChangePct < -5 ? -10 : 6,
      };
    case "hiring":
      return {
        observation: `${topic} Demand is the constraint long before headcount is.`,
        insight: `More sellers without more pipeline produces lower productivity per seller.`,
        recommendation: `Invest in demand generation 1 quarter before any sales hiring wave.`,
        rationale: `Sequencing demand → capacity is the marketing-first playbook.`,
        supportBias: 4,
      };
    case "investment":
      return {
        observation: `${topic} Scenario: marketing ${s.marketingSpendDeltaPct >= 0 ? "+" : ""}${s.marketingSpendDeltaPct}%.`,
        insight: `Reweight upper-funnel toward ${focus}; this is where the brand has earned attention.`,
        recommendation: `Reallocate, then add. Cleanest budget gain is mix change, not topline.`,
        rationale: `Reallocation has no incremental risk and ~80% of the upside.`,
        supportBias: s.marketingSpendDeltaPct >= 0 ? 12 : -8,
      };
    case "risk":
      return {
        observation: `${topic} Brand risk is the silent risk — no one tracks it monthly.`,
        insight: `Concentration ${fmtPct(intel?.categoryConcentrationPct ?? 0)} in ${c?.name ?? "category"} also concentrates brand identity.`,
        recommendation: `Stand up a brand health tracker; treat it as a board-level KPI.`,
        rationale: `What is unmeasured tends to decay.`,
        supportBias: 4,
      };
    case "priority":
      return {
        observation: `${topic} Demand signals strongest in ${focus}.`,
        insight: `One narrative, one wedge, one number — that's how marketing compounds.`,
        recommendation: `Adopt ${focus} as the single GTM narrative for 2 quarters.`,
        rationale: `Story focus is the cheapest demand multiplier we have.`,
        supportBias: 12,
      };
    case "customer":
      return {
        observation: `${topic} Acquisition vs retention split needs an explicit decision.`,
        insight: `Retention motion at our stage usually returns 3x acquisition spend.`,
        recommendation: `Allocate 30% of marketing to retention/expansion; treat as growth, not service.`,
        rationale: `Retention is the most under-marketed line item in B2B.`,
        supportBias: 6,
      };
    case "category":
      return {
        observation: `${topic} Customers in ${c?.name ?? "core"} are asking for adjacencies.`,
        insight: `Adjacent SKU launches reuse 70% of existing brand assets.`,
        recommendation: `Launch adjacent SKU under existing brand; do not stand up a new one.`,
        rationale: `Brand reuse is the highest-leverage launch move.`,
        supportBias: 10,
      };
    case "growth":
      return {
        observation: `${topic} Projected revenue ${fmtMoney(projRev)} under scenario.`,
        insight: `Growth lives at the intersection of narrative clarity and channel concentration.`,
        recommendation: `Double down on top-2 channels; cut the bottom-2.`,
        rationale: `Channel proliferation is a tax we do not need to pay.`,
        supportBias: 10,
      };
    case "cost":
      return {
        observation: `${topic} Marketing cuts compound for 3+ quarters.`,
        insight: `Brand cuts now show up as pipeline holes in 2 quarters.`,
        recommendation: `Cut tooling and agency, protect demand-gen budget.`,
        rationale: `The wrong marketing cut is harder to undo than a hire.`,
        supportBias: -8,
      };
    default:
      return {
        observation: `${topic} Marketing frame: where is the demand strongest and most under-served?`,
        insight: `${focus} is the cleanest demand wedge today.`,
        recommendation: `Reweight mix toward ${focus} before adding spend.`,
        rationale: `Reallocation is risk-free upside.`,
        supportBias: 4,
      };
  }
}

function cooTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { focus, scenarioActive, s } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} Operationally we can run one new market without breaking SLAs.`,
        insight: `Two simultaneous expansions degrade both — capacity is the silent killer.`,
        recommendation: `Sequence: market 1 live, market 2 scoped — not parallel launches.`,
        rationale: `Sequencing trades calendar time for execution risk.`,
        supportBias: 8,
      };
    case "hiring":
      return {
        observation: `${topic} Onboarding ramp at our stage is 60–90 days to productivity.`,
        insight: s.headcountDelta > 8 ? `Adding ${s.headcountDelta} people simultaneously will overwhelm onboarding capacity.` : `A measured hiring wave can absorb cleanly.`,
        recommendation: scenarioActive && s.headcountDelta > 8 ? `Stagger hiring across 2 quarters; raise onboarding capacity first.` : `Approve in two waves; raise onboarding standards.`,
        rationale: `Productivity per hire is the metric to manage.`,
        supportBias: scenarioActive && s.headcountDelta > 10 ? -12 : 6,
      };
    case "pricing":
      return {
        observation: `${topic} Pricing changes ripple into ops: billing, support, comp plans.`,
        insight: `Lead time on operational rollout is 4–6 weeks minimum.`,
        recommendation: `Approve pricing change with a 6-week ops runway; do not surprise the org.`,
        rationale: `Operational surprises are how pricing changes go wrong.`,
        supportBias: 4,
      };
    case "investment":
      return {
        observation: `${topic} Capacity headroom exists in ${focus}; bottleneck is sales coverage.`,
        insight: `Investment should buy throughput, not novelty.`,
        recommendation: `Direct investment toward removing the binding constraint, not adding capability.`,
        rationale: `Operations rewards removing bottlenecks more than adding features.`,
        supportBias: 8,
      };
    case "risk":
      return {
        observation: `${topic} Operational risk concentration tracks revenue concentration.`,
        insight: `A single-vendor or single-process dependency surfaces only under stress.`,
        recommendation: `Run a controlled failure drill on top-3 operational dependencies.`,
        rationale: `Drills find dependencies that documents miss.`,
        supportBias: 4,
      };
    case "priority":
      return {
        observation: `${topic} The org can absorb exactly one strategic initiative this cycle.`,
        insight: `Two parallel strategic bets typically lose 30%+ of either's value.`,
        recommendation: `Pick one. Build the operating cadence around it.`,
        rationale: `Single-focus is the highest-leverage operating choice.`,
        supportBias: 14,
      };
    case "cost":
      return {
        observation: `${topic} Process simplification is the cleanest cost lever we have.`,
        insight: `Tooling sprawl masks 5–10% recoverable spend.`,
        recommendation: `Approve tooling consolidation with a 90-day deadline.`,
        rationale: `Consolidation pays back inside the fiscal year.`,
        supportBias: 12,
      };
    default:
      return {
        observation: `${topic} Operationally: what is the binding constraint?`,
        insight: `Removing the constraint beats adding capacity every time.`,
        recommendation: `Identify and remove the top constraint before approving net-new capacity.`,
        rationale: `Constraint thinking is the operating discipline.`,
        supportBias: 4,
      };
  }
}

function riskTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { concCat, concCust, margin, growth, scenarioActive, s } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} Expansion adds market, FX, and execution risk simultaneously.`,
        insight: `Concentration today (category ${fmtPct(concCat)}) means we cannot also concentrate execution risk.`,
        recommendation: `Approve only with explicit market-exit criteria and quarterly stress test.`,
        rationale: `Exit criteria turn an experiment into a controlled risk.`,
        supportBias: concCat >= 45 ? -12 : -4,
      };
    case "pricing":
      return {
        observation: `${topic} Pricing risk = churn risk + brand risk + competitive response.`,
        insight: s.priceChangePct < 0 ? `Discounts invite competitor matching faster than they win share.` : `Increases without value story drive accelerated churn.`,
        recommendation: scenarioActive && Math.abs(s.priceChangePct) >= 10 ? `Reject blanket move; pilot in lowest-risk cohort only.` : `Pilot the change; instrument churn weekly.`,
        rationale: `Pricing risk is asymmetric — downside is bigger than upside.`,
        supportBias: scenarioActive && Math.abs(s.priceChangePct) >= 10 ? -18 : -4,
      };
    case "risk":
      return {
        observation: `${topic} Top risks: category concentration ${fmtPct(concCat)}, customer concentration ${fmtPct(concCust)}, margin ${fmtPct(margin)}.`,
        insight: `The dominant risk is strategic concentration, not operational fragility.`,
        recommendation: `Stand up a diversification gate at 50% category share and 35% top-5 customer share.`,
        rationale: `Gates trigger action; reports trigger meetings.`,
        supportBias: 14,
      };
    case "hiring":
      return {
        observation: `${topic} Hiring risk is two-sided: too few = capacity gap, too many = margin shock.`,
        insight: s.headcountDelta > 8 ? `+${s.headcountDelta} heads concentrates risk inside one fiscal year.` : `Modest hiring stays inside the absorbable risk envelope.`,
        recommendation: `Cap incremental hiring at +${Math.min(8, Math.max(2, Math.round((s.headcountDelta || 0) / 2)))} this cycle.`,
        rationale: `Cap-and-review beats hire-and-hope.`,
        supportBias: scenarioActive && s.headcountDelta > 10 ? -10 : 2,
      };
    case "investment":
      return {
        observation: `${topic} Marketing investment risk is measurement risk.`,
        insight: `Unmeasured incremental spend tends to fund noise.`,
        recommendation: `Approve incremental spend only when channel attribution is in place.`,
        rationale: `Measurement is the cheapest hedge against marketing waste.`,
        supportBias: -4,
      };
    case "customer":
      return {
        observation: `${topic} Top-5 customers carry ${fmtPct(concCust)} of revenue.`,
        insight: `Customer concentration is the highest-impact, lowest-monitored risk we have.`,
        recommendation: `Adopt a quarterly customer-at-risk review tied to renewal cycles.`,
        rationale: `Renewal cycles are the leading indicator of revenue risk.`,
        supportBias: concCust >= 35 ? -8 : 8,
      };
    case "growth":
      return {
        observation: `${topic} Growth at ${fmtPct(growth)} with margin ${fmtPct(margin)}.`,
        insight: `Growth funded by margin compression is borrowed growth.`,
        recommendation: `Maintain margin floor as growth-bet precondition.`,
        rationale: `Borrowed growth has to be repaid at the worst time.`,
        supportBias: margin >= 15 ? 4 : -10,
      };
    case "cost":
      return {
        observation: `${topic} Cost cuts that touch resilience are the most expensive ones.`,
        insight: `Cuts to incident response, redundancy, or testing tend to surface within 2 quarters.`,
        recommendation: `Approve cost program with a resilience-impact review for each line.`,
        rationale: `Resilience cuts always feel cheap until they don't.`,
        supportBias: 0,
      };
    default:
      return {
        observation: `${topic} Default risk frame: what breaks if we are wrong?`,
        insight: `Severity of being wrong dominates probability of being right at this scale.`,
        recommendation: `Stage decisions with rollback criteria.`,
        rationale: `Reversibility is the most underrated risk control.`,
        supportBias: 0,
      };
  }
}

function forecastTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { growth, baseGrowth, consistency, scenarioActive, projRev, rev } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} Forecast hit-rate degrades 15–25% in unfamiliar markets in year 1.`,
        insight: `Plan and reforecast cadence matters more than the initial number.`,
        recommendation: `Build a separate forecast track for the new market with monthly recalibration.`,
        rationale: `Mixing forecasts hides early signal in expansion.`,
        supportBias: 4,
      };
    case "pricing":
      return {
        observation: `${topic} Scenario projects revenue ${fmtMoney(projRev)} vs current ${fmtMoney(rev)}.`,
        insight: `Forecast variance from pricing moves is typically ±20% in the first two periods.`,
        recommendation: `Approve with 4-week reforecast cadence and explicit churn signal.`,
        rationale: `Faster cadence converts forecast variance into operational signal.`,
        supportBias: scenarioActive ? -2 : 4,
      };
    case "hiring":
      return {
        observation: `${topic} Ramp curves are the dominant forecast variable in sales hiring.`,
        insight: `Productivity per hire typically tracks 0.4 of senior baseline in quarter 1.`,
        recommendation: `Model hiring with explicit ramp curves; do not assume linear contribution.`,
        rationale: `Forecast realism is what saves operating plans.`,
        supportBias: 2,
      };
    case "investment":
      return {
        observation: `${topic} Marketing payback distributions are right-skewed.`,
        insight: `Median payback understates the tail; plan for median, not mean.`,
        recommendation: `Underwrite to median payback; flag tail as upside.`,
        rationale: `Mean-based plans miss more often than they hit.`,
        supportBias: 2,
      };
    case "growth":
      return {
        observation: `${topic} Trend consistency ${consistency}/100; growth ${fmtPct(baseGrowth)}.`,
        insight: `Forecast supports continued momentum; ${consistency < 55 ? "but consistency is low, so widen the band." : "with current consistency, narrow the band."}`,
        recommendation: `Rebuild rolling 13-week forecast tree and recommit quarterly.`,
        rationale: `Cadence beats accuracy for executive decisions.`,
        supportBias: consistency >= 60 ? 8 : -4,
      };
    case "risk":
      return {
        observation: `${topic} Forecast risk concentrates around month-3 of any new initiative.`,
        insight: `Month-3 is when ramp assumptions get tested for the first time.`,
        recommendation: `Pre-commit to a month-3 forecast review for any approved initiative.`,
        rationale: `Pre-committed reviews are the cheapest discipline available.`,
        supportBias: 6,
      };
    case "priority":
      return {
        observation: `${topic} Single-focus plans hit forecast at 75–85% rate; multi-focus plans at 50–60%.`,
        insight: `The forecast itself argues for fewer simultaneous bets.`,
        recommendation: `Choose the bet with the narrowest forecast band.`,
        rationale: `Narrow forecasts are the easiest to defend.`,
        supportBias: 8,
      };
    case "customer":
      return {
        observation: `${topic} Forecast volatility is dominated by top-5 renewal timing.`,
        insight: `Diversification compresses forecast variance directly.`,
        recommendation: `Track top-5 renewal calendar as a board-level dashboard item.`,
        rationale: `Renewal calendar is the most underrated forecast tool.`,
        supportBias: 6,
      };
    case "cost":
      return {
        observation: `${topic} Cost cuts are easier to forecast than revenue programs.`,
        insight: `Cost programs typically hit 80% of stated target on time.`,
        recommendation: `Forecast at 80% capture; treat overage as upside.`,
        rationale: `Conservative cost forecasts protect operating plans.`,
        supportBias: 8,
      };
    default:
      return {
        observation: `${topic} Forecast frame: what is the band, and where is the most uncertainty?`,
        insight: `Trend ${growth >= 0 ? "supports" : "opposes"} the move at ${fmtPct(growth)}.`,
        recommendation: `Pair any approval with a 30/60/90 reforecast schedule.`,
        rationale: `Schedule is the strategy.`,
        supportBias: 2,
      };
  }
}

function consultantTake(theme: Theme, topic: string, ctx: AgentCtx): AgentTake {
  const { focus, intel, scenarioActive, projMargin, projGrowth } = ctx;
  switch (theme) {
    case "expansion":
      return {
        observation: `${topic} Comparable expansions succeed when core market share > 25%.`,
        insight: `Without dominance in the core, expansion is a distraction.`,
        recommendation: `Defer expansion until ${focus} market share crosses the dominance threshold.`,
        rationale: `Strategic patience is undervalued at our stage.`,
        supportBias: -4,
      };
    case "pricing":
      return {
        observation: `${topic} Pricing strategies that succeed: value-based ladders; that fail: blanket adjustments.`,
        insight: scenarioActive && projMargin < 12 ? `Scenario margin (${fmtPct(projMargin)}) erodes strategic optionality.` : `Pricing strategy is portfolio strategy.`,
        recommendation: `Adopt a 3-tier ladder; deprecate single-list pricing.`,
        rationale: `Ladders make sales conversations strategic, not transactional.`,
        supportBias: 6,
      };
    case "priority":
      return {
        observation: `${topic} Best strategy at our stage: depth over breadth, for 2 more quarters.`,
        insight: `Depth compounds; breadth fragments.`,
        recommendation: `Approve ${focus} as the singular strategic priority through next half.`,
        rationale: `Strategic clarity is itself a competitive advantage.`,
        supportBias: 16,
      };
    case "risk":
      return {
        observation: `${topic} Strategic risk dwarfs operational risk at this stage.`,
        insight: `Concentration in ${intel?.bestCategory?.name ?? "the top category"} should be intentional, not accidental.`,
        recommendation: `Formalize the concentration thesis with explicit exit criteria.`,
        rationale: `Named risks are managed risks.`,
        supportBias: 6,
      };
    case "hiring":
      return {
        observation: `${topic} Best practice: hire to a documented strategy, not to capacity gut feel.`,
        insight: `Approve hiring only when each slot maps to a named initiative.`,
        recommendation: `Reject any hire not mapped to a strategic priority.`,
        rationale: `Hiring discipline is strategy discipline.`,
        supportBias: 4,
      };
    case "investment":
      return {
        observation: `${topic} Capital should follow proven economics — not narrative excitement.`,
        insight: `${focus} has earned more capital; underperforming segments have not.`,
        recommendation: `Reweight portfolio toward proven winners; sunset losers on a 60-day gate.`,
        rationale: `Strategic capital allocation is the highest-impact CEO lever.`,
        supportBias: 12,
      };
    case "customer":
      return {
        observation: `${topic} Best-in-class peers carry top-5 customer concentration below 30%.`,
        insight: `Our concentration is a near-term strength and a medium-term constraint.`,
        recommendation: `Adopt a 4-quarter program to bring top-5 share below 30%.`,
        rationale: `Stage-appropriate diversification is governance, not growth.`,
        supportBias: 8,
      };
    case "category":
      return {
        observation: `${topic} Adjacencies outperform new categories by ~3x at our scale.`,
        insight: `Adjacency is brand reuse; new category is brand investment.`,
        recommendation: `Launch adjacent, not net-new. Defer net-new category to FY+1.`,
        rationale: `Sequenced category strategy preserves brand equity.`,
        supportBias: 10,
      };
    case "growth":
      return {
        observation: `${topic} Companies hitting ${fmtPct(Math.max(10, projGrowth + 5))}+ growth at our stage typically concentrate, not diversify.`,
        insight: `Concentration is the leading indicator of acceleration.`,
        recommendation: `Set the explicit growth target; reorganize against it.`,
        rationale: `Public targets force private allocation.`,
        supportBias: 10,
      };
    case "cost":
      return {
        observation: `${topic} Cost programs work when paired with a growth narrative.`,
        insight: `Cuts without narrative trigger talent flight; cuts with narrative trigger focus.`,
        recommendation: `Anchor the program in a growth-funding story.`,
        rationale: `Narrative is the cheapest change-management tool.`,
        supportBias: 8,
      };
    default:
      return {
        observation: `${topic} Strategy frame: what is the simplest story we can tell about ${focus}?`,
        insight: `If we cannot tell the story in one sentence, we do not yet have the strategy.`,
        recommendation: `Reduce the strategy to one sentence; reorganize around it.`,
        rationale: `Clarity is the multiplier.`,
        supportBias: 6,
      };
  }
}

function boardAction(theme: Theme, ctx: { focus: string; s: SimulationScenario; consensusScore: number; intel: BusinessIntelligence | null }): string {
  const { focus, s, consensusScore, intel } = ctx;
  const lead = consensusScore >= 70 ? "Approve" : consensusScore >= 55 ? "Conditionally approve" : "Reject as scoped; rework";
  switch (theme) {
    case "expansion":
      return `${lead} a staged expansion pilot — one analog market, 2 quarters, with exit criteria — while continuing to scale ${focus}.`;
    case "pricing":
      return `${lead} pricing change — replace any blanket move (${s.priceChangePct >= 0 ? "+" : ""}${s.priceChangePct}%) with a tiered pricing ladder; protect ${focus} list price.`;
    case "hiring":
      return `${lead} a capped hiring wave (+${Math.min(8, Math.max(0, s.headcountDelta))} max) tied to revenue-per-head floor and ${focus} demand.`;
    case "investment":
      return `${lead} incremental investment with 70% directed to ${focus}; channel-level payback gates < 9 months.`;
    case "risk":
      return `${lead} a diversification gate (category 50%, top-5 customers 35%) with quarterly stress test; CRO + Risk co-owned.`;
    case "priority":
      return `${lead} scaling ${focus} as the single company-wide priority for the next 90 days.`;
    case "customer":
      return `${lead} a mid-market acquisition motion to bring top-5 customer concentration below 30% within 4 quarters.`;
    case "category":
      return `${lead} an adjacent SKU launch inside ${intel?.bestCategory?.name ?? "the core category"}; defer net-new category.`;
    case "growth":
      return `${lead} a measurable growth commitment and reorganize allocation around ${focus}.`;
    case "cost":
      return `${lead} a zero-based vendor and tooling review with a 90-day deadline; protect customer-facing capacity.`;
    default:
      return `${lead} a focused 90-day plan to scale ${focus} with margin guardrails and explicit gates.`;
  }
}

function ownerFor(theme: Theme): string {
  switch (theme) {
    case "expansion": return "Chief Operating Officer";
    case "pricing": return "Chief Financial Officer";
    case "hiring": return "Chief People Officer";
    case "investment": return "Chief Marketing Officer";
    case "risk": return "Chief Risk Officer";
    case "customer": return "Chief Revenue Officer";
    case "category": return "Chief Product Officer";
    case "cost": return "Chief Financial Officer";
    default: return "Chief Revenue Officer";
  }
}

function timelineFor(theme: Theme): string {
  switch (theme) {
    case "expansion": return "180 days, staged pilot";
    case "pricing": return "60 days, weekly churn signal";
    case "hiring": return "Two waves across 2 quarters";
    case "cost": return "90 days, monthly progress";
    case "risk": return "Quarterly stress test cadence";
    default: return "90 days, monthly review";
  }
}

function buildAgreements(supports: BoardroomAgentResponse[], theme: Theme, focus: string): string[] {
  const out: string[] = [];
  if (supports.length >= 4) out.push(`${supports.length} of 7 agents support the proposal`);
  out.push(`Scaling ${focus} remains the highest-conviction lever`);
  if (theme === "expansion") out.push("Staged expansion preferred over parallel launches");
  if (theme === "pricing") out.push("Tiered ladder preferred over blanket pricing changes");
  if (theme === "hiring") out.push("Revenue-per-head floor must precede any hiring wave");
  if (theme === "risk") out.push("Concentration gates must be explicit and instrumented");
  if (theme === "priority") out.push("Single-focus cadence is the operating preference");
  if (theme === "investment") out.push("Capital follows proven unit economics");
  return out.slice(0, 4);
}

function buildDisagreements(dissents: BoardroomAgentResponse[], conditional: BoardroomAgentResponse[], theme: Theme, focus: string): string[] {
  const out: string[] = [];
  if (dissents.length) out.push(`${dissents.map((d) => d.agent).join(", ")} oppose the scoped proposal`);
  if (conditional.length) out.push(`${conditional.map((d) => d.agent).join(", ")} conditional — want explicit gates`);
  if (theme === "pricing") out.push("CFO vs CMO: margin protection vs demand acceleration");
  if (theme === "expansion") out.push("Risk vs CMO: caution on FX/execution vs brand momentum");
  if (theme === "hiring") out.push("CFO vs CEO: payback gate vs capacity ahead of demand");
  if (!out.length) out.push(`Pace of execution against ${focus}`);
  return out.slice(0, 3);
}

function nextActionsFor(theme: Theme, focus: string, owner: string): string[] {
  const base = [`${owner} to publish 30-day execution plan within 7 days`];
  switch (theme) {
    case "expansion":
      return [...base, "COO to scope analog market shortlist", "Risk Agent to define exit criteria", "Forecast Agent to build market-specific tree"];
    case "pricing":
      return [...base, "CFO to publish margin floor", "CMO to design tiered ladder", "Forecast to instrument weekly churn signal"];
    case "hiring":
      return [...base, "CFO to set revenue-per-head floor", "COO to raise onboarding capacity", "CMO to confirm demand readiness"];
    case "investment":
      return [...base, "CFO to set payback gates", "CMO to map channel-level attribution", "Forecast Agent to underwrite returns"];
    case "risk":
      return [...base, "Risk Agent to publish gate criteria", "Forecast Agent to set stress-test cadence", "CFO to align covenant view"];
    case "priority":
      return [...base, `CRO to define ${focus} 90-day pilot scope and KPIs`, "All functions to align quarterly OKRs", "Forecast Agent to rebuild scenario tree"];
    case "customer":
      return [...base, "CRO to launch mid-market motion", "Risk Agent to track renewal calendar", "CFO to model concentration glide path"];
    case "cost":
      return [...base, "CFO to lead zero-based review", "COO to consolidate tooling", "CMO to protect demand-gen line items"];
    default:
      return [...base, `CRO to define ${focus} pilot scope`, "Forecast to rebuild scenario tree", "Risk to set guardrails"];
  }
}

