// Data-quality validation. Before any insight is trusted, the uploaded data is
// profiled: missingness, type consistency, duplicate rows, constant columns and
// numeric outliers. This is the "garbage in" guard — the UI surfaces concrete
// issues (and a 0-100 score) instead of silently analyzing broken data.
import type { DatasetColumn, DatasetRow, ColumnType } from "./types";
import { detectAnomalies } from "./statistics";

export interface ColumnQuality {
  name: string;
  type: ColumnType;
  missingPct: number;
  /** % of present values that actually parse as the declared type. */
  typeConsistencyPct: number;
  distinctCount: number;
  isConstant: boolean;
  outlierCount: number;
}

export interface QualityIssue {
  severity: "high" | "med" | "low";
  column?: string;
  message: string;
}

export interface DataQualityReport {
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  columns: ColumnQuality[];
  issues: QualityIssue[];
  score: number; // 0..100, higher is cleaner
}

function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const s = v.replace(/[,$%\s]/g, "");
    return s !== "" && Number.isFinite(Number(s));
  }
  return false;
}

function isDateish(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return !Number.isNaN(Date.parse(v)) && /\d{2,4}[-/]\d{1,2}/.test(v);
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function validateDataset(schema: DatasetColumn[], rows: DatasetRow[]): DataQualityReport {
  const rowCount = rows.length;
  const columns: ColumnQuality[] = [];
  const issues: QualityIssue[] = [];

  // Duplicate rows (exact match on serialized values).
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const r of rows) {
    const key = JSON.stringify(schema.map((c) => r[c.name] ?? null));
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }
  if (rowCount > 0 && duplicateRows / rowCount > 0.02) {
    issues.push({
      severity: duplicateRows / rowCount > 0.1 ? "high" : "med",
      message: `${duplicateRows} duplicate rows (${((duplicateRows / rowCount) * 100).toFixed(0)}% of the data) — these double-count in every total.`,
    });
  }

  for (const col of schema) {
    const values = rows.map((r) => r[col.name]);
    const present = values.filter((v) => !isMissing(v));
    const missingPct = rowCount ? ((rowCount - present.length) / rowCount) * 100 : 0;
    const distinct = new Set(present.map((v) => String(v)));
    const isConstant = distinct.size <= 1 && present.length > 0;

    let consistent = present.length;
    if (col.type === "number") consistent = present.filter(isNumeric).length;
    else if (col.type === "date") consistent = present.filter((v) => isDateish(v) || isNumeric(v)).length;
    const typeConsistencyPct = present.length ? (consistent / present.length) * 100 : 100;

    let outlierCount = 0;
    if (col.type === "number") {
      const nums = present
        .map((v) => (typeof v === "number" ? v : Number(String(v).replace(/[,$%\s]/g, ""))))
        .filter((n) => Number.isFinite(n));
      outlierCount = detectAnomalies(nums).filter((a) => a.severity !== "low").length;
    }

    columns.push({
      name: col.name,
      type: col.type,
      missingPct: Number(missingPct.toFixed(1)),
      typeConsistencyPct: Number(typeConsistencyPct.toFixed(1)),
      distinctCount: distinct.size,
      isConstant,
      outlierCount,
    });

    // Column-level issues.
    if (missingPct >= 40) issues.push({ severity: "high", column: col.name, message: `"${col.name}" is ${missingPct.toFixed(0)}% empty — any metric using it is unreliable.` });
    else if (missingPct >= 15) issues.push({ severity: "med", column: col.name, message: `"${col.name}" is ${missingPct.toFixed(0)}% empty.` });
    if (col.type === "number" && typeConsistencyPct < 90) issues.push({ severity: "med", column: col.name, message: `"${col.name}" is typed as a number but ${(100 - typeConsistencyPct).toFixed(0)}% of values are not numeric (mixed units or text?).` });
    if (isConstant) issues.push({ severity: "low", column: col.name, message: `"${col.name}" is the same value in every row — it carries no signal.` });
  }

  if (rowCount === 0) issues.push({ severity: "high", message: "The dataset has no rows." });
  else if (rowCount < 12) issues.push({ severity: "med", message: `Only ${rowCount} rows — trends, forecasts and segment breakdowns will be low-confidence.` });

  // Score: start at 100, deduct for missingness, type drift, duplicates, severity.
  let score = 100;
  const avgMissing = columns.length ? columns.reduce((a, c) => a + c.missingPct, 0) / columns.length : 0;
  score -= Math.min(30, avgMissing * 0.8);
  const avgTypeDrift = columns.length ? columns.reduce((a, c) => a + (100 - c.typeConsistencyPct), 0) / columns.length : 0;
  score -= Math.min(25, avgTypeDrift * 0.6);
  score -= Math.min(20, (rowCount ? (duplicateRows / rowCount) * 100 : 0) * 1.2);
  score -= issues.filter((i) => i.severity === "high").length * 8;
  score -= issues.filter((i) => i.severity === "med").length * 3;
  score = Math.max(0, Math.round(score));

  return { rowCount, columnCount: schema.length, duplicateRows, columns, issues, score };
}
