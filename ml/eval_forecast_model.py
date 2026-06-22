"""
Evaluate the Revenue forecast model on the HELD-OUT test set.

Computes MAPE on executive_metrics_test and reports forecast accuracy = 1 - MAPE.
Exits NON-ZERO if accuracy < 0.90. Logs the run to model_eval_runs (local JSONL
always; Supabase if SUPABASE_SERVICE_ROLE_KEY is set).

Usage:  py ml/eval_forecast_model.py
"""
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from forecast_features import build_matrix, TARGET  # noqa: E402
from log_eval_run import log_eval_run  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST_XLSX = ROOT / "data" / "seed" / "ExecutiveOS_Synthetic_Test_1500.xlsx"
MODEL_IN = ROOT / "ml" / "forecast_model.joblib"
META_IN = ROOT / "ml" / "forecast_model_meta.json"
THRESHOLD = 0.90


def main() -> None:
    if not MODEL_IN.exists():
        sys.exit(f"Model not found: {MODEL_IN}. Run train_forecast_model.py first.")
    import json

    spec = json.loads(META_IN.read_text())
    model = joblib.load(MODEL_IN)
    df = pd.read_excel(TEST_XLSX)

    X = build_matrix(df, spec)
    y = df[TARGET].astype(float).to_numpy()
    pred = model.predict(X)

    ape = np.abs((y - pred) / np.clip(np.abs(y), 1e-9, None))
    mape = float(np.mean(ape))
    accuracy = 1 - mape
    rmse = float(np.sqrt(np.mean((y - pred) ** 2)))

    print(f"Held-out test rows: {len(df)}")
    print(f"\nMAPE:              {mape:.4f}")
    print(f"Forecast accuracy: {accuracy:.4f}  (1 - MAPE, target >= {THRESHOLD:.2f})")
    print(f"RMSE:              {rmse:,.0f}")
    print(f"Median APE:        {np.median(ape):.4f}   p90 APE: {np.percentile(ape, 90):.4f}")

    log_eval_run(
        model_name="forecast_revenue_gbr",
        accuracy=round(accuracy, 4),
        metric_type="1-MAPE",
        notes=f"n={len(df)} rmse={rmse:.0f} mape={mape:.4f} held-out test",
    )

    if accuracy < THRESHOLD:
        print(f"\n[FAIL] forecast accuracy {accuracy:.4f} < {THRESHOLD:.2f} target.")
        sys.exit(1)
    print(f"\n[PASS] forecast accuracy {accuracy:.4f} >= {THRESHOLD:.2f} target.")


if __name__ == "__main__":
    main()
