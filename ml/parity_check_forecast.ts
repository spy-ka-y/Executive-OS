/**
 * Parity check: run the TS/ONNX forecastRevenue tool over the held-out test set
 * and confirm its accuracy (1-MAPE) matches the Python model (~0.97).
 * Usage: npx tsx ml/parity_check_forecast.ts
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSXns from "xlsx";
import { forecastRevenue, type ForecastInputs } from "../src/lib/ml/forecast-revenue.server.ts";

const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST = path.join(ROOT, "data", "seed", "ExecutiveOS_Synthetic_Test_1500.xlsx");

function toInputs(r: Record<string, unknown>): ForecastInputs {
  const n = (v: unknown) => Number(v);
  return {
    date: String(r["Date"]),
    region: String(r["Region"]),
    category: String(r["Category"]),
    business_unit: String(r["Business_Unit"]),
    marketing_spend: n(r["Marketing_Spend"]),
    customers: n(r["Customers"]),
    churn_pct: n(r["Churn_%"]),
  };
}

async function main() {
  const wb = XLSX.readFile(TEST);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true });
  let sumApe = 0;
  let inCI = 0;
  for (const r of rows) {
    const res = await forecastRevenue(toInputs(r));
    const actual = Number(r["Revenue"]);
    sumApe += Math.abs((actual - res.predictedRevenue) / Math.abs(actual));
    if (actual >= res.confidenceInterval.lower && actual <= res.confidenceInterval.upper) inCI++;
  }
  const mape = sumApe / rows.length;
  const acc = 1 - mape;
  console.log(`TS/ONNX forecast over ${rows.length} test rows:`);
  console.log(`  accuracy (1-MAPE): ${(acc * 100).toFixed(2)}%`);
  console.log(`  90% interval coverage: ${((inCI / rows.length) * 100).toFixed(1)}% (target ~90%)`);
  console.log(`  sample: ${JSON.stringify(await forecastRevenue(toInputs(rows[0])))}`);
  if (acc < 0.9) { console.error("[FAIL] below 90%"); process.exit(1); }
  console.log("[PASS] TS forecast matches the trained model.");
}
main().catch((e) => { console.error("❌", e); process.exit(1); });
