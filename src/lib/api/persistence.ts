// Persistence API. Thin client wrappers over the Aurora-backed server functions
// (src/lib/db/data.functions.ts). Public signatures are unchanged so routes are
// untouched; the storage engine is Amazon Aurora PostgreSQL via Vercel.
import type {
  ActionPlan,
  CeoBrief,
  ConsultantReport,
  DecisionSimulation,
  ExecutiveDecision,
  DecisionStatus,
  DecisionOutcome,
  Forecast,
  GeneratedReport,
  KpiSummary,
  BoardroomConversation,
} from "./types";
import {
  dbSaveKpiSummary,
  dbLatestKpiSummary,
  dbSaveForecast,
  dbSaveCeoBrief,
  dbLatestCeoBrief,
  dbSaveConsultantReport,
  dbLatestConsultantReport,
  dbSaveSimulation,
  dbListSimulations,
  dbSaveBoardroom,
  dbListBoardroom,
  dbUpsertActionPlan,
  dbListActionPlans,
  dbListReports,
  dbSaveReport,
  dbSaveExecutiveDecision,
  dbListExecutiveDecisions,
  dbUpdateExecutiveDecision,
  dbDeleteExecutiveDecision,
  dbRecordDecisionOutcome,
} from "@/lib/db/data.functions";

export async function saveKpiSummary(dataset_id: string, summary: KpiSummary) {
  await dbSaveKpiSummary({ data: { dataset_id, metrics: summary } });
}

export async function latestKpiSummary(dataset_id: string): Promise<KpiSummary | null> {
  return (await dbLatestKpiSummary({ data: { dataset_id } })) as unknown as KpiSummary | null;
}

export async function saveForecast(dataset_id: string, forecast: Forecast) {
  await dbSaveForecast({ data: { dataset_id, horizon: forecast.horizon, series: forecast.series } });
}

export async function saveCeoBrief(brief: Omit<CeoBrief, "id" | "created_at">) {
  return (await dbSaveCeoBrief({
    data: {
      dataset_id: brief.dataset_id,
      summary: brief.summary,
      risks: brief.risks,
      opportunities: brief.opportunities,
      priorities: brief.priorities,
      forecast_highlights: brief.forecast_highlights,
      health_score: brief.health_score,
      meta: brief.meta,
    },
  })) as unknown as CeoBrief;
}

export async function latestCeoBrief(dataset_id: string): Promise<CeoBrief | null> {
  return (await dbLatestCeoBrief({ data: { dataset_id } })) as unknown as CeoBrief | null;
}

export async function saveConsultantReport(report: Omit<ConsultantReport, "id" | "created_at">) {
  return (await dbSaveConsultantReport({
    data: {
      dataset_id: report.dataset_id,
      problems: report.problems,
      recommendations: report.recommendations,
      impact_score: report.impact_score,
      roi_score: report.roi_score,
      risk_score: report.risk_score,
      investment_thesis: report.investment_thesis ?? null,
      meta: report.meta,
    },
  })) as unknown as ConsultantReport;
}

export async function latestConsultantReport(dataset_id: string): Promise<ConsultantReport | null> {
  return (await dbLatestConsultantReport({ data: { dataset_id } })) as unknown as ConsultantReport | null;
}

export async function saveSimulation(sim: Omit<DecisionSimulation, "id" | "created_at">) {
  return (await dbSaveSimulation({
    data: {
      dataset_id: sim.dataset_id,
      name: sim.name,
      scenario: sim.scenario,
      revenue_impact: sim.revenue_impact,
      profit_impact: sim.profit_impact,
      risk: sim.risk,
      confidence: sim.confidence,
    },
  })) as unknown as DecisionSimulation;
}
export async function listSimulations(dataset_id: string): Promise<DecisionSimulation[]> {
  return (await dbListSimulations({ data: { dataset_id } })) as unknown as DecisionSimulation[];
}

export async function saveBoardroom(conv: Omit<BoardroomConversation, "id" | "created_at">) {
  return (await dbSaveBoardroom({ data: { dataset_id: conv.dataset_id, topic: conv.topic, messages: conv.messages } })) as unknown as BoardroomConversation;
}
export async function listBoardroom(dataset_id: string | null): Promise<BoardroomConversation[]> {
  return (await dbListBoardroom({ data: { dataset_id } })) as unknown as BoardroomConversation[];
}

export async function upsertActionPlan(plan: Omit<ActionPlan, "id" | "created_at" | "updated_at"> & { id?: string }) {
  return (await dbUpsertActionPlan({
    data: { id: plan.id, dataset_id: plan.dataset_id, horizon_days: plan.horizon_days, initiatives: plan.initiatives, progress: plan.progress },
  })) as unknown as ActionPlan;
}
export async function listActionPlans(dataset_id: string | null): Promise<ActionPlan[]> {
  return (await dbListActionPlans({ data: { dataset_id } })) as unknown as ActionPlan[];
}

export async function listReports(): Promise<GeneratedReport[]> {
  return (await dbListReports()) as unknown as GeneratedReport[];
}
export async function saveReport(rec: Omit<GeneratedReport, "id" | "created_at">) {
  return (await dbSaveReport({ data: { dataset_id: rec.dataset_id, kind: rec.kind, title: rec.title, storage_path: rec.storage_path } })) as unknown as GeneratedReport;
}

// ============== Executive Decisions (Executive Memory Engine) ==============
export interface SaveExecutiveDecisionInput {
  dataset_id: string | null;
  conversation_id?: string | null;
  question: string;
  decision: string;
  consensus_score: number;
  confidence_score: number;
  revenue_impact?: string | null;
  profit_impact?: string | null;
  risk_level: "Low" | "Medium" | "High";
  owner?: string | null;
  timeline?: string | null;
  next_actions: string[];
}

export async function saveExecutiveDecision(d: SaveExecutiveDecisionInput): Promise<ExecutiveDecision> {
  return (await dbSaveExecutiveDecision({ data: d })) as unknown as ExecutiveDecision;
}

export async function listExecutiveDecisions(dataset_id: string | null): Promise<ExecutiveDecision[]> {
  return (await dbListExecutiveDecisions({ data: { dataset_id } })) as unknown as ExecutiveDecision[];
}

export async function updateExecutiveDecision(
  id: string,
  patch: Partial<Pick<ExecutiveDecision, "status" | "progress" | "owner" | "timeline" | "due_date">>,
): Promise<void> {
  await dbUpdateExecutiveDecision({ data: { id, patch } });
}

export async function deleteExecutiveDecision(id: string): Promise<void> {
  await dbDeleteExecutiveDecision({ data: { id } });
}

export async function updateDecisionStatus(id: string, status: DecisionStatus): Promise<void> {
  const progress = status === "Completed" ? 100 : status === "In Progress" ? 50 : status === "Blocked" ? 25 : 0;
  await updateExecutiveDecision(id, { status, progress });
}

export async function recordDecisionOutcome(
  id: string,
  patch: { outcome: DecisionOutcome; actual_value?: number | null; outcome_notes?: string | null },
): Promise<void> {
  await dbRecordDecisionOutcome({ data: { id, outcome: patch.outcome, actual_value: patch.actual_value ?? null, outcome_notes: patch.outcome_notes ?? null } });
}

// Real hit-rate: of decisions with a recorded outcome, the share that were wins
// (a "mixed" counts as half). Returns null when nothing has been graded yet.
export function computeDecisionHitRate(
  decisions: Array<{ outcome?: ExecutiveDecision["outcome"] }>,
): { graded: number; wins: number; hitRate: number } | null {
  const graded = decisions.filter((d) => d.outcome === "win" || d.outcome === "loss" || d.outcome === "mixed");
  if (!graded.length) return null;
  const score = graded.reduce((a, d) => a + (d.outcome === "win" ? 1 : d.outcome === "mixed" ? 0.5 : 0), 0);
  return { graded: graded.length, wins: graded.filter((d) => d.outcome === "win").length, hitRate: Math.round((score / graded.length) * 100) };
}
