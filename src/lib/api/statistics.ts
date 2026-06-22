// Real statistics engine. This is the analytical core that replaces "sums and
// shares wrapped in prose" with defensible methods: ordinary-least-squares trend
// with significance testing, residual-based forecast prediction intervals, a
// dataset-specific backtest (so accuracy is measured on YOUR series, not a
// synthetic one), Herfindahl concentration, and robust anomaly detection.
//
// Pure, dependency-free, and side-effect-free so it can run on client or server.

export interface TrendFit {
  slope: number; // change in y per period
  intercept: number;
  r2: number; // 0..1 goodness of fit
  pValue: number; // significance of the slope (two-sided t-test)
  stdError: number; // residual standard error
  n: number;
  /** Qualitative read used to gate/flag insights in the UI. */
  strength: "strong" | "moderate" | "weak" | "insufficient";
  direction: "up" | "down" | "flat";
}

export interface ForecastPoint {
  index: number;
  value: number;
  lower: number; // ~95% prediction interval
  upper: number;
}

export interface ForecastResult {
  points: ForecastPoint[];
  /** Backtested mean absolute percentage error on a holdout of THIS series. */
  backtestMape: number | null;
  /** Detected additive seasonal period (in points), or null. */
  seasonPeriod: number | null;
  fit: TrendFit;
}

// ── t-distribution p-value via the regularized incomplete beta function ──────
// Standard Numerical-Recipes continued-fraction implementation. Accurate enough
// for reporting slope significance.
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a Student-t statistic with df degrees of freedom. */
export function tDistTwoSidedP(t: number, df: number): number {
  if (df <= 0 || Number.isNaN(t)) return 1;
  if (!Number.isFinite(t)) return 0; // t = ±∞ → a perfect, maximally significant fit
  return betai(df / 2, 0.5, df / (df + t * t));
}

// ── OLS linear trend ─────────────────────────────────────────────────────────
export function linearTrend(values: number[]): TrendFit {
  const ys = values.filter((v) => Number.isFinite(v));
  const n = ys.length;
  if (n < 2) {
    return { slope: 0, intercept: ys[0] ?? 0, r2: 0, pValue: 1, stdError: 0, n, strength: "insufficient", direction: "flat" };
  }
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * xs[i];
    sse += (ys[i] - yhat) ** 2;
  }
  const r2 = syy > 0 ? Math.max(0, 1 - sse / syy) : 0;
  const df = n - 2;
  const stdError = df > 0 ? Math.sqrt(sse / df) : 0;
  const slopeSE = df > 0 && sxx > 0 ? stdError / Math.sqrt(sxx) : 0;
  // A zero residual error on a non-flat slope is a perfect (maximally
  // significant) fit, not an undefined one — represent it as t→∞ (p→0).
  const t = slopeSE > 0 ? slope / slopeSE : Math.abs(slope) > 0 ? Infinity : 0;
  const pValue = df > 0 ? tDistTwoSidedP(t, df) : 1;

  let strength: TrendFit["strength"];
  if (n < 4) strength = "insufficient";
  else if (r2 < 0.3 || pValue > 0.1) strength = "weak";
  else if (r2 < 0.6) strength = "moderate";
  else strength = "strong";

  // Direction only asserted when the slope is statistically credible.
  const meanAbs = Math.abs(my) > 0 ? Math.abs(my) : 1;
  const relSlope = slope / meanAbs;
  const direction =
    strength === "insufficient" || strength === "weak" || Math.abs(relSlope) < 0.005
      ? "flat"
      : slope > 0
        ? "up"
        : "down";

  return { slope, intercept, r2, pValue, stdError, n, strength, direction };
}

// ── Seasonality detection via autocorrelation ────────────────────────────────
export function detectSeasonPeriod(values: number[], candidates = [12, 4, 7]): number | null {
  const ys = values.filter((v) => Number.isFinite(v));
  const n = ys.length;
  if (n < 8) return null;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  const variance = ys.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  if (variance <= 0) return null;
  let best: { period: number; acf: number } | null = null;
  for (const lag of candidates) {
    if (n < lag * 2) continue;
    let cov = 0;
    for (let i = lag; i < n; i++) cov += (ys[i] - mean) * (ys[i - lag] - mean);
    const acf = cov / ((n - lag) * variance);
    if (acf > 0.4 && (!best || acf > best.acf)) best = { period: lag, acf };
  }
  return best?.period ?? null;
}

// ── Forecast with prediction intervals + dataset-specific backtest ───────────
export function forecastSeries(values: number[], horizon = 4): ForecastResult {
  const ys = values.filter((v) => Number.isFinite(v));
  const fit = linearTrend(ys);
  const n = ys.length;
  const seasonPeriod = detectSeasonPeriod(ys);

  // Additive seasonal offsets from detrended residuals.
  const seasonal: number[] = [];
  if (seasonPeriod) {
    const bucketSum = new Array(seasonPeriod).fill(0);
    const bucketCount = new Array(seasonPeriod).fill(0);
    for (let i = 0; i < n; i++) {
      const detr = ys[i] - (fit.intercept + fit.slope * i);
      const b = i % seasonPeriod;
      bucketSum[b] += detr;
      bucketCount[b]++;
    }
    for (let b = 0; b < seasonPeriod; b++) seasonal[b] = bucketCount[b] ? bucketSum[b] / bucketCount[b] : 0;
  }

  const mx = (n - 1) / 2;
  let sxx = 0;
  for (let i = 0; i < n; i++) sxx += (i - mx) ** 2;
  const z = 1.96; // ~95% interval (normal approximation, disclosed)

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const idx = n - 1 + h;
    const seas = seasonPeriod ? seasonal[idx % seasonPeriod] ?? 0 : 0;
    const yhat = fit.intercept + fit.slope * idx + seas;
    // OLS prediction-interval width for a new observation.
    const se = sxx > 0 ? fit.stdError * Math.sqrt(1 + 1 / n + (idx - mx) ** 2 / sxx) : fit.stdError;
    const margin = z * se;
    points.push({ index: idx, value: yhat, lower: yhat - margin, upper: yhat + margin });
  }

  return { points, backtestMape: backtest(ys, horizon, seasonPeriod), seasonPeriod, fit };
}

// Refit on all-but-last-k, predict the held-out tail, return MAPE.
function backtest(ys: number[], horizon: number, seasonPeriod: number | null): number | null {
  const n = ys.length;
  const h = Math.min(horizon, Math.floor(n / 3));
  if (n < 6 || h < 1) return null;
  const train = ys.slice(0, n - h);
  const test = ys.slice(n - h);
  const f = linearTrend(train);
  let sumPct = 0;
  let counted = 0;
  for (let i = 0; i < test.length; i++) {
    const idx = train.length + i;
    let seas = 0;
    if (seasonPeriod && train.length >= seasonPeriod) {
      const bSum = new Array(seasonPeriod).fill(0);
      const bCnt = new Array(seasonPeriod).fill(0);
      for (let j = 0; j < train.length; j++) {
        const detr = train[j] - (f.intercept + f.slope * j);
        bSum[j % seasonPeriod] += detr;
        bCnt[j % seasonPeriod]++;
      }
      seas = bCnt[idx % seasonPeriod] ? bSum[idx % seasonPeriod] / bCnt[idx % seasonPeriod] : 0;
    }
    const pred = f.intercept + f.slope * idx + seas;
    const actual = test[i];
    if (Math.abs(actual) > 1e-9) {
      sumPct += Math.abs((actual - pred) / actual);
      counted++;
    }
  }
  return counted ? Number(((sumPct / counted) * 100).toFixed(1)) : null;
}

// ── Herfindahl-Hirschman concentration index ─────────────────────────────────
// Returns { hhi: 0..10000, normalized: 0..1, label }. A real concentration
// measure (sum of squared % shares) rather than just "top share".
export function herfindahl(shares01: number[]): { hhi: number; normalized: number; label: "low" | "moderate" | "high" } {
  const shares = shares01.filter((s) => Number.isFinite(s) && s > 0);
  const k = shares.length;
  if (!k) return { hhi: 0, normalized: 0, label: "low" };
  const hhi = shares.reduce((a, s) => a + (s * 100) ** 2, 0);
  // Normalize against the minimum (1/k) so single-segment datasets read 1.0.
  const minHhi = (1 / k) * 10000;
  const normalized = k > 1 ? Math.max(0, (hhi - minHhi) / (10000 - minHhi)) : 1;
  // DOJ/FTC thresholds: >2500 highly concentrated, 1500-2500 moderate, else low.
  const label = hhi > 2500 ? "high" : hhi >= 1500 ? "moderate" : "low";
  return { hhi: Math.round(hhi), normalized: Number(normalized.toFixed(2)), label };
}

// ── Robust anomaly detection (modified z-score via MAD) ──────────────────────
export interface Anomaly {
  index: number;
  value: number;
  score: number; // modified z-score
  severity: "low" | "med" | "high";
}
export function detectAnomalies(values: number[]): Anomaly[] {
  const ys = values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  const n = ys.length;
  if (n < 5) return [];
  const sorted = [...ys].sort((a, b) => a.v - b.v);
  const median = sorted[Math.floor(n / 2)].v;
  const devs = ys.map((p) => Math.abs(p.v - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(n / 2)] || 1e-9;
  const out: Anomaly[] = [];
  for (const p of ys) {
    const score = (0.6745 * (p.v - median)) / mad; // modified z-score
    const abs = Math.abs(score);
    if (abs >= 3.5) out.push({ index: p.i, value: p.v, score: Number(score.toFixed(2)), severity: abs >= 5 ? "high" : "med" });
    else if (abs >= 2.5) out.push({ index: p.i, value: p.v, score: Number(score.toFixed(2)), severity: "low" });
  }
  return out;
}
