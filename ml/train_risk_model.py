"""
Train the deterministic Risk_Level classifier for ExecutiveOS.

Reads executive_metrics_train (data/seed/ExecutiveOS_Synthetic_Train_6000.xlsx),
trains a RandomForest on 9 numeric features, and saves the model + metadata.
The HELD-OUT test set is NEVER touched here — scoring lives in eval_risk_model.py.

Usage:  py ml/train_risk_model.py
Output: ml/risk_model.joblib , ml/risk_model_meta.json
"""
import json
import pathlib
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

ROOT = pathlib.Path(__file__).resolve().parents[1]
TRAIN_XLSX = ROOT / "data" / "seed" / "ExecutiveOS_Synthetic_Train_6000.xlsx"
MODEL_OUT = ROOT / "ml" / "risk_model.joblib"
META_OUT = ROOT / "ml" / "risk_model_meta.json"

# The 9 features the agent will supply, in a fixed order (shared with the TS tool).
FEATURES = [
    "Revenue",
    "Profit",
    "Profit_Margin",
    "Marketing_Spend",
    "Headcount",
    "Customers",
    "Customer_Concentration_%",
    "Churn_%",
    "Forecast_Accuracy",
]
TARGET = "Risk_Level"


def load(path: pathlib.Path) -> pd.DataFrame:
    if not path.exists():
        sys.exit(f"Training file not found: {path}")
    df = pd.read_excel(path)
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        sys.exit(f"Missing columns in training data: {missing}")
    return df


def main() -> None:
    df = load(TRAIN_XLSX)
    X = df[FEATURES].astype(float).to_numpy()
    y = df[TARGET].astype(str).to_numpy()

    print(f"Training rows: {len(df)}")
    print("Class balance:", dict(pd.Series(y).value_counts()))

    # Internal train/validation split (from TRAIN only) for an honest dev signal.
    X_tr, X_val, y_tr, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=2,
        class_weight="balanced",  # classes are imbalanced (Low dominates)
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_tr, y_tr)

    val_pred = clf.predict(X_val)
    val_acc = accuracy_score(y_val, val_pred)
    print(f"\nValidation accuracy (held-out from TRAIN): {val_acc:.4f}")
    print(classification_report(y_val, val_pred, zero_division=0))

    # Refit on ALL training data for the shipped model.
    clf.fit(X, y)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, MODEL_OUT)
    META_OUT.write_text(
        json.dumps(
            {
                "features": FEATURES,
                "classes": clf.classes_.tolist(),
                "model": "RandomForestClassifier",
                "sklearn_target": TARGET,
                "validation_accuracy": round(float(val_acc), 4),
            },
            indent=2,
        )
    )
    print(f"\nSaved model -> {MODEL_OUT}")
    print(f"Saved meta  -> {META_OUT}")
    print("Classes:", clf.classes_.tolist())


if __name__ == "__main__":
    main()
