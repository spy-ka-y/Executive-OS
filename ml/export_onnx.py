"""
Export the trained RandomForest risk model to ONNX so TanStack Start can run
inference in-process via onnxruntime-node (no Python runtime in production).

Usage:  py ml/export_onnx.py
Output: ml/risk_model.onnx   (input: float32[None,9]; outputs: label + probabilities)
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
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODEL_IN = ROOT / "ml" / "risk_model.joblib"
META_IN = ROOT / "ml" / "risk_model_meta.json"
ONNX_OUT = ROOT / "ml" / "risk_model.onnx"

N_FEATURES = 9


def main() -> None:
    if not MODEL_IN.exists():
        sys.exit(f"Model not found: {MODEL_IN}. Run train_risk_model.py first.")
    clf = joblib.load(MODEL_IN)

    initial_types = [("input", FloatTensorType([None, N_FEATURES]))]
    # zipmap=False -> probabilities come out as a plain float tensor [None, n_classes],
    # which is trivial to read from onnxruntime-node.
    onx = convert_sklearn(
        clf,
        initial_types=initial_types,
        options={id(clf): {"zipmap": False}},
        target_opset=17,
    )
    ONNX_OUT.write_bytes(onx.SerializeToString())
    print(f"Saved ONNX -> {ONNX_OUT} ({ONNX_OUT.stat().st_size // 1024} KB)")
    print("Outputs:", [o.name for o in onx.graph.output])
    print("Classes (label order):", clf.classes_.tolist())

    # Refresh meta with class order so the TS side maps probabilities correctly.
    meta = json.loads(META_IN.read_text()) if META_IN.exists() else {}
    meta["onnx_classes"] = clf.classes_.tolist()
    meta["onnx_input"] = "input"
    meta["onnx_n_features"] = N_FEATURES
    META_IN.write_text(json.dumps(meta, indent=2))
    print(f"Updated meta -> {META_IN}")


if __name__ == "__main__":
    main()
