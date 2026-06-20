// Loads the golden eval scenarios. Primary source is Aurora (eval_golden_seed)
// via node-postgres; if DATABASE_URL is absent, the table is empty, or the DB is
// unreachable, it falls back to the xlsx in data/seed/ so the eval always runs.
import * as XLSXns from "xlsx";
import { Pool } from "pg";
import type { GoldenScenario } from "../ai/judge.server";
import type { InsightMetrics } from "../agents/runInsightPipeline";

// xlsx is CommonJS; normalize the import across ESM/CJS interop (tsx, vitest).
const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, $%]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapGolden(r: Row): GoldenScenario {
  return {
    scenario_id: String(r["Scenario_ID"] ?? r["scenario_id"]),
    region: str(r["Region"] ?? r["region"]),
    category: str(r["Category"] ?? r["category"]),
    revenue: num(r["Revenue"] ?? r["revenue"]),
    profit_margin: num(r["Profit_Margin"] ?? r["profit_margin"]),
    customer_concentration_pct: num(r["Customer_Concentration_pct"] ?? r["customer_concentration_pct"]),
    churn_pct: num(r["Churn_pct"] ?? r["churn_pct"]),
    golden_risk_level: str(r["Golden_Risk_Level"] ?? r["golden_risk_level"]),
    golden_initiative: str(r["Golden_Initiative"] ?? r["golden_initiative"]),
    golden_insight_summary: str(r["Golden_Insight_Summary"] ?? r["golden_insight_summary"]),
    rubric_criteria: str(r["Rubric_Criteria"] ?? r["rubric_criteria"]),
  };
}

export function readGoldenXlsx(file: string): GoldenScenario[] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
  return rows.map(mapGolden);
}

export function metricsFromScenario(s: GoldenScenario): InsightMetrics {
  return {
    region: s.region,
    category: s.category,
    revenue: s.revenue,
    profit_margin: s.profit_margin,
    customer_concentration_pct: s.customer_concentration_pct,
    churn_pct: s.churn_pct,
  };
}

async function readGoldenAurora(databaseUrl: string): Promise<GoldenScenario[]> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    const res = await pool.query("select * from eval_golden_seed order by scenario_id");
    return res.rows.map((r) => mapGolden(r as Row));
  } finally {
    await pool.end();
  }
}

export async function loadScenarios(opts: {
  databaseUrl?: string;
  xlsxPath: string;
}): Promise<{ scenarios: GoldenScenario[]; source: "aurora" | "xlsx" }> {
  if (opts.databaseUrl) {
    try {
      const scenarios = await readGoldenAurora(opts.databaseUrl);
      if (scenarios.length > 0) return { scenarios, source: "aurora" };
      console.warn("[eval] eval_golden_seed is empty in Aurora — falling back to xlsx.");
    } catch (e) {
      console.warn(`[eval] Aurora read failed (${e instanceof Error ? e.message : e}) — falling back to xlsx.`);
    }
  }
  return { scenarios: readGoldenXlsx(opts.xlsxPath), source: "xlsx" };
}
