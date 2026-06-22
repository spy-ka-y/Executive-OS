"""
Train the Revenue forecast regressor for ExecutiveOS.

GradientBoostingRegressor on executive_metrics_train, predicting Revenue from
Region/Category/Business_Unit + Marketing_Spend/Customers/Churn_% + a derived
time index (trend) and month/day-of-year (seasonality). The HELD-OUT test set is
never touched here.

Usage:  py ml/train_forecast_model.py
Output: ml/forecast_model.joblib , ml/forecast_model_meta.json
"""
import json
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from forecast_features import fit_spec, build_matrix, TARGET  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRAIN_XLSX = ROOT / "data" / "seed" / "ExecutiveOS_Synthetic_Train_6000.xlsx"
MODEL_OUT = ROOT / "ml" / "forecast_model.joblib"
META_OUT = ROOT / "ml" / "forecast_model_meta.json"


def mape(y, p):
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    return float(np.mean(np.abs((y - p) / np.clip(np.abs(y), 1e-9, None))))


def main() -> None:
    if not TRAIN_XLSX.exists():
        sys.exit(f"Training file not found: {TRAIN_XLSX}")
    df = pd.read_excel(TRAIN_XLSX)

    spec = fit_spec(df)
    X = build_matrix(df, spec)
    y = df[TARGET].astype(float).to_numpy()
    print(f"Training rows: {len(df)} | features: {spec['n_features']}")

    X_tr, X_val, y_tr, y_val = train_test_split(X, y, test_size=0.2, random_state=42)
    model = GradientBoostingRegressor(
        n_estimators=500, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=42
    )
    model.fit(X_tr, y_tr)

    val_pred = model.predict(X_val)
    val_mape = mape(y_val, val_pred)
    print(f"\nValidation MAPE: {val_mape:.4f}  ->  forecast accuracy (1-MAPE): {1 - val_mape:.4f}")

    # Relative-residual std on validation -> a genuine, data-derived basis for the
    # prediction interval the TS tool reports (pred * (1 ± z * rel_resid_std)).
    rel_resid = (y_val - val_pred) / np.clip(np.abs(y_val), 1e-9, None)
    rel_resid_std = float(np.std(rel_resid))
    print(f"Relative residual std (for 90% interval): {rel_resid_std:.4f}")

    # Refit on ALL training data for the shipped model.
    model.fit(X, y)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_OUT)
    spec_out = dict(spec)
    spec_out["model"] = "GradientBoostingRegressor"
    spec_out["validation_mape"] = round(val_mape, 4)
    spec_out["validation_accuracy"] = round(1 - val_mape, 4)
    spec_out["rel_resid_std"] = round(rel_resid_std, 4)
    META_OUT.write_text(json.dumps(spec_out, indent=2))
    print(f"\nSaved model -> {MODEL_OUT}")
    print(f"Saved meta  -> {META_OUT}")


if __name__ == "__main__":
    main()
