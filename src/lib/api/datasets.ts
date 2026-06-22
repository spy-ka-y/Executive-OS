import { supabase } from "@/integrations/supabase/client";
import type { Dataset, DatasetColumn, DatasetRow } from "./types";
import { fetchRowsFromUrl } from "./connectors";

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
      (a, b) =>
        types.filter((t) => t === b).length - types.filter((t) => t === a).length,
    )[0];
    return { name, type: (dominant ?? "string") as DatasetColumn["type"] };
  });
}

export async function listDatasets(): Promise<Dataset[]> {
  const { data, error } = await supabase
    .from("datasets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Dataset[];
}

export async function getDataset(id: string): Promise<Dataset | null> {
  const { data, error } = await supabase.from("datasets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Dataset) ?? null;
}

export async function getDatasetRows(id: string, limit = 5000): Promise<DatasetRow[]> {
  const { data, error } = await supabase
    .from("dataset_rows")
    .select("data, row_index")
    .eq("dataset_id", id)
    .order("row_index", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.data as DatasetRow);
}

export async function createDataset(params: {
  name: string;
  source_filename: string;
  rows: DatasetRow[];
  source_url?: string;
}): Promise<Dataset> {
  const schema = inferSchema(params.rows);
  // Coerce numeric strings to numbers based on inferred schema.
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

  const baseInsert = {
    name: params.name,
    source_filename: params.source_filename,
    row_count: coerced.length,
    column_count: schema.length,
    schema: schema as unknown as never,
  };
  let res = await supabase
    .from("datasets")
    .insert({ ...baseInsert, source_url: (params.source_url ?? null) as unknown as never })
    .select()
    .single();
  // Gracefully degrade if the `source_url` column hasn't been migrated yet.
  if (res.error && /source_url/i.test(res.error.message)) {
    res = await supabase.from("datasets").insert(baseInsert).select().single();
  }
  if (res.error) throw res.error;
  const ds = res.data as unknown as Dataset;

  // Cap stored rows at 5000 to keep things snappy.
  const toStore = coerced.slice(0, 5000).map((data, row_index) => ({
    dataset_id: ds.id,
    row_index,
    data: data as unknown as never,
  }));
  // Insert in chunks of 500.
  for (let i = 0; i < toStore.length; i += 500) {
    const chunk = toStore.slice(i, i + 500);
    const { error: insErr } = await supabase.from("dataset_rows").insert(chunk);
    if (insErr) throw insErr;
  }
  return ds;
}

export async function deleteDataset(id: string): Promise<void> {
  const { error } = await supabase.from("datasets").delete().eq("id", id);
  if (error) throw error;
}

// Import a dataset directly from a CSV / Google Sheet URL (no file upload).
// The source URL is stored so the dataset can be refreshed later.
export async function importDatasetFromUrl(params: { url: string; name?: string }): Promise<Dataset> {
  const { rows, sourceName } = await fetchRowsFromUrl(params.url);
  return createDataset({
    name: params.name?.trim() || sourceName,
    source_filename: params.url,
    rows,
    source_url: params.url,
  });
}

// Re-pull a dataset from its stored source URL and create a fresh, refreshed
// dataset (true scheduled refresh would call this from a cron/server job).
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
