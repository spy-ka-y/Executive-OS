"""
Evaluate the Risk_Level classifier on the HELD-OUT test set.

Reads executive_metrics_test (data/seed/ExecutiveOS_Synthetic_Test_1500.xlsx),
predicts Risk_Level for every row, and reports overall accuracy AND per-class
precision/recall/F1 (classes are imbalanced — accuracy alone is not enough).

Exits NON-ZERO if accuracy < 0.90 (CI gate for the >90% target).

Usage:  py ml/eval_risk_model.py
"""
import pathlib
import sys

# Windows consoles default to cp1252; force UTF-8 so output never crashes the gate.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import joblib
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from log_eval_run import log_eval_run  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST_XLSX = ROOT / "data" / "seed" / "ExecutiveOS_Synthetic_Test_1500.xlsx"
MODEL_IN = ROOT / "ml" / "risk_model.joblib"

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
THRESHOLD = 0.90


def main() -> None:
    if not MODEL_IN.exists():
        sys.exit(f"Model not found: {MODEL_IN}. Run train_risk_model.py first.")
    if not TEST_XLSX.exists():
        sys.exit(f"Test file not found: {TEST_XLSX}")

    clf = joblib.load(MODEL_IN)
    df = pd.read_excel(TEST_XLSX)
    X = df[FEATURES].astype(float).to_numpy()
    y_true = df[TARGET].astype(str).to_numpy()
    y_pred = clf.predict(X)

    acc = accuracy_score(y_true, y_pred)
    labels = sorted(set(y_true) | set(y_pred))

    print(f"Held-out test rows: {len(df)}")
    print(f"\nOverall accuracy: {acc:.4f}\n")
    print("Per-class precision / recall / F1 (imbalanced — read these, not just accuracy):")
    print(classification_report(y_true, y_pred, labels=labels, digits=4, zero_division=0))
    print("Confusion matrix (rows=true, cols=pred), labels:", labels)
    print(confusion_matrix(y_true, y_pred, labels=labels))

    # Persist per-class precision/recall/F1 as JSON in `notes` so the in-app
    # Accuracy dashboard (src/routes/accuracy.tsx) can chart per-class F1, not
    # just overall accuracy. The dashboard parses this with parsePerClassF1().
    import json

    report = classification_report(
        y_true, y_pred, labels=labels, output_dict=True, zero_division=0
    )
    per_class = {
        label: {
            "precision": round(float(report[label]["precision"]), 4),
            "recall": round(float(report[label]["recall"]), 4),
            "f1": round(float(report[label]["f1-score"]), 4),
            "support": int(report[label]["support"]),
        }
        for label in labels
    }
    notes = json.dumps(
        {
            "n": int(len(df)),
            "split": "held-out test",
            "classes": labels,
            "per_class": per_class,
        }
    )

    log_eval_run(
        model_name="risk_level_rf",
        accuracy=round(float(acc), 4),
        metric_type="accuracy",
        notes=notes,
    )

    if acc < THRESHOLD:
        print(f"\n[FAIL] accuracy {acc:.4f} < {THRESHOLD:.2f} target.")
        sys.exit(1)
    print(f"\n[PASS] accuracy {acc:.4f} >= {THRESHOLD:.2f} target.")


if __name__ == "__main__":
    main()
