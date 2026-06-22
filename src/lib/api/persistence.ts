import { supabase } from "@/integrations/supabase/client";
import type {
  ActionPlan,
  CeoBrief,
  ConsultantReport,
  DecisionSimulation,
  ExecutiveDecision,
  DecisionStatus,
  Forecast,
  GeneratedReport,
  KpiSummary,
  BoardroomConversation,
} from "./types";

// Generic helpers persisting AI/analytics results to the database.
// All scoped by dataset_id and ordered by created_at desc.

export async function saveKpiSummary(dataset_id: string, summary: KpiSummary) {
  const { error } = await supabase.from("kpi_summaries").insert({
    dataset_id,
    metrics: summary as unknown as never,
  });
  if (error) throw error;
}

export async function latestKpiSummary(dataset_id: string): Promise<KpiSummary | null> {
  const { data, error } = await supabase
    .from("kpi_summaries")
    .select("metrics")
    .eq("dataset_id", dataset_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.metrics as unknown as KpiSummary) ?? null;
}

export async function saveForecast(dataset_id: string, forecast: Forecast) {
  const { error } = await supabase.from("forecast_results").insert({
    dataset_id,
    horizon: forecast.horizon,
    series: forecast.series as unknown as never,
  });
  if (error) throw error;
}

export async function saveCeoBrief(brief: Omit<CeoBrief, "id" | "created_at">) {
  const base = {
    dataset_id: brief.dataset_id,
    summary: brief.summary,
    risks: brief.risks as unknown as never,
    opportunities: brief.opportunities as unknown as never,
    priorities: brief.priorities as unknown as never,
    forecast_highlights: brief.forecast_highlights as unknown as never,
    health_score: brief.health_score,
  };
  let res = await supabase
    .from("ceo_briefs")
    .insert({ ...base, meta: (brief.meta ?? null) as unknown as never })
    .select()
    .single();
  // Gracefully degrade if the `meta` column hasn't been migrated yet.
  if (res.error && /meta/i.test(res.error.message)) {
    res = await supabase.from("ceo_briefs").insert(base).select().single();
  }
  if (res.error) throw res.error;
  return res.data as unknown as CeoBrief;
}

export async function latestCeoBrief(dataset_id: string): Promise<CeoBrief | null> {
  const { data, error } = await supabase
    .from("ceo_briefs")
    .select("*")
    .eq("dataset_id", dataset_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CeoBrief) ?? null;
}

export async function saveConsultantReport(report: Omit<ConsultantReport, "id" | "created_at">) {
  const base = {
    dataset_id: report.dataset_id,
    problems: report.problems as unknown as never,
    recommendations: report.recommendations as unknown as never,
    impact_score: report.impact_score,
    roi_score: report.roi_score,
    risk_score: report.risk_score,
    investment_thesis: (report.investment_thesis ?? null) as unknown as never,
  };
  let res = await supabase
    .from("consultant_reports")
    .insert({ ...base, meta: (report.meta ?? null) as unknown as never })
    .select()
    .single();
  if (res.error && /meta/i.test(res.error.message)) {
    res = await supabase.from("consultant_reports").insert(base).select().single();
  }
  if (res.error) throw res.error;
  return res.data as unknown as ConsultantReport;
}

export async function latestConsultantReport(dataset_id: string): Promise<ConsultantReport | null> {
  const { data, error } = await supabase
    .from("consultant_reports")
    .select("*")
    .eq("dataset_id", dataset_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ConsultantReport) ?? null;
}

export async function saveSimulation(sim: Omit<DecisionSimulation, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("decision_simulations")
    .insert({
      dataset_id: sim.dataset_id,
      name: sim.name,
      scenario: sim.scenario as unknown as never,
      revenue_impact: sim.revenue_impact,
      profit_impact: sim.profit_impact,
      risk: sim.risk,
      confidence: sim.confidence,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as DecisionSimulation;
}
export async function listSimulations(dataset_id: string): Promise<DecisionSimulation[]> {
  const { data, error } = await supabase
    .from("decision_simulations")
    .select("*")
    .eq("dataset_id", dataset_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DecisionSimulation[];
}

export async function saveBoardroom(conv: Omit<BoardroomConversation, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("boardroom_conversations")
    .insert({
      dataset_id: conv.dataset_id,
      topic: conv.topic,
      messages: conv.messages as unknown as never,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as BoardroomConversation;
}
export async function listBoardroom(dataset_id: string | null): Promise<BoardroomConversation[]> {
  let q = supabase.from("boardroom_conversations").select("*").order("created_at", { ascending: false });
  if (dataset_id) q = q.eq("dataset_id", dataset_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as BoardroomConversation[];
}

export async function upsertActionPlan(plan: Omit<ActionPlan, "id" | "created_at" | "updated_at"> & { id?: string }) {
  if (plan.id) {
    const { data, error } = await supabase
      .from("action_plans")
      .update({
        initiatives: plan.initiatives as unknown as never,
        progress: plan.progress,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan.id)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as ActionPlan;
  }
  const { data, error } = await supabase
    .from("action_plans")
    .insert({
      dataset_id: plan.dataset_id,
      horizon_days: plan.horizon_days,
      initiatives: plan.initiatives as unknown as never,
      progress: plan.progress,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ActionPlan;
}
export async function listActionPlans(dataset_id: string | null): Promise<ActionPlan[]> {
  let q = supabase.from("action_plans").select("*").order("horizon_days", { ascending: true });
  if (dataset_id) q = q.eq("dataset_id", dataset_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ActionPlan[];
}

export async function listReports(): Promise<GeneratedReport[]> {
  const { data, error } = await supabase
    .from("generated_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as GeneratedReport[];
}
export async function saveReport(rec: Omit<GeneratedReport, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("generated_reports")
    .insert({
      dataset_id: rec.dataset_id,
      kind: rec.kind,
      title: rec.title,
      storage_path: rec.storage_path,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as GeneratedReport;
}

// ============== Executive Decisions (Executive Memory Engine) ==============
// Cast supabase to any until generated types catch up with new table.
const sb = supabase as unknown as {
  from: (t: string) => ReturnType<typeof supabase.from>;
};

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
  const { data, error } = await (sb.from("executive_decisions") as any)
    .insert({
      dataset_id: d.dataset_id,
      conversation_id: d.conversation_id ?? null,
      question: d.question,
      decision: d.decision,
      consensus_score: d.consensus_score,
      confidence_score: d.confidence_score,
      revenue_impact: d.revenue_impact ?? null,
      profit_impact: d.profit_impact ?? null,
      risk_level: d.risk_level,
      owner: d.owner ?? null,
      timeline: d.timeline ?? null,
      next_actions: d.next_actions,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ExecutiveDecision;
}

export async function listExecutiveDecisions(dataset_id: string | null): Promise<ExecutiveDecision[]> {
  let q = (sb.from("executive_decisions") as any).select("*").order("created_at", { ascending: false });
  if (dataset_id) q = q.eq("dataset_id", dataset_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    next_actions: Array.isArray(r.next_actions) ? r.next_actions : [],
  })) as ExecutiveDecision[];
}

export async function updateExecutiveDecision(
  id: string,
  patch: Partial<Pick<ExecutiveDecision, "status" | "progress" | "owner" | "timeline" | "due_date">>
): Promise<void> {
  const { error } = await (sb.from("executive_decisions") as any).update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteExecutiveDecision(id: string): Promise<void> {
  const { error } = await (sb.from("executive_decisions") as any).delete().eq("id", id);
  if (error) throw error;
}

export async function updateDecisionStatus(id: string, status: DecisionStatus): Promise<void> {
  const progress = status === "Completed" ? 100 : status === "In Progress" ? 50 : status === "Blocked" ? 25 : 0;
  await updateExecutiveDecision(id, { status, progress });
}

// Record how a decision actually turned out. Tolerant if the outcome columns
// haven't been migrated yet (degrades to a no-op error the caller surfaces).
export async function recordDecisionOutcome(
  id: string,
  patch: { outcome: import("./types").DecisionOutcome; actual_value?: number | null; outcome_notes?: string | null },
): Promise<void> {
  const { error } = await (sb.from("executive_decisions") as any)
    .update({
      outcome: patch.outcome,
      actual_value: patch.actual_value ?? null,
      outcome_notes: patch.outcome_notes ?? null,
      outcome_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
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
