# Risk_Level model — deterministic, measurable risk tiering

Replaces the LLM's free-text risk judgment with a trained classifier. The
**model decides the tier**; the agent only narrates *why*.

**Result: 97.33% accuracy on the held-out test set** (`executive_metrics_test`,
1500 rows) — see per-class precision/recall/F1 below.

## Pipeline

| Step | Command | Output |
|---|---|---|
| 1. Train | `py ml/train_risk_model.py` | `ml/risk_model.joblib`, `ml/risk_model_meta.json` |
| 2. Export to ONNX | `py ml/export_onnx.py` | `ml/risk_model.onnx` (runs in Node, no Python at runtime) |
| 3. Eval (CI gate) | `py ml/eval_risk_model.py` | prints accuracy + per-class P/R/F1; **exits non-zero if < 90%** |
| 4. TS parity check | `npx tsx ml/parity_check.ts` | confirms the Node/ONNX tool matches Python (97.33%) |

Setup: `py -m pip install -r ml/requirements.txt` and `npm i` (adds `onnxruntime-node`).

## Held-out test results (latest run)

```
Overall accuracy: 0.9733  (target ≥ 0.90 ✓)

              precision   recall   f1-score   support
   Critical     0.9697   0.8591    0.9110        149
       High     0.9563   0.9107    0.9329        168
        Low     0.9760   0.9966    0.9862       1183
```
Classes are imbalanced (Low dominates), so the per-class F1 matters more than
accuracy — all three classes are ≥ 0.91 F1.

## Features (fixed order, shared with the TS tool)
`Revenue, Profit, Profit_Margin, Marketing_Spend, Headcount, Customers,
Customer_Concentration_%, Churn_%, Forecast_Accuracy` → model → `Risk_Level ∈
{Critical, High, Low}`. **No leakage:** trained on `*_Train_6000`, scored only on
the held-out `*_Test_1500`.

## How the app uses it
- `src/lib/ml/predict-risk.server.ts` — `predictRiskLevel(metrics) → { riskLevel,
  confidence, probabilities }`. Server-only; lazy-loads `onnxruntime-node` so it
  never touches the client bundle. Throws (never fabricates) if the model is
  unavailable.
- `src/lib/agents/executeRisk.functions.ts` — `assessRiskLevel` server function:
  **calls `predictRiskLevel` FIRST**, then Gemini writes the narrative *around*
  the fixed tier (the LLM explains the "why", the model decides the "what"). Falls
  back to a transparent templated narrative if Gemini is down — the tier is always
  the model's.

## Deploying the ONNX runtime (Vercel note)
`risk_model.onnx` (~8 MB) + `onnxruntime-node` (native binary) must be present in
the serverless function for prod inference. If Vercel's function size/native-binary
limits make that impractical, the alternative is a tiny FastAPI `/predict-risk`
microservice loading `risk_model.joblib` (the codebase already supports a
`VITE_AI_BACKEND=fastapi` switch). Locally everything runs in-process — no Python.

## Retraining
Regenerate more **training** data only (never the test/golden sets):
```
python data/seed/executiveos_data_generator.py --rows N --seed N --out data/seed/<file>.xlsx
```
then re-run steps 1–4.
