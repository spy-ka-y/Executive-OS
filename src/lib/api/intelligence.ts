// Dataset intelligence layer — derives executive-grade business conclusions
// from raw uploaded rows. Used by CEO Brief and Executive Copilot so both
// surfaces reason over the same findings rather than generic KPI templates.
import type { DatasetColumn, DatasetRow, KpiSummary } from "./types";
import { analyzeCapability, type DataCapability } from "./capability";
import { linearTrend, forecastSeries, herfindahl, type TrendFit, type ForecastResult } from "./statistics";

const REGION_KEYS = ["region", "country", "state", "territory", "market", "location", "city", "zone", "area", "geo"];
const CATEGORY_KEYS = ["category", "product", "segment", "department", "sku", "type", "industry", "brand", "line"];
const CUSTOMER_KEYS = ["customer", "client", "account", "buyer"];
const REVENUE_KEYS = ["revenue", "sales", "amount", "gross", "income", "total"];
const PROFIT_KEYS = ["profit", "net_income", "net", "margin_value", "earnings"];
const MARKETING_KEYS = ["marketing", "ad_spend", "adspend", "campaign", "spend"];
const DATE_KEYS = ["date", "month", "period", "quarter", "week", "day", "timestamp"];

export interface GroupStat {
  name: string;
  total: number;
  share: number; // 0-1
  profit?: number;
  margin?: number; // pct
}

export interface BusinessIntelligence {
  metricName: "Revenue" | "Profit" | "Records";
  hasDimensions: boolean;
  regionDim: string | null;
  categoryDim: string | null;
  customerDim: string | null;
  regions: GroupStat[];
  categories: GroupStat[];
  topCustomers: GroupStat[];
  bestRegion: GroupStat | null;
  worstRegion: GroupStat | null;
  bestCategory: GroupStat | null;
  worstCategory: GroupStat | null;
  categoryConcentrationPct: number; // top category share
  regionConcentrationPct: number;
  customerConcentrationPct: number; // top 5 customers as % of revenue
  marketingRoi: number | null; // revenue / marketing spend
  growthPct: number;
  marginPct: number;
  totalRevenue: number;
  totalProfit: number;
  trendDirection: "up" | "down" | "flat";
  trendConsistency: number; // 0-100
  forecastUpsidePct: number;
  // Data-derived achievable forward-revenue band, computed from the firm's OWN
  // realized period-over-period growth (not a fixed coefficient). null when
  // there is no usable revenue time series to ground it.
  upsideBandPct: { low: number; high: number } | null;
  // Price elasticity of demand from a log-log regression of price vs quantity
  // across the rows. null when the dataset lacks price/quantity columns or the
  // fit is not meaningful — callers must gate any price-impact math on this.
  priceElasticity: number | null;
  // OLS trend fit on the revenue series, with R², p-value and a qualitative
  // strength used to flag weak fits in the UI instead of asserting a trend.
  trend: TrendFit;
  // Forecast with prediction intervals + a backtest MAPE on THIS series, so the
  // accuracy shown is measured on the user's own data. null with no series.
  forecast: ForecastResult | null;
  // Herfindahl concentration of the category mix (a real concentration measure).
  categoryHHI: { hhi: number; normalized: number; label: "low" | "moderate" | "high" } | null;
  // Full capability map so every downstream surface gates on the same source.
  capability: DataCapability;
  highlights: string[]; // human-ready bullet sentences
}

// Achievable forward-revenue band derived from realized period growth.
// Returns percentages (e.g. { low: 4.2, high: 9.1 }) or null when no series.
function deriveUpsideBand(series: Array<{ revenue: number }>): { low: number; high: number } | null {
  const vals = series.map((s) => s.revenue).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < 3) return null;
  const rates: number[] = [];
  for (let i = 1; i < vals.length; i++) {
    const prev = vals[i - 1];
    if (prev > 0) rates.push(vals[i] / prev - 1);
  }
  if (!rates.length) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const positives = rates.filter((r) => r > 0);
  const posMean = positives.length ? positives.reduce((a, b) => a + b, 0) / positives.length : mean;
  // Conservative = 40% of average realized growth; optimistic = 80% of average
  // positive-period growth. Bounded so a single outlier period can't dominate.
  const low = Math.max(0, Math.min(40, mean * 100 * 0.4));
  const high = Math.max(low + 0.5, Math.min(60, posMean * 100 * 0.8));
  return { low: Number(low.toFixed(1)), high: Number(high.toFixed(1)) };
}

// Price elasticity via ordinary least squares on log(quantity) ~ log(price).
// The slope is the elasticity. null unless we have >= 8 valid, varying pairs.
function derivePriceElasticity(
  rows: DatasetRow[],
  priceCol: string | undefined,
  qtyCol: string | undefined,
): number | null {
  if (!priceCol || !qtyCol) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rows) {
    const p = toNum(r[priceCol]);
    const q = toNum(r[qtyCol]);
    if (p > 0 && q > 0) {
      xs.push(Math.log(p));
      ys.push(Math.log(q));
    }
  }
  if (xs.length < 8) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 1e-9) return null; // no price variation -> not identifiable
  const slope = sxy / sxx;
  if (!Number.isFinite(slope)) return null;
  return Number(slope.toFixed(3));
}

function pickCol(schema: DatasetColumn[], candidates: string[], type?: DatasetColumn["type"]): string | null {
  const lower = schema.map((c) => ({ ...c, l: c.name.toLowerCase() }));
  for (const cand of candidates) {
    const m = lower.find((c) => c.l.includes(cand) && (!type || c.type === type));
    if (m) return m.name;
  }
  return null;
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function aggregate(
  rows: DatasetRow[],
  dimCol: string,
  metricCol: string | null,
  profitCol: string | null,
): GroupStat[] {
  const map = new Map<string, { total: number; profit: number }>();
  for (const r of rows) {
    const raw = r[dimCol];
    if (raw === null || raw === undefined || raw === "") continue;
    const key = String(raw);
    const v = metricCol ? toNum(r[metricCol]) : 1;
    const p = profitCol ? toNum(r[profitCol]) : 0;
    const cur = map.get(key) ?? { total: 0, profit: 0 };
    cur.total += v;
    cur.profit += p;
    map.set(key, cur);
  }
  const arr = Array.from(map.entries()).map(([name, v]) => ({
    name,
    total: v.total,
    profit: v.profit,
    margin: v.total > 0 ? (v.profit / v.total) * 100 : 0,
  }));
  arr.sort((a, b) => b.total - a.total);
  const grand = arr.reduce((a, b) => a + b.total, 0);
  return arr.map((x) => ({ ...x, share: grand > 0 ? x.total / grand : 0 }));
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export function computeBusinessIntelligence(
  rows: DatasetRow[],
  schema: DatasetColumn[],
  kpis: KpiSummary | null,
): BusinessIntelligence {
  const capability = analyzeCapability(schema, rows);
  const regionCol = pickCol(schema, REGION_KEYS);
  const categoryCol = pickCol(schema, CATEGORY_KEYS);
  const customerCol = pickCol(schema, CUSTOMER_KEYS);
  const revCol = pickCol(schema, REVENUE_KEYS, "number");
  const profCol = pickCol(schema, PROFIT_KEYS, "number");
  const mktCol = pickCol(schema, MARKETING_KEYS, "number");
  const metricCol = revCol ?? profCol;
  const metricName: BusinessIntelligence["metricName"] = revCol ? "Revenue" : profCol ? "Profit" : "Records";

  const regions = regionCol ? aggregate(rows, regionCol, metricCol, profCol) : [];
  const categories = categoryCol ? aggregate(rows, categoryCol, metricCol, profCol) : [];
  const topCustomers = customerCol ? aggregate(rows, customerCol, metricCol, profCol).slice(0, 10) : [];

  const totalRevenue = revCol ? rows.reduce((a, r) => a + toNum(r[revCol]), 0) : kpis?.metrics.find((m) => m.key === "revenue")?.value ?? 0;
  const totalProfit = profCol ? rows.reduce((a, r) => a + toNum(r[profCol]), 0) : kpis?.metrics.find((m) => m.key === "profit")?.value ?? 0;
  const totalMarketing = mktCol ? rows.reduce((a, r) => a + toNum(r[mktCol]), 0) : 0;
  const marketingRoi = totalMarketing > 0 ? totalRevenue / totalMarketing : null;

  const growthPct = kpis?.metrics.find((m) => m.key === "growth")?.value ?? 0;
  const marginPct = kpis?.metrics.find((m) => m.key === "margin")?.value ?? (totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0);

  // Trend consistency via coefficient of variation on revenue series.
  let trendConsistency = 50;
  const series = kpis?.series ?? [];
  const revSeries = series.map((s) => s.revenue);
  if (series.length >= 3) {
    const vals = revSeries;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sigma = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    const cv = mean > 0 ? sigma / mean : 1;
    trendConsistency = Math.max(0, Math.min(100, Math.round(100 - cv * 100)));
  }
  // Real OLS trend + forecast on the revenue series (replaces the naive
  // ">2% growth = up" rule with a statistically-credible direction).
  const trend = linearTrend(revSeries);
  const forecast = revSeries.length >= 3 ? forecastSeries(revSeries, 4) : null;
  const trendDirection: BusinessIntelligence["trendDirection"] =
    trend.strength === "insufficient"
      ? (growthPct > 2 ? "up" : growthPct < -2 ? "down" : "flat")
      : trend.direction;
  const forecastUpsidePct = growthPct > 0 ? Math.min(25, growthPct) : 0;
  const upsideBandPct = deriveUpsideBand(series);
  const priceElasticity = derivePriceElasticity(rows, capability.roles.price, capability.roles.quantity);
  const categoryHHI = categories.length ? herfindahl(categories.map((c) => c.share)) : null;

  // Downgrade the forecast capability when the trend fit on the user's OWN
  // series is weak — so the UI flags a low-confidence forecast instead of
  // presenting a confident line through noise.
  const fc = capability.capabilities.forecast;
  if (forecast && fc && fc.status === "computable" && (trend.strength === "weak" || trend.strength === "insufficient")) {
    fc.status = "partial";
    fc.note = `Weak statistical fit (R² ${trend.r2.toFixed(2)}, p ${trend.pValue.toFixed(2)}); treat the forecast as low-confidence.`;
  }

  const bestRegion = regions[0] ?? null;
  const worstRegion = regions.length > 1 ? regions[regions.length - 1] : null;
  const bestCategory = categories[0] ?? null;
  const worstCategory = categories.length > 1 ? categories[categories.length - 1] : null;
  const categoryConcentrationPct = (bestCategory?.share ?? 0) * 100;
  const regionConcentrationPct = (bestRegion?.share ?? 0) * 100;
  const top5CustGrand = topCustomers.slice(0, 5).reduce((a, b) => a + b.total, 0);
  const customerConcentrationPct = totalRevenue > 0 ? (top5CustGrand / totalRevenue) * 100 : 0;

  const highlights: string[] = [];
  if (bestRegion) highlights.push(`${bestRegion.name} leads ${metricName.toLowerCase()} with ${fmtMoney(bestRegion.total)} (${fmtPct(bestRegion.share * 100)} of total).`);
  if (worstRegion && worstRegion !== bestRegion) highlights.push(`${worstRegion.name} is the weakest region at ${fmtMoney(worstRegion.total)} — review go-to-market fit.`);
  if (bestCategory) highlights.push(`${bestCategory.name} is the top category at ${fmtPct(categoryConcentrationPct)} of ${metricName.toLowerCase()}.`);
  if (worstCategory && worstCategory !== bestCategory && (worstCategory.margin ?? 0) < (bestCategory?.margin ?? 0)) {
    highlights.push(`${worstCategory.name} drags margin at ${fmtPct(worstCategory.margin ?? 0)} — investigate cost structure.`);
  }
  if (customerConcentrationPct > 40) highlights.push(`Top 5 customers represent ${fmtPct(customerConcentrationPct)} of revenue — material concentration risk.`);
  if (marketingRoi !== null) highlights.push(`Marketing ROI is ${marketingRoi.toFixed(2)}x (${fmtMoney(totalRevenue)} revenue / ${fmtMoney(totalMarketing)} spend).`);
  highlights.push(`Trend is ${trendDirection} at ${fmtPct(growthPct)} half-over-half; consistency score ${trendConsistency}/100.`);

  return {
    metricName,
    hasDimensions: regions.length > 0 || categories.length > 0,
    regionDim: regionCol,
    categoryDim: categoryCol,
    customerDim: customerCol,
    regions,
    categories,
    topCustomers,
    bestRegion,
    worstRegion,
    bestCategory,
    worstCategory,
    categoryConcentrationPct,
    regionConcentrationPct,
    customerConcentrationPct,
    marketingRoi,
    growthPct,
    marginPct,
    totalRevenue,
    totalProfit,
    trendDirection,
    trendConsistency,
    forecastUpsidePct,
    upsideBandPct,
    priceElasticity,
    trend,
    forecast,
    categoryHHI,
    capability,
    highlights,
  };
}

// Quick formatted intelligence brief for use as conversational context.
export function intelligenceBriefText(intel: BusinessIntelligence): string {
  const lines: string[] = [];
  lines.push(`Revenue ${fmtMoney(intel.totalRevenue)} · Profit ${fmtMoney(intel.totalProfit)} · Margin ${fmtPct(intel.marginPct)} · Growth ${fmtPct(intel.growthPct)}.`);
  for (const h of intel.highlights) lines.push("• " + h);
  return lines.join("\n");
}

export { fmtMoney as formatMoney, fmtPct as formatPct };
// Tiny re-export so callers don't need to know about DATE_KEYS internals.
export const _DATE_KEYS = DATE_KEYS;
