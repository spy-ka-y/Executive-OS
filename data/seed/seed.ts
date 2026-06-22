/**
 * One-off seed script for ExecutiveOS eval/training data.
 *
 * Reads the three xlsx files in this folder and loads them into Supabase:
 *   ExecutiveOS_Synthetic_Train_6000.xlsx  -> public.executive_metrics_train
 *   ExecutiveOS_Synthetic_Test_1500.xlsx   -> public.executive_metrics_test   (HELD OUT)
 *   ExecutiveOS_LLM_Eval_Golden_Seed.xlsx  -> public.eval_golden_seed
 *   ExecutiveOS_Real_Metrics.xlsx          -> public.executive_metrics_real   (real SEC data)
 *
 * Idempotent: train/test are cleared then re-inserted; golden is upserted on
 * scenario_id; real is upserted on (ticker, fiscal_year). Run the migrations
 * first (20260620181500_eval_seed_tables.sql and
 * 20260620210000_executive_metrics_real.sql).
 *
 * Usage:
 *   npx tsx data/seed/seed.ts --dry-run   # parse + validate counts, no DB writes
 *   npx tsx data/seed/seed.ts             # write to Supabase (needs service role)
 *
 * Env required for a real run (read from process.env or the repo .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (service role — bypasses RLS; never client-side)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSXns from "xlsx";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// xlsx is CommonJS; normalize the import across ESM/CJS interop (tsx, node).
const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;

const DRY_RUN = process.argv.includes("--dry-run");
const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SEED_DIR, "../..");

const FILES = {
  train: path.join(SEED_DIR, "ExecutiveOS_Synthetic_Train_6000.xlsx"),
  test: path.join(SEED_DIR, "ExecutiveOS_Synthetic_Test_1500.xlsx"),
  golden: path.join(SEED_DIR, "ExecutiveOS_LLM_Eval_Golden_Seed.xlsx"),
  real: path.join(SEED_DIR, "ExecutiveOS_Real_Metrics.xlsx"),
};
const EXPECTED = { train: 6000, test: 1500, golden: 5, real: 50 } as const;

// ── env ────────────────────────────────────────────────────────────────────
function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ── value coercion ───────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, $%]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}
function toISODate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date -> JS date (1899-12-30 epoch).
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  return s.slice(0, 10); // already ISO "YYYY-MM-DD"
}

// ── read + map ───────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
function readSheet(file: string): Row[] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

function mapMetricRow(r: Row, split: "train" | "test") {
  return {
    split,
    date: toISODate(r["Date"]),
    region: r["Region"] ?? null,
    country: r["Country"] ?? null,
    business_unit: r["Business_Unit"] ?? null,
    category: r["Category"] ?? null,
    revenue: num(r["Revenue"]),
    profit: num(r["Profit"]),
    profit_margin: num(r["Profit_Margin"]),
    marketing_spend: num(r["Marketing_Spend"]),
    headcount: int(r["Headcount"]),
    customers: int(r["Customers"]),
    customer_concentration_pct: num(r["Customer_Concentration_%"]),
    churn_pct: num(r["Churn_%"]),
    forecast_accuracy: int(r["Forecast_Accuracy"]),
    risk_level: r["Risk_Level"] ?? null,
    initiative: r["Initiative"] ?? null,
    owner: r["Owner"] ?? null,
    status: r["Status"] ?? null,
  };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapRealRow(r: Row) {
  return {
    ticker: str(r["Ticker"]),
    fiscal_year: int(r["Fiscal_Year"]),
    revenue: num(r["Revenue"]),
    profit: num(r["Profit"]),
    profit_margin: num(r["Profit_Margin"]),
    customer_concentration_pct: num(r["Customer_Concentration_%"]),
    concentration_source: str(r["Concentration_Source"]),
    concentration_disclosed: str(r["Concentration_Disclosed"]),
    largest_customer: str(r["Largest_Customer"]),
    concentration_percentile: num(r["Concentration_Percentile"]),
    marketing_spend: num(r["Marketing_Spend"]),
    headcount: int(r["Headcount"]),
    customers: int(r["Customers"]),
    churn_pct: num(r["Churn_%"]),
    forecast_accuracy: int(r["Forecast_Accuracy"]),
    imputed_features: str(r["Imputed_Features"]),
    risk_level_rule: str(r["Risk_Level_Rule"]),
    risk_level_rule_relative: str(r["Risk_Level_Rule_Relative"]),
    risk_level_model: str(r["Risk_Level_Model"]),
    model_confidence: num(r["Model_Confidence"]),
  };
}

function mapGoldenRow(r: Row) {
  return {
    scenario_id: String(r["Scenario_ID"]),
    region: r["Region"] ?? null,
    category: r["Category"] ?? null,
    revenue: num(r["Revenue"]),
    profit_margin: num(r["Profit_Margin"]),
    customer_concentration_pct: num(r["Customer_Concentration_pct"]),
    churn_pct: num(r["Churn_pct"]),
    golden_risk_level: r["Golden_Risk_Level"] ?? null,
    golden_initiative: r["Golden_Initiative"] ?? null,
    golden_insight_summary: r["Golden_Insight_Summary"] ?? null,
    rubric_criteria: r["Rubric_Criteria"] ?? null,
  };
}

// ── db helpers ───────────────────────────────────────────────────────────────
async function clearAndInsert(sb: SupabaseClient, table: string, rows: object[]) {
  const del = await sb.from(table).delete().gte("id", 0);
  if (del.error) throw new Error(`${table}: clear failed — ${del.error.message}`);
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: insert failed at row ${i} — ${error.message}`);
    process.stdout.write(`  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write("\n");
}

async function verifyCount(sb: SupabaseClient, table: string, expected: number) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: count failed — ${error.message}`);
  const ok = count === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${table}: ${count} rows (expected ${expected})`);
  return ok;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  loadDotEnv();

  for (const [k, f] of Object.entries(FILES)) {
    if (!fs.existsSync(f)) throw new Error(`Missing seed file for "${k}": ${f}`);
  }

  const trainRows = readSheet(FILES.train).map((r) => mapMetricRow(r, "train"));
  const testRows = readSheet(FILES.test).map((r) => mapMetricRow(r, "test"));
  const goldenRows = readSheet(FILES.golden).map(mapGoldenRow);
  const realRows = readSheet(FILES.real).map(mapRealRow);

  console.log("Parsed source files:");
  console.log(`  train : ${trainRows.length} (expected ${EXPECTED.train})`);
  console.log(`  test  : ${testRows.length} (expected ${EXPECTED.test})`);
  console.log(`  golden: ${goldenRows.length} (expected ${EXPECTED.golden})`);
  console.log(`  real  : ${realRows.length} (expected ${EXPECTED.real})`);

  const countsOk =
    trainRows.length === EXPECTED.train &&
    testRows.length === EXPECTED.test &&
    goldenRows.length === EXPECTED.golden &&
    realRows.length === EXPECTED.real;
  if (!countsOk) throw new Error("Source row counts do not match expected — aborting.");

  if (DRY_RUN) {
    console.log("\n[dry-run] parsing + mapping OK, source counts match. No DB writes performed.");
    console.log("[dry-run] sample train row:", JSON.stringify(trainRows[0]));
    console.log("[dry-run] sample golden row:", JSON.stringify(goldenRows[0]));
    console.log("[dry-run] sample real row:", JSON.stringify(realRows[0]));
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. " +
        "Add the service-role key to .env (server secret — never the publishable key), then re-run. " +
        "Or run with --dry-run to validate parsing without writing.",
    );
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log("\nSeeding Supabase…");
  await clearAndInsert(sb, "executive_metrics_train", trainRows);
  await clearAndInsert(sb, "executive_metrics_test", testRows);

  const up = await sb.from("eval_golden_seed").upsert(goldenRows, { onConflict: "scenario_id" });
  if (up.error) throw new Error(`eval_golden_seed: upsert failed — ${up.error.message}`);
  console.log("  eval_golden_seed: upserted");

  const upReal = await sb
    .from("executive_metrics_real")
    .upsert(realRows, { onConflict: "ticker,fiscal_year" });
  if (upReal.error) throw new Error(`executive_metrics_real: upsert failed — ${upReal.error.message}`);
  console.log("  executive_metrics_real: upserted");

  console.log("\nVerifying row counts:");
  const a = await verifyCount(sb, "executive_metrics_train", EXPECTED.train);
  const b = await verifyCount(sb, "executive_metrics_test", EXPECTED.test);
  const c = await verifyCount(sb, "eval_golden_seed", EXPECTED.golden);
  const d = await verifyCount(sb, "executive_metrics_real", EXPECTED.real);
  if (a && b && c && d) console.log("\n✅ Seed complete — all counts match (6000 / 1500 / 5 / 50).");
  else throw new Error("Row-count verification failed.");
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
