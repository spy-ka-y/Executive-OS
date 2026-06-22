# Real-Company Risk Backtest (Prompt 7)

Validates ExecutiveOS's risk logic against **real** public-company data instead of
synthetic data — and documents two findings that the synthetic-only pipeline hid.

## What this is

10 real consumer/apparel companies (CROX, LEVI, COLM, UAA, YETI, NWL, HELE, ELF,
GPRO, SONO), 5 fiscal years each = **50 company-years**, built by joining:

| Source | What | File |
|---|---|---|
| SEC EDGAR XBRL 10-Ks | Revenue, Profit (operating income), Profit_Margin | `data/seed/ExecutiveOS_Real_Financials.xlsx` |
| Hand-verified 10-K reads | Customer concentration (largest customer % of net sales) | `data/seed/ExecutiveOS_Real_Concentration_Findings.xlsx` |

Pipeline: `ml/backtest_real.py` → `data/seed/ExecutiveOS_Real_Metrics.xlsx`
(`executive_metrics_real` table) + `data/seed/ExecutiveOS_Real_Backtest.xlsx`.
Loaded to Supabase by `data/seed/seed.ts` (migration
`supabase/migrations/20260620210000_executive_metrics_real.sql`).

## How risk is computed (three columns)

- **`risk_level_rule`** — the project's original deterministic rule, *unchanged*:
  `concentration > 70 → Critical; > 60 → High; margin ≤ 0 → Critical; ≤ 5 → High; else Low`.
- **`risk_level_rule_relative`** — same structure, but the absolute concentration
  cutoffs are replaced with the company's **percentile rank** of concentration
  among the 10 companies (`≥ 0.90 → Critical`, `≥ 0.70 → High`). Real-company rows
  only. See Finding 1.
- **`risk_level_model`** — the shipped RandomForest (`ml/risk_model.joblib`). See
  Finding 2.

### Data assumptions (all flagged in-table)
- **Concentration proxy**: 5 companies disclose "no single customer ≥ 10%" without
  a number. Their `customer_concentration_pct` is a `5.0` proxy, flagged in
  `concentration_source`. The rule is invariant to this (it's far below any
  threshold) and a sensitivity check confirms the **model** is too (labels
  unchanged whether the proxy is 0, 5, or 9).
- **Imputed features**: real filings don't carry Marketing_Spend, Headcount,
  Customers, Churn_%, or Forecast_Accuracy. They're imputed with synthetic-train
  medians (they aren't part of the risk signal), flagged in `imputed_features`.

## Two backtests, two lenses (don't conflate)

- **This doc — label-vs-relabel:** does the tier at *N* match the tier the rule
  would assign to the company's *actual N+1* financials? A consistency/persistence
  check on the taxonomy.
- **[REAL_WORLD_BACKTEST_REPORT.md](./REAL_WORLD_BACKTEST_REPORT.md) — outcome-based
  (the substance):** does an elevated tier at *N* actually precede a real **revenue
  decline / margin compression** at *N+1*? That report is also surfaced in-app as
  the **Real-World Backtest** panel on the Accuracy dashboard, kept strictly
  separate from the synthetic eval numbers.

## Backtest (label-vs-relabel)

For each company, fiscal years are ordered ascending; for each year *N* with an
*N+1* present, the realized outcome is the rule applied to the company's **actual
N+1 financials**. A year-*N* assessment is "correct" if it equals that realized
state. 40 transitions (1 crosses a missing fiscal year — UAA's Dec→Mar FY change).

| Assessment | Accuracy vs actual N+1 |
|---|---|
| Rule (absolute) | **67.5%** (27/40) |
| Rule (relative) | **82.5%** (33/40) |
| Model | **67.5%** (27/40) |

Both rule and model are *current-state classifiers*, not forecasters: their misses
are almost all under-calls where a company's margin collapsed the next year
(e.g. CROX 25%→3.7%, HELE 7.5%→−44%). Neither ever raised a Critical alarm that
resolved to Low.

> ⚠️ The relative rule's higher 82.5% is **partly an artifact**, not strictly
> "better": top-percentile concentration short-circuits the label to High/Critical
> *regardless of margin*, so those companies' labels barely change year to year,
> inflating year-over-year agreement. Read it as "more persistent," not "more
> accurate." It also inherits the original rule's masking quirk — a top-percentile
> concentration can mask a margin that would otherwise be Critical (e.g. NWL/SONO
> FY2023 show relative-High while absolute is Critical).

---

## Finding 1 — absolute concentration thresholds never fire on real companies

Real single-customer concentration tops out at ~20% (HELE/Amazon). The rule's
cutoffs are 60%/70% — calibrated to the **synthetic** distribution (mean ~40%,
max ~98%). So on real data, `risk_level_rule` is **effectively margin-only**; the
carefully-sourced concentration data changes *zero* labels.

**Response (not a silent patch):** added `risk_level_rule_relative` as a *separate*
column that ranks concentration by percentile among the real companies, so it
actually influences the label. The original 60/70% `risk_level_rule` is left
untouched and remains the rule for synthetic data. We did **not** hardcode new
absolute thresholds.

## Finding 2 — real Revenue/Profit are ~1000×+ outside the training range

This is the deeper reason the model adds nothing on real data:

- Synthetic training Revenue max ≈ **1.86M**; real Revenue max ≈ **10.6B** → **~5,700×** larger.
- Synthetic Profit_Margin floor ≈ **−2.2%**; real margins reach **−43.8%**.
- Revenue, Profit, Marketing_Spend, Headcount, and Customers are therefore **all
  out-of-distribution** for the RandomForest.

`risk_level_model` agrees with `risk_level_rule` on **49/50** current-year rows
(98%). That agreement is **not** independent validation — it happens *because* the
OOD numeric features push every real row past the model's revenue/profit splits,
so the model falls back on the only in-range, scale-free signal it learned:
margin and concentration. In other words, the model is **echoing the rule**, and
the scale mismatch — not just the threshold mismatch in Finding 1 — is why.

### OPEN TODO (do not action without a decision)
Retraining the risk model on real-scale data is deliberately **not done yet**. It
depends on an unresolved product question:

> Does ExecutiveOS target **whole-company** analysis (billions in revenue, the
> scale of these 10 filings) or **business-unit / segment-level** analysis (the
> smaller, per-segment scale the synthetic generator models)?

Retraining for the wrong granularity would bake in the wrong scale. Resolve scope
first, then decide whether to (a) retrain on real-scale data, (b) regenerate
synthetic data at the target scale, or (c) make the model scale-invariant (e.g.
train on ratios/margins only). **Do not guess which.**
