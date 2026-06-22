"""
Export the trained Revenue forecast regressor to ONNX for in-process Node
inference (onnxruntime-node), no Python at runtime.

Usage:  py ml/export_forecast_onnx.py
Output: ml/forecast_model.onnx  (input: float32[None, n_features]; output: float)
"""
import json
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import joblib
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODEL_IN = ROOT / "ml" / "forecast_model.joblib"
META_IN = ROOT / "ml" / "forecast_model_meta.json"
ONNX_OUT = ROOT / "ml" / "forecast_model.onnx"


def main() -> None:
    if not MODEL_IN.exists():
        sys.exit(f"Model not found: {MODEL_IN}. Run train_forecast_model.py first.")
    spec = json.loads(META_IN.read_text())
    n = int(spec["n_features"])
    model = joblib.load(MODEL_IN)

    onx = convert_sklearn(
        model,
        initial_types=[("input", FloatTensorType([None, n]))],
        target_opset=17,
    )
    ONNX_OUT.write_bytes(onx.SerializeToString())
    print(f"Saved ONNX -> {ONNX_OUT} ({ONNX_OUT.stat().st_size // 1024} KB)")
    print("Inputs :", [i.name for i in onx.graph.input])
    print("Outputs:", [o.name for o in onx.graph.output])

    spec["onnx_output"] = onx.graph.output[0].name
    spec["onnx_input"] = onx.graph.input[0].name
    META_IN.write_text(json.dumps(spec, indent=2))
    print(f"Updated meta -> {META_IN}")


if __name__ == "__main__":
    main()
