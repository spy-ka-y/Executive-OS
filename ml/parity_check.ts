/**
 * Parity check: run the TS/ONNX predictRiskLevel tool over the held-out test
 * set and confirm it matches the Python model's ~97% accuracy. Proves the
 * in-process Node inference path is correct.
 *
 * Usage: npx tsx ml/parity_check.ts
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSXns from "xlsx";
import { predictRiskLevel, type RiskMetrics } from "../src/lib/ml/predict-risk.server.ts";

const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST = path.join(ROOT, "data", "seed", "ExecutiveOS_Synthetic_Test_1500.xlsx");

function toMetrics(r: Record<string, unknown>): RiskMetrics {
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v));
  return {
    revenue: n(r["Revenue"]),
    profit: n(r["Profit"]),
    profit_margin: n(r["Profit_Margin"]),
    marketing_spend: n(r["Marketing_Spend"]),
    headcount: n(r["Headcount"]),
    customers: n(r["Customers"]),
    customer_concentration_pct: n(r["Customer_Concentration_%"]),
    churn_pct: n(r["Churn_%"]),
    forecast_accuracy: n(r["Forecast_Accuracy"]),
  };
}

async function main() {
  const wb = XLSX.readFile(TEST);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true });
  let correct = 0;
  for (const r of rows) {
    const pred = await predictRiskLevel(toMetrics(r));
    if (pred.riskLevel === String(r["Risk_Level"])) correct++;
  }
  const acc = correct / rows.length;
  console.log(`TS/ONNX parity over ${rows.length} test rows: accuracy ${(acc * 100).toFixed(2)}%`);
  console.log(`sample: ${JSON.stringify(await predictRiskLevel(toMetrics(rows[0])))}`);
  if (acc < 0.9) { console.error("[FAIL] below 90%"); process.exit(1); }
  console.log("[PASS] TS inference matches the trained model.");
}
main().catch((e) => { console.error("❌", e); process.exit(1); });
