// Shared data models for Rabbitt BI Copilot.
// These mirror the shapes that future FastAPI / multi-agent LLM endpoints
// (Gemini 2.5 Pro, Claude, GPT-4o) must return so the frontend can swap
// implementations behind a single env flag (VITE_AI_BACKEND).

export type ColumnType = "number" | "string" | "date" | "boolean";

export interface DatasetColumn {
  name: string;
  type: ColumnType;
}

export interface Dataset {
  id: string;
  name: string;
  source_filename: string | null;
  source_url?: string | null;
  row_count: number;
  column_count: number;
  schema: DatasetColumn[];
  created_at: string;
}

export type DatasetRow = Record<string, string | number | boolean | null>;

export interface KpiMetric {
  key: string;
  label: string;
  value: number;
  format: "currency" | "number" | "percent";
  delta?: number; // pct change vs prior period
  trend?: number[]; // sparkline points
}

export interface KpiSummary {
  metrics: KpiMetric[];
  series: Array<{ label: string; revenue: number; profit: number }>;
  anomalies: Array<{ label: string; value: number; severity: "low" | "med" | "high"; note: string }>;
}

export interface ForecastPoint {
  label: string;
  value: number;
  lower: number;
  upper: number;
  projected: boolean;
}

export interface Forecast {
  horizon: number;
  series: ForecastPoint[];
  /** Backtested mean absolute % error on the user's own series (null if N/A). */
  mape?: number | null;
  /** Qualitative trend-fit strength so the UI can flag weak/low-confidence forecasts. */
  fitStrength?: "strong" | "moderate" | "weak" | "insufficient";
  r2?: number;
}

// How a generated artifact was produced, so the UI never passes off a built-in
// template as live AI output. `reason` explains a fallback (rate limit, no key…).
export interface GenerationMeta {
  source: "ai" | "builtin";
  reason?: "rate_limit" | "missing_key" | "schema_invalid" | "unavailable" | "budget";
}

export type CopilotAgent = "CEO Agent" | "Consultant Agent" | "Forecast Agent" | "Decision Agent" | "Boardroom Agent";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  agent?: CopilotAgent;
}

export interface CeoBrief {
  id?: string;
  dataset_id: string;
  summary: string;
  risks: Array<{ title: string; description: string; severity: "low" | "med" | "high" }>;
  opportunities: Array<{ title: string; description: string; upside: string }>;
  priorities: Array<{ title: string; owner: string; due: string }>;
  forecast_highlights: Array<{ label: string; value: string }>;
  health_score: number; // 0-100
  meta?: GenerationMeta;
  created_at?: string;
}

export interface ConsultantProblem {
  title: string;
  description: string;
  evidence: string;
  severity: "low" | "med" | "high";
  financial_exposure: string;
  strategic_recommendation: string;
  category?: "concentration" | "category" | "region" | "margin" | "customer" | "growth" | "forecast";
}
export interface ConsultantRecommendation {
  title: string;
  description: string;
  impact: number; // 0-100 — Growth Potential
  effort: number; // 0-100 — Execution Difficulty
  timeframe: string;
  expected_revenue_impact: string;
  confidence: number; // 0-100
  owner: string;
  strategic_risk?: number; // 0-100
}
export interface ConsultantInvestmentThesis {
  revenue_upside: string;
  margin_improvement: string;
  risk_reduction: string;
  verdict: string;
  posture: "Accelerate" | "Optimize" | "Stabilize" | "Defend";
}
export interface ConsultantReport {
  id?: string;
  dataset_id: string;
  problems: ConsultantProblem[];
  recommendations: ConsultantRecommendation[];
  impact_score: number; // Growth Potential
  roi_score: number;    // Execution Difficulty (lower = easier)
  risk_score: number;   // Strategic Risk
  investment_thesis?: ConsultantInvestmentThesis | null;
  meta?: GenerationMeta;
  created_at?: string;
}


export interface SimulationScenario {
  priceChangePct: number;
  marketingSpendDeltaPct: number;
  headcountDelta: number;
  churnDeltaPct: number;
  notes?: string;
}
export interface DecisionSimulation {
  id?: string;
  dataset_id: string;
  name: string;
  scenario: SimulationScenario;
  revenue_impact: number; // currency
  profit_impact: number;
  risk: number; // 0-100
  confidence: number; // 0-100
  created_at?: string;
}

export type BoardroomAgent = "CEO" | "CFO" | "CMO" | "COO" | "CRO";
export interface BoardroomMessage {
  id: string;
  agent: BoardroomAgent;
  content: string;
}
export interface BoardroomConversation {
  id?: string;
  dataset_id: string | null;
  topic: string;
  messages: BoardroomMessage[];
  created_at?: string;
}

export interface ActionInitiative {
  id: string;
  title: string;
  description: string;
  owner: string;
  status: "not_started" | "in_progress" | "done";
  progress: number; // 0-100
}
export interface ActionPlan {
  id?: string;
  dataset_id: string | null;
  horizon_days: 30 | 60 | 90;
  initiatives: ActionInitiative[];
  progress: number;
  created_at?: string;
  updated_at?: string;
}

export interface GeneratedReport {
  id: string;
  dataset_id: string | null;
  kind: "pdf" | "pptx";
  title: string;
  storage_path: string | null;
  created_at: string;
}

export type DecisionStatus = "Not Started" | "In Progress" | "Completed" | "Blocked";
export type DecisionRiskLevel = "Low" | "Medium" | "High";
// How a decision actually turned out, recorded after the fact for the hit-rate.
export type DecisionOutcome = "win" | "loss" | "mixed";

export interface ExecutiveDecision {
  id: string;
  dataset_id: string | null;
  conversation_id: string | null;
  question: string;
  decision: string;
  consensus_score: number;
  confidence_score: number;
  revenue_impact: string | null;
  profit_impact: string | null;
  risk_level: DecisionRiskLevel;
  owner: string | null;
  timeline: string | null;
  next_actions: string[];
  status: DecisionStatus;
  progress: number;
  due_date: string | null;
  outcome?: DecisionOutcome | null;
  actual_value?: number | null;
  outcome_notes?: string | null;
  outcome_at?: string | null;
  created_at: string;
  updated_at: string;
}
