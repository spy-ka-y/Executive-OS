// Reads model-quality metrics for the in-app Accuracy dashboard
// (src/routes/accuracy.tsx). Two sources, both read with the anon key:
//   - model_eval_runs : risk classifier accuracy + forecast accuracy (1 - MAPE)
//   - eval_runs       : LLM-as-judge pass rate + failing golden scenarios
//
// Neither table is in the generated Supabase `Database` type yet, so the
// `.from()` calls are cast. Both expose metrics only — no held-out test rows or
// golden answers (those stay service-role only).
import { supabase } from "@/integrations/supabase/client";
import type { JudgeVerdict } from "@/lib/ai/judge.server";

export const RISK_MODEL = "risk_level_rf";
export const FORECAST_MODEL = "forecast_revenue_gbr";

export interface ModelEvalRun {
  id: number;
  model_name: string;
  run_date: string;
  accuracy: number; // 0..1 — risk: accuracy; forecast: 1 - MAPE
  metric_type: string; // 'accuracy' | '1-MAPE'
  notes: string | null;
}

export interface PerClassF1 {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number | null;
}

export interface EvalRunFailure {
  scenario_id: string;
  verdict: JudgeVerdict | null;
  judgeError?: string;
}

export interface LlmEvalRun {
  id: number;
  run_at: string;
  agent_model: string | null;
  judge_model: string | null;
  total: number;
  passed: number;
  pass_rate: number; // 0..1
  report_path: string | null;
  failures: EvalRunFailure[];
  notes: string | null;
}

// model_eval_runs rows for one model, oldest → newest (for trend charts).
export async function getModelEvalRuns(modelName: string): Promise<ModelEvalRun[]> {
  const { data, error } = await (supabase as any)
    .from("model_eval_runs")
    .select("id, model_name, run_date, accuracy, metric_type, notes")
    .eq("model_name", modelName)
    .order("run_date", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ModelEvalRun[]).map((r) => ({ ...r, accuracy: Number(r.accuracy) }));
}

// eval_runs rows, oldest → newest. `failures` is jsonb; normalise to an array.
export async function getLlmEvalRuns(): Promise<LlmEvalRun[]> {
  const { data, error } = await (supabase as any)
    .from("eval_runs")
    .select("id, run_at, agent_model, judge_model, total, passed, pass_rate, report_path, failures, notes")
    .order("run_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Omit<LlmEvalRun, "failures"> & { failures: unknown }>).map((r) => ({
    ...r,
    pass_rate: Number(r.pass_rate),
    failures: Array.isArray(r.failures) ? (r.failures as EvalRunFailure[]) : [],
  }));
}

/* ───────────────────────── Real-world backtest ─────────────────────────── */
// Real public-company data (executive_metrics_real). Kept STRICTLY separate from
// the synthetic eval numbers above — never blended into one headline figure.

export interface RealMetricRow {
  ticker: string;
  fiscal_year: number;
  revenue: number | null;
  profit_margin: number | null;
  risk_level_rule: string | null;
  risk_level_model: string | null;
}

export interface BacktestTransition {
  ticker: string;
  yearN: number;
  yearN1: number;
  yearGap: number;
  tierRule: string;
  tierModel: string;
  elevatedRule: boolean;
  revenueChangePct: number;
  marginChangePp: number;
  revenueDecline: boolean;
  marginCompression: boolean;
}

export interface OutcomeRates {
  n: number;
  revenueDecline: number;
  marginCompression: number;
  revenueDeclineRate: number;
  marginCompressionRate: number;
}

export interface RealBacktest {
  companies: number;
  transitions: BacktestTransition[];
  elevated: OutcomeRates; // High/Critical calls (rule tier)
  low: OutcomeRates;
}

const ELEVATED = new Set(["High", "Critical"]);

export async function getRealMetrics(): Promise<RealMetricRow[]> {
  const { data, error } = await (supabase as any)
    .from("executive_metrics_real")
    .select("ticker, fiscal_year, revenue, profit_margin, risk_level_rule, risk_level_model")
    .order("ticker", { ascending: true })
    .order("fiscal_year", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RealMetricRow[]).map((r) => ({
    ...r,
    fiscal_year: Number(r.fiscal_year),
    revenue: r.revenue == null ? null : Number(r.revenue),
    profit_margin: r.profit_margin == null ? null : Number(r.profit_margin),
  }));
}

function rates(rows: BacktestTransition[]): OutcomeRates {
  const n = rows.length;
  const revenueDecline = rows.filter((r) => r.revenueDecline).length;
  const marginCompression = rows.filter((r) => r.marginCompression).length;
  return {
    n,
    revenueDecline,
    marginCompression,
    revenueDeclineRate: n ? revenueDecline / n : NaN,
    marginCompressionRate: n ? marginCompression / n : NaN,
  };
}

// Build the outcome backtest client-side from the rows — single source of truth
// is executive_metrics_real (same logic as ml/backtest_real.py).
export function computeRealBacktest(rows: RealMetricRow[]): RealBacktest {
  const byTicker = new Map<string, RealMetricRow[]>();
  for (const r of rows) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker)!.push(r);
  }
  const transitions: BacktestTransition[] = [];
  for (const series of byTicker.values()) {
    const g = [...series].sort((a, b) => a.fiscal_year - b.fiscal_year);
    for (let i = 0; i < g.length - 1; i++) {
      const n = g[i];
      const n1 = g[i + 1];
      if (n.revenue == null || n1.revenue == null || n.profit_margin == null || n1.profit_margin == null) continue;
      transitions.push({
        ticker: n.ticker,
        yearN: n.fiscal_year,
        yearN1: n1.fiscal_year,
        yearGap: n1.fiscal_year - n.fiscal_year,
        tierRule: n.risk_level_rule ?? "—",
        tierModel: n.risk_level_model ?? "—",
        elevatedRule: ELEVATED.has(n.risk_level_rule ?? ""),
        revenueChangePct: n.revenue ? ((n1.revenue - n.revenue) / n.revenue) * 100 : 0,
        marginChangePp: n1.profit_margin - n.profit_margin,
        revenueDecline: n1.revenue < n.revenue,
        marginCompression: n1.profit_margin < n.profit_margin,
      });
    }
  }
  return {
    companies: byTicker.size,
    transitions,
    elevated: rates(transitions.filter((t) => t.elevatedRule)),
    low: rates(transitions.filter((t) => !t.elevatedRule)),
  };
}

// The risk eval logs per-class precision/recall/F1 as JSON in `notes` (newer
// runs). Older runs stored a plain string — return null so the UI degrades.
export function parsePerClassF1(notes: string | null): PerClassF1[] | null {
  if (!notes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(notes);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const perClass = (parsed as { per_class?: unknown }).per_class;
  if (!perClass || typeof perClass !== "object") return null;

  const rows: PerClassF1[] = [];
  for (const [label, raw] of Object.entries(perClass as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    rows.push({
      label,
      precision: Number(m.precision ?? 0),
      recall: Number(m.recall ?? 0),
      f1: Number(m.f1 ?? 0),
      support: m.support != null ? Number(m.support) : null,
    });
  }
  return rows.length ? rows.sort((a, b) => a.label.localeCompare(b.label)) : null;
}

// Pull a numeric field out of the free-text forecast notes, e.g. "mape=0.0295".
export function parseNoteNumber(notes: string | null, key: string): number | null {
  if (!notes) return null;
  const m = notes.match(new RegExp(`${key}\\s*=\\s*([\\d.eE+-]+)`));
  return m ? Number(m[1]) : null;
}
