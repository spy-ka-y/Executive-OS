# Phase 1 — Data Requirements per Calculation

The contract: **every number the app shows must be computable from the specific
dataset the user uploaded.** This table is the single source of truth the
capability detector (Phase 2) and the statistical layer (Phase 3) code against.

## Column conventions
- **Required fields** — column *roles* (resolved by name-matching, as today in
  `computeIntelligence`), not literal names. A "metric" = a numeric column; a
  "dimension" = a categorical column; a "period" = a date/time-ordered column.
- **Min data** — the minimum shape for the calculation to be honest.
- **Real method (Phase 3)** — how it will actually be computed.
- **Accuracy metric** — the genuine error/confidence reported alongside it.
- **Default on a single snapshot** — classification when the upload is one
  cross-sectional snapshot with no time history (the common worst case).

Capability key = the stable id Phase 2 stores per dataset and the UI queries.

---

## Tier A — Descriptive (what the data literally is)

| Capability key | Calculation | Required fields | Min data | Real method (Phase 3) | Accuracy metric | Default on snapshot |
|---|---|---|---|---|---|---|
| `revenue_total` | Total revenue | 1 revenue/amount metric | ≥1 row | Sum of column | Exact (sum) — no error | COMPUTABLE |
| `margin` | Profit margin % | revenue metric **and** (profit metric OR cost metric) | ≥1 row | (Σprofit / Σrevenue)·100, or (rev−cost)/rev | Exact | COMPUTABLE if profit/cost present, else NOT COMPUTABLE |
| `record_counts` | Rows / dimensions / metrics detected | any | ≥1 row | Schema inspection | Exact | COMPUTABLE |

## Tier B — Diagnostic (structure within the data)

| Capability key | Calculation | Required fields | Min data | Real method | Accuracy metric | Default on snapshot |
|---|---|---|---|---|---|---|
| `concentration_category` | Category concentration (top-share %) | 1 category dimension + 1 metric | ≥2 distinct categories | Σ(top group)/Σ(all)·100 + Herfindahl (HHI) | Exact; HHI gives a real dispersion measure | COMPUTABLE if dimension present |
| `concentration_customer` | Customer concentration (top-5 %) | 1 customer dimension + 1 metric | ≥5 distinct customers (else report fewer) | Top-k share, HHI | Exact | COMPUTABLE if customer dim present |
| `best_worst_region` | Best/worst region | 1 region dimension + 1 metric | ≥2 distinct regions | Group-by sum, rank | Exact | COMPUTABLE if region dim present |
| `best_worst_category` | Best/worst category | 1 category dimension + 1 metric | ≥2 distinct categories | Group-by sum, rank | Exact | COMPUTABLE if category dim present |
| `marketing_roi` | Marketing ROI | marketing-spend metric + revenue metric | ≥1 row each | Σrevenue / Σspend | Exact (ratio) | COMPUTABLE only if spend column exists, else NOT COMPUTABLE |

## Tier C — Time-dependent (need history)

| Capability key | Calculation | Required fields | Min data | Real method | Accuracy metric | Default on snapshot |
|---|---|---|---|---|---|---|
| `series` | Revenue/profit time series | 1 period (date/order) + 1 metric | ≥2 periods | Sort by period, aggregate per period | n/a (raw series) | NOT COMPUTABLE without a period column |
| `growth` | Period-over-period growth % | period + revenue | ≥2 periods | (last−first)/first or CAGR over periods | Exact between observed points; flagged volatile if CV high | NOT COMPUTABLE on snapshot |
| `trend_consistency` | Trend stability (0–100) | period + revenue | ≥4 periods | 1 − coefficient of variation of period-over-period deltas | Reported as the underlying CV; n<4 → PARTIAL | NOT COMPUTABLE on snapshot |
| `anomalies` | Statistical anomalies | period + metric | ≥8 periods for stable z-scores (≥5 = PARTIAL) | Rolling/global z-score; |z|>2 flag; robust (median/MAD) when n small | Reports z and the n it was computed over; n<8 → PARTIAL (wider threshold) | NOT COMPUTABLE on snapshot |
| `forecast` | Forward revenue projection | period + revenue | ≥4 periods to fit (≥6 to backtest) | OLS linear (and log-linear) regression on period index; pick lower-error model | 95% prediction interval from regression residual variance | NOT COMPUTABLE on snapshot |
| `forecast_accuracy` | Forecast error (real) | period + revenue | ≥6 periods (hold out last 2–3) | Backtest: fit on first k, predict held-out, measure | **MAPE / RMSE on held-out periods** | NOT COMPUTABLE (<6 → PARTIAL: in-sample residual error only, labeled as such) |

## Tier D — Predictive / causal (need variation or outcome history) — usually NOT COMPUTABLE

| Capability key | Calculation | Required fields | Min data | Real method | Accuracy metric | Default on snapshot |
|---|---|---|---|---|---|---|
| `price_elasticity` | Price elasticity of demand | unit-price metric + quantity/volume metric | ≥4 distinct price points with corresponding volume, with real price variation (CV of price > ~5%) | Log-log OLS: ln(Q) ~ ln(P); slope = elasticity | Regression R² + std error + p-value of slope; refuse if not significant | **NOT COMPUTABLE** (no price variation in a snapshot) |
| `initiative_impact` | $ impact of a proposed initiative | decision/initiative history: action + before & after metric (paired) | ≥3 past initiatives with measured pre/post outcome | Mean measured lift of analogous past actions, bounded by the affected segment's real revenue | Empirical mean ± std of observed lifts; CI from n | **NOT COMPUTABLE** → show as bounded illustrative range only, never a point estimate |
| `decision_impact` | Measured impact of a past decision | decisions table + outcome metric keyed by date | ≥1 decision with a measurable post-period | Diff of metric pre vs post decision date (and vs control trend) | Δ with the period window stated; needs ≥2 post periods for a trend-adjusted figure | NOT COMPUTABLE unless decision-outcome history uploaded |

## Tier E — Boardroom (depend on BOTH data support and a successful live AI debate)

| Capability key | Calculation | Depends on | Min data | Real method (Phase 5) | Accuracy/honesty metric | Default |
|---|---|---|---|---|---|---|
| `board_consensus` | Consensus score | live debate success | all 7 agents return valid replies | Mean of live agent stance→support; % of agents in agreement | Reports n agents and stance distribution (not a hidden constant) | NOT COMPUTABLE until a live debate runs |
| `board_confidence` | Board confidence | live debate + data support | live replies | Mean live agent confidence, **capped by data-support level** (e.g. can't claim high confidence on a snapshot with no history) | Shows it is self-reported by the model, down-weighted by data classification | PARTIAL (capped) on thin data; NOT COMPUTABLE w/o live debate |
| `board_alignment` | Strategic alignment | a defined reference strategy | an explicit goal/strategy input to compare against | Cosine/keyword overlap vs the stated strategy text | Honest: labeled a textual-overlap heuristic, range only | NOT COMPUTABLE as a rigorous score without a reference strategy → label heuristic |
| `decision_quality` | Decision quality index | its component inputs | components present | Transparent weighted index of *disclosed* inputs | Labeled a composite index, with the inputs shown — never presented as statistical | PARTIAL/transparent index, never a fabricated %|
| `agent_confidence` | Per-agent confidence | live debate | that agent's valid reply | LLM self-reported, down-weighted by data support | Marked self-reported | NOT COMPUTABLE w/o that agent's live reply |

## Tier F — Composite indices (real inputs, transparent weighting)

| Capability key | Calculation | Required fields | Min data | Real method | Accuracy metric | Default |
|---|---|---|---|---|---|---|
| `health_score` | Business health index | whatever of margin/growth/consistency/anomalies is COMPUTABLE | ≥1 computable input | Weighted index over **only the inputs that are themselves COMPUTABLE**; reweight when some are missing | Labeled a directional index; lists which inputs fed it | PARTIAL — computed from available inputs, caveated |
| `consultant_scores` | Growth potential / execution difficulty / strategic risk | derives from Tier A–C capabilities | depends on inputs | Growth potential ← real growth; risk ← real concentration/margin; **execution difficulty has no statistical source → drop or mark heuristic** | Each score states its basis; non-derivable ones become NOT COMPUTABLE | growth/risk PARTIAL; effort heuristic-labeled |

---

## Classification rules (used by Phase 2)
1. **COMPUTABLE** — all required fields present AND min-data met → compute for real, attach the real accuracy metric.
2. **PARTIALLY COMPUTABLE** — required fields present but below the min-data threshold (e.g. 3 periods when 6 are wanted) → compute, but report at reduced/penalized accuracy and name what would improve it.
3. **NOT COMPUTABLE** — required fields absent or fundamentally impossible (no price variation → no elasticity; no decision history → no decision impact) → **show nothing numeric**; show what's missing and how to unlock it.

## Non-negotiable
No calculation may silently fall back to a hardcoded coefficient or invented
percentage. If Phase 2 says NOT COMPUTABLE, the UI shows the gap, not a number.
