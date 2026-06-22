// Server-only risk classifier tool. Runs the trained RandomForest (exported to
// ONNX at ml/risk_model.onnx) in-process via onnxruntime-node — no Python at
// runtime. The model, not the LLM, decides the risk tier; the agent narrates.
//
// onnxruntime-node is imported lazily so this module never affects the client
// bundle or SSR startup, and a missing runtime/model surfaces as an honest
// error (caller falls back to NOT_COMPUTABLE rather than faking a tier).
import * as path from "node:path";
import * as fs from "node:fs";

// Feature order MUST match ml/train_risk_model.py FEATURES exactly.
export const RISK_FEATURES = [
  "revenue",
  "profit",
  "profit_margin",
  "marketing_spend",
  "headcount",
  "customers",
  "customer_concentration_pct",
  "churn_pct",
  "forecast_accuracy",
] as const;

// Class order MUST match risk_model_meta.json -> onnx_classes (clf.classes_).
const CLASS_ORDER = ["Critical", "High", "Low"] as const;
export type RiskLevel = (typeof CLASS_ORDER)[number];

export type RiskMetrics = Record<(typeof RISK_FEATURES)[number], number | null | undefined>;

export interface RiskPrediction {
  riskLevel: RiskLevel;
  confidence: number; // 0..1, the predicted class probability
  probabilities: Record<RiskLevel, number>;
  source: "model";
  model: "RandomForest(ONNX)";
}

function modelPath(): string {
  // Resolve from project root; in production the ml/ folder must be shipped
  // alongside the server bundle (see ml/README or vercel includeFiles).
  return path.join(process.cwd(), "ml", "risk_model.onnx");
}

// Cache the session across calls (cold-start cost paid once).
let sessionPromise: Promise<unknown> | null = null;
async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const p = modelPath();
      if (!fs.existsSync(p)) {
        throw new Error(
          `Risk model not found at ${p}. Run: py ml/train_risk_model.py && py ml/export_onnx.py`,
        );
      }
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(p);
    })().catch((e) => {
      sessionPromise = null; // allow retry on transient failure
      throw e;
    });
  }
  return sessionPromise;
}

export function isRiskModelAvailable(): boolean {
  try {
    return fs.existsSync(modelPath());
  } catch {
    return false;
  }
}

/**
 * Deterministic risk-tier prediction from the trained model.
 * @throws if the ONNX runtime or model file is unavailable (never fabricates a tier).
 */
export async function predictRiskLevel(metrics: RiskMetrics): Promise<RiskPrediction> {
  const ort = await import("onnxruntime-node");
  const session = (await getSession()) as Awaited<ReturnType<typeof ort.InferenceSession.create>>;

  const features = Float32Array.from(
    RISK_FEATURES.map((f) => {
      const v = metrics[f];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    }),
  );
  const input = new ort.Tensor("float32", features, [1, RISK_FEATURES.length]);

  const inputName = session.inputNames[0] ?? "input";
  const out = await session.run({ [inputName]: input });

  // Read the probability tensor (zipmap=False => plain float tensor [1, n_classes]).
  const probTensor = out["probabilities"] ?? out[session.outputNames.find((n) => n !== "label") ?? "probabilities"];
  const probs = Array.from(probTensor.data as Float32Array | number[], Number);

  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;

  const probabilities = Object.fromEntries(
    CLASS_ORDER.map((c, i) => [c, Number((probs[i] ?? 0).toFixed(4))]),
  ) as Record<RiskLevel, number>;

  return {
    riskLevel: CLASS_ORDER[bestIdx],
    confidence: Number((probs[bestIdx] ?? 0).toFixed(4)),
    probabilities,
    source: "model",
    model: "RandomForest(ONNX)",
  };
}
