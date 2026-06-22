// Server-only Revenue forecast tool. Runs the trained GradientBoostingRegressor
// (exported to ONNX) in-process via onnxruntime-node. The MODEL produces the
// number; the agent narrates around it. Feature engineering mirrors
// ml/forecast_features.py exactly, driven by the saved spec (ml/forecast_model_meta.json).
import * as path from "node:path";
import * as fs from "node:fs";

export interface ForecastInputs {
  date: string; // ISO "YYYY-MM-DD" — the period being forecast (trend + seasonality)
  region: string;
  category: string;
  business_unit: string;
  marketing_spend: number;
  customers: number;
  churn_pct: number;
}

export interface ForecastResult {
  predictedRevenue: number;
  confidenceInterval: { lower: number; upper: number; level: number };
  source: "model";
  model: "GradientBoostingRegressor(ONNX)";
}

interface Spec {
  date_origin: string;
  cat_cols: string[];
  vocab: Record<string, string[]>;
  feature_names: string[];
  n_features: number;
  rel_resid_std: number;
  onnx_output?: string;
  onnx_input?: string;
}

const Z_90 = 1.645; // 90% interval

function mlDir() {
  return path.join(process.cwd(), "ml");
}
function loadSpec(): Spec {
  const p = path.join(mlDir(), "forecast_model_meta.json");
  if (!fs.existsSync(p)) throw new Error(`Forecast spec not found at ${p}. Run train + export first.`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Spec;
}
function modelPath() {
  return path.join(mlDir(), "forecast_model.onnx");
}

let specCache: Spec | null = null;
let sessionPromise: Promise<unknown> | null = null;
async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const p = modelPath();
      if (!fs.existsSync(p)) throw new Error(`Forecast model not found at ${p}. Run ml/export_forecast_onnx.py.`);
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(p);
    })().catch((e) => { sessionPromise = null; throw e; });
  }
  return sessionPromise;
}

export function isForecastModelAvailable(): boolean {
  try { return fs.existsSync(modelPath()) && fs.existsSync(path.join(mlDir(), "forecast_model_meta.json")); }
  catch { return false; }
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

// Build the feature vector in the exact order of ml/forecast_features.py.
function buildFeatures(inp: ForecastInputs, spec: Spec): Float32Array {
  const d = new Date(inp.date + (inp.date.length <= 10 ? "T00:00:00Z" : ""));
  const origin = new Date(spec.date_origin + "T00:00:00Z");
  const daysSinceOrigin = Math.round((d.getTime() - origin.getTime()) / 86400000);
  const month = d.getUTCMonth() + 1;
  const doy = dayOfYear(d);

  const vals: number[] = [inp.marketing_spend, inp.customers, inp.churn_pct, daysSinceOrigin, month, doy];
  const byCol: Record<string, string> = {
    Region: inp.region,
    Category: inp.category,
    Business_Unit: inp.business_unit,
  };
  for (const c of spec.cat_cols) {
    for (const v of spec.vocab[c]) vals.push(byCol[c] === v ? 1 : 0);
  }
  if (vals.length !== spec.n_features) {
    throw new Error(`Feature length ${vals.length} != expected ${spec.n_features}`);
  }
  return Float32Array.from(vals);
}

/**
 * Deterministic Revenue forecast from the trained model.
 * @throws if the ONNX runtime / model is unavailable (never fabricates a number).
 */
export async function forecastRevenue(inputs: ForecastInputs): Promise<ForecastResult> {
  const spec = (specCache ??= loadSpec());
  const ort = await import("onnxruntime-node");
  const session = (await getSession()) as Awaited<ReturnType<typeof ort.InferenceSession.create>>;

  const features = buildFeatures(inputs, spec);
  const inputName = session.inputNames[0] ?? spec.onnx_input ?? "input";
  const out = await session.run({ [inputName]: new ort.Tensor("float32", features, [1, spec.n_features]) });

  const outName = spec.onnx_output ?? session.outputNames[0];
  const predictedRevenue = Number((out[outName].data as Float32Array | number[])[0]);

  const halfWidth = Z_90 * spec.rel_resid_std * Math.abs(predictedRevenue);
  return {
    predictedRevenue: Math.round(predictedRevenue),
    confidenceInterval: {
      lower: Math.round(predictedRevenue - halfWidth),
      upper: Math.round(predictedRevenue + halfWidth),
      level: 0.9,
    },
    source: "model",
    model: "GradientBoostingRegressor(ONNX)",
  };
}
