// Dataset API. Schema inference + numeric coercion happen here (pure, runs
// anywhere); all persistence goes through the Aurora-backed server functions in
// src/lib/db/data.functions.ts (Vercel serverless → Amazon Aurora PostgreSQL).
import type { Dataset, DatasetColumn, DatasetRow } from "./types";
import { fetchRowsFromUrl } from "./connectors";
import {
  dbListDatasets,
  dbGetDataset,
  dbGetDatasetRows,
  dbCreateDataset,
  dbDeleteDataset,
} from "@/lib/db/data.functions";

function inferType(value: unknown): "number" | "date" | "boolean" | "string" {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return "string";
    if (!Number.isNaN(Number(s.replace(/[,$%]/g, "")))) return "number";
    if (!Number.isNaN(Date.parse(s)) && /\d{2,4}[-/]\d{1,2}/.test(s)) return "date";
  }
  return "string";
}

export function inferSchema(rows: DatasetRow[]): DatasetColumn[] {
  if (rows.length === 0) return [];
  const sample = rows.slice(0, 25);
  const keys = Object.keys(sample[0] ?? {});
  return keys.map((name) => {
    const types = sample.map((r) => inferType(r[name])).filter((t) => t !== "string");
    const dominant = types.sort(
      (a, b) => types.filter((t) => t === b).length - types.filter((t) => t === a).length,
    )[0];
    return { name, type: (dominant ?? "string") as DatasetColumn["type"] };
  });
}

export async function listDatasets(): Promise<Dataset[]> {
  return (await dbListDatasets()) as unknown as Dataset[];
}

export async function getDataset(id: string): Promise<Dataset | null> {
  return (await dbGetDataset({ data: { id } })) as unknown as Dataset | null;
}

export async function getDatasetRows(id: string, limit = 5000): Promise<DatasetRow[]> {
  return (await dbGetDatasetRows({ data: { id, limit } })) as unknown as DatasetRow[];
}

export async function createDataset(params: {
  name: string;
  source_filename: string;
  rows: DatasetRow[];
  source_url?: string;
}): Promise<Dataset> {
  const schema = inferSchema(params.rows);
  // Coerce numeric strings to numbers based on the inferred schema.
  const coerced = params.rows.map((row) => {
    const out: DatasetRow = {};
    for (const col of schema) {
      const v = row[col.name];
      if (col.type === "number" && typeof v === "string") {
        const n = Number(v.replace(/[,$%\s]/g, ""));
        out[col.name] = Number.isFinite(n) ? n : null;
      } else {
        out[col.name] = (v ?? null) as DatasetRow[string];
      }
    }
    return out;
  });

  return (await dbCreateDataset({
    data: {
      name: params.name,
      source_filename: params.source_filename,
      source_url: params.source_url ?? null,
      schema,
      rows: coerced,
    },
  })) as unknown as Dataset;
}

export async function deleteDataset(id: string): Promise<void> {
  await dbDeleteDataset({ data: { id } });
}

// Import a dataset directly from a CSV / Google Sheet URL (no file upload). The
// fetch/parse happens client-side; the resulting rows are persisted to Aurora.
export async function importDatasetFromUrl(params: { url: string; name?: string }): Promise<Dataset> {
  const { rows, sourceName } = await fetchRowsFromUrl(params.url);
  return createDataset({
    name: params.name?.trim() || sourceName,
    source_filename: params.url,
    rows,
    source_url: params.url,
  });
}

// Re-pull a dataset from its stored source URL into a fresh, refreshed dataset.
export async function refreshDatasetFromSource(dataset: Dataset): Promise<Dataset> {
  if (!dataset.source_url) throw new Error("This dataset has no source URL to refresh from.");
  const { rows } = await fetchRowsFromUrl(dataset.source_url);
  return createDataset({
    name: `${dataset.name} (refreshed ${new Date().toLocaleDateString()})`,
    source_filename: dataset.source_url,
    rows,
    source_url: dataset.source_url,
  });
}
