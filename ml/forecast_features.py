"""
Shared feature engineering for the Revenue forecast model. Used by both
train_forecast_model.py and eval_forecast_model.py so the encoding is identical
across train/eval/runtime. The same logic is mirrored in the TS tool
(src/lib/ml/forecast-revenue.server.ts) via the saved spec JSON.

Features (fixed order):
  numeric : Marketing_Spend, Customers, Churn_%, days_since_origin, month, day_of_year
  one-hot : Region, Category, Business_Unit  (vocabularies fixed at train time)
Captures trend (days_since_origin) and seasonality (month / day_of_year).
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

import numpy as np
import pandas as pd

DATE_ORIGIN = "2024-01-01"  # generator start date; fixes the trend index origin
NUMERIC = ["Marketing_Spend", "Customers", "Churn_%"]
CAT_COLS = ["Region", "Category", "Business_Unit"]
TARGET = "Revenue"


def _days_since_origin(dates: pd.Series) -> np.ndarray:
    origin = pd.Timestamp(DATE_ORIGIN)
    d = pd.to_datetime(dates)
    return (d - origin).dt.days.to_numpy(dtype=float)


def fit_spec(df: pd.DataFrame) -> dict[str, Any]:
    """Derive the encoding spec (vocabularies + feature order) from TRAIN only."""
    vocab = {c: sorted(df[c].astype(str).unique().tolist()) for c in CAT_COLS}
    feature_names: list[str] = NUMERIC + ["days_since_origin", "month", "day_of_year"]
    for c in CAT_COLS:
        feature_names += [f"{c}={v}" for v in vocab[c]]
    return {
        "date_origin": DATE_ORIGIN,
        "numeric": NUMERIC,
        "cat_cols": CAT_COLS,
        "vocab": vocab,
        "feature_names": feature_names,
        "n_features": len(feature_names),
        "target": TARGET,
    }


def build_matrix(df: pd.DataFrame, spec: dict[str, Any]) -> np.ndarray:
    n = len(df)
    d = pd.to_datetime(df["Date"])
    days = _days_since_origin(df["Date"])
    month = d.dt.month.to_numpy(dtype=float)
    doy = d.dt.dayofyear.to_numpy(dtype=float)

    cols = [
        df["Marketing_Spend"].astype(float).to_numpy(),
        df["Customers"].astype(float).to_numpy(),
        df["Churn_%"].astype(float).to_numpy(),
        days,
        month,
        doy,
    ]
    for c in spec["cat_cols"]:
        vals = df[c].astype(str).to_numpy()
        for v in spec["vocab"][c]:
            cols.append((vals == v).astype(float))
    X = np.column_stack(cols)
    assert X.shape == (n, spec["n_features"]), (X.shape, spec["n_features"])
    return X
