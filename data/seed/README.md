# ExecutiveOS — Seed & Eval Data

Three datasets that feed ExecutiveOS's accuracy/eval pipeline. They are loaded
into Supabase by [`seed.ts`](./seed.ts).

## The files

| File | Rows | Supabase table | Purpose |
|---|---|---|---|
| `ExecutiveOS_Synthetic_Train_6000.xlsx` | 6000 | `executive_metrics_train` | **Training data.** Use to fit coefficients, calibrate heuristics, and develop the agents. |
| `ExecutiveOS_Synthetic_Test_1500.xlsx` | 1500 | `executive_metrics_test` | **Held-out test set.** Scoring ONLY. |
| `ExecutiveOS_LLM_Eval_Golden_Seed.xlsx` | 5 | `eval_golden_seed` | **Golden scenarios.** Hand-curated cases with a golden risk tier, golden initiative, ideal narrative, and a grading rubric — used to grade agent *output quality*, not for training. |
| `ExecutiveOS_Real_Metrics.xlsx` | 50 | `executive_metrics_real` | **Real-company backtest data.** 10 public companies × 5 fiscal years from SEC EDGAR 10-Ks, joined with hand-verified customer concentration, plus computed risk labels. Built by `ml/backtest_real.py`. See [`docs/REAL_DATA_BACKTEST.md`](../../docs/REAL_DATA_BACKTEST.md). |

> `executive_metrics_real` is **derived**, not hand-authored: regenerate it with
> `py ml/backtest_real.py` (which reads `ExecutiveOS_Real_Financials.xlsx` +
> `ExecutiveOS_Real_Concentration_Findings.xlsx`) before re-seeding. Same RLS
> pattern as the others — service-role only. Migration:
> `20260620210000_executive_metrics_real.sql`.

## ⛔ Held-out rule (do not break this)

**The test set (`*_Test_1500` / `executive_metrics_test`) must NEVER be used for
training, fitting, tuning, prompt-engineering, or fine-tuning.** It exists solely
to measure generalization after the fact. Likewise, the **golden seed** is a
graded reference, not training input.

Guards in place so this can't happen by accident:
- **Physically separate tables** — train and test never share a table.
- **`split` CHECK constraint** — `executive_metrics_train` only accepts
  `split = 'train'`, `executive_metrics_test` only `split = 'test'`. A test row
  literally cannot be written into the train table, and vice-versa.
- **RLS, service-role only** — these tables are not exposed to the app's
  anon/publishable key, so held-out data can't leak into the product surface.

## How to seed

1. Apply the migrations that create the tables (once):
   ```bash
   # via Supabase CLI (linked project)
   supabase db push
   # …or paste these into the Supabase SQL editor:
   #   supabase/migrations/20260620181500_eval_seed_tables.sql       (train/test/golden)
   #   supabase/migrations/20260620210000_executive_metrics_real.sql (real)
   ```
2. Provide a **service-role** key (server secret — never the publishable key) in
   the repo `.env`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
3. Run the seed:
   ```bash
   npx tsx data/seed/seed.ts            # writes to Supabase, verifies 6000 / 1500 / 5 / 50
   npx tsx data/seed/seed.ts --dry-run  # parse + validate counts only, no DB writes
   ```
   The script is idempotent: train/test are cleared and re-inserted; the golden
   set is upserted on `scenario_id`; the real set is upserted on
   `(ticker, fiscal_year)`. It fails loudly if any count is off.

## Regenerating more training data

Use the generator to make additional **training** rows (keep test/golden fixed):

```bash
python executiveos_data_generator.py --rows N --seed N --out file.xlsx
# example:
python executiveos_data_generator.py --rows 10000 --seed 7 --out ExecutiveOS_Synthetic_Train_10000.xlsx
```

`--seed` makes generation reproducible. Only regenerate **training** data this
way — never overwrite the held-out test set or the golden seed, or eval results
become meaningless.

## Schema (train / test)

`Date, Region, Country, Business_Unit, Category, Revenue, Profit, Profit_Margin,
Marketing_Spend, Headcount, Customers, Customer_Concentration_%, Churn_%,
Forecast_Accuracy, Risk_Level, Initiative, Owner, Status`
(stored as snake_case columns; `%` columns become `_pct`).

## Schema (golden seed)

`Scenario_ID, Region, Category, Revenue, Profit_Margin, Customer_Concentration_pct,
Churn_pct, Golden_Risk_Level, Golden_Initiative, Golden_Insight_Summary,
Rubric_Criteria`.

## Schema (real metrics)

`ticker, fiscal_year, revenue, profit (operating income), profit_margin,
customer_concentration_pct, concentration_source, concentration_disclosed,
largest_customer, concentration_percentile, marketing_spend, headcount, customers,
churn_pct, forecast_accuracy, imputed_features, risk_level_rule,
risk_level_rule_relative, risk_level_model, model_confidence`.

`risk_level_rule` is the original absolute 60/70% rule; `risk_level_rule_relative`
ranks concentration by percentile among the 10 companies (real-data mode);
`risk_level_model` is the shipped RandomForest (out-of-distribution on real-scale
revenue — see [`docs/REAL_DATA_BACKTEST.md`](../../docs/REAL_DATA_BACKTEST.md)).
`marketing_spend / headcount / customers / churn_pct / forecast_accuracy` are
**imputed** (synthetic-train medians), not from filings.
