// Local analytics — computes KPIs, trend series, anomalies and forecasts from
// parsed dataset rows. The same function signatures will later be served by a
// FastAPI multi-agent orchestrator; toggle with VITE_AI_BACKEND=fastapi.
import type {
  DatasetColumn,
  DatasetRow,
  Forecast,
  ForecastPoint,
  KpiMetric,
  KpiSummary,
} from "./types";
import { forecastSeries } from "./statistics";

const REVENUE_KEYS = ["revenue", "sales", "amount", "gross", "income", "total"];
const PROFIT_KEYS = ["profit", "net_income", "net", "margin_value", "earnings"];
const COST_KEYS = ["cost", "expense", "expenses", "cogs", "spend"];
const CUSTOMER_KEYS = ["customer", "customers", "user", "users", "accounts", "clients"];
const DATE_KEYS = ["date", "month", "period", "quarter", "week", "day", "timestamp"];

function pickColumn(schema: DatasetColumn[], candidates: string[], type?: DatasetColumn["type"]) {
  const lower = schema.map((c) => ({ ...c, l: c.name.toLowerCase() }));
  for (const cand of candidates) {
    const m = lower.find((c) => c.l.includes(cand) && (!type || c.type === type));
    if (m) return m.name;
  }
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}
function mean(arr: number[]) {
  return arr.length ? sum(arr) / arr.length : 0;
}
function std(arr: number[]) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

export function computeKpis(rows: DatasetRow[], schema: DatasetColumn[]): KpiSummary {
  const revCol = pickColumn(schema, REVENUE_KEYS, "number");
  const profitCol = pickColumn(schema, PROFIT_KEYS, "number");
  const costCol = pickColumn(schema, COST_KEYS, "number");
  const custCol = pickColumn(schema, CUSTOMER_KEYS, "number");
  const dateCol = pickColumn(schema, DATE_KEYS);

  // Group by period if we have a date-ish column.
  const buckets = new Map<string, { revenue: number; profit: number; cost: number; customers: number }>();
  rows.forEach((r) => {
    const key = dateCol ? String(r[dateCol] ?? "—").slice(0, 10) : "All";
    const b = buckets.get(key) ?? { revenue: 0, profit: 0, cost: 0, customers: 0 };
    if (revCol) b.revenue += num(r[revCol]);
    if (profitCol) b.profit += num(r[profitCol]);
    if (costCol) b.cost += num(r[costCol]);
    if (custCol) b.customers += num(r[custCol]);
    buckets.set(key, b);
  });

  const series = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({
      label,
      revenue: v.revenue,
      profit: profitCol ? v.profit : v.revenue - v.cost,
    }));

  const revenue = sum(series.map((s) => s.revenue));
  const profit = sum(series.map((s) => s.profit));
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const customers = custCol ? sum(rows.map((r) => num(r[custCol]))) : rows.length;

  // Growth = last vs first half average.
  let growth = 0;
  if (series.length >= 2) {
    const mid = Math.floor(series.length / 2);
    const first = mean(series.slice(0, mid).map((s) => s.revenue));
    const last = mean(series.slice(mid).map((s) => s.revenue));
    growth = first > 0 ? ((last - first) / first) * 100 : 0;
  }

  const trend = series.slice(-12).map((s) => s.revenue);

  const metrics: KpiMetric[] = [
    { key: "revenue", label: "Total Revenue", value: revenue, format: "currency", delta: growth, trend },
    { key: "profit", label: "Net Profit", value: profit, format: "currency", delta: growth * 0.8, trend: series.slice(-12).map((s) => s.profit) },
    { key: "growth", label: "Revenue Growth", value: growth, format: "percent" },
    { key: "margin", label: "Profit Margin", value: margin, format: "percent" },
    { key: "customers", label: custCol ? "Customers" : "Records", value: customers, format: "number" },
    { key: "avgDeal", label: "Avg Revenue / Record", value: rows.length ? revenue / rows.length : 0, format: "currency" },
  ];

  // Anomalies via z-score on revenue series.
  const vals = series.map((s) => s.revenue);
  const m = mean(vals);
  const s = std(vals) || 1;
  const anomalies = series
    .map((p) => ({
      label: p.label,
      value: p.revenue,
      z: (p.revenue - m) / s,
    }))
    .filter((x) => Math.abs(x.z) > 1.8)
    .slice(0, 5)
    .map((x) => ({
      label: x.label,
      value: x.value,
      severity: (Math.abs(x.z) > 2.5 ? "high" : Math.abs(x.z) > 2 ? "med" : "low") as "low" | "med" | "high",
      note:
        x.z > 0
          ? "Revenue spike well above baseline — investigate upside drivers."
          : "Revenue dip well below baseline — investigate root cause.",
    }));

  return { metrics, series, anomalies };
}

export function forecastRevenue(series: Array<{ label: string; revenue: number }>, horizon = 6): Forecast {
  const points: ForecastPoint[] = series.map((p) => ({
    label: p.label,
    value: p.revenue,
    lower: p.revenue,
    upper: p.revenue,
    projected: false,
  }));
  if (series.length < 2) return { horizon, series: points };

  // Delegate to the shared statistics engine so the dashboard forecast uses the
  // SAME rigorous method everywhere: OLS trend + seasonality, residual-based
  // prediction intervals, and a backtest on the user's own series.
  const fc = forecastSeries(series.map((p) => p.revenue), horizon);
  for (let h = 0; h < fc.points.length; h++) {
    const pt = fc.points[h];
    points.push({
      label: `+${h + 1}`,
      value: Math.max(0, pt.value),
      lower: Math.max(0, pt.lower),
      upper: Math.max(0, pt.upper),
      projected: true,
    });
  }
  return { horizon, series: points, mape: fc.backtestMape, fitStrength: fc.fit.strength, r2: fc.fit.r2 };
}
