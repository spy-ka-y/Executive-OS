import { describe, it, expect } from "vitest";
import { validateDataset } from "./data-quality";
import type { DatasetColumn, DatasetRow } from "./types";

const schema: DatasetColumn[] = [
  { name: "Region", type: "string" },
  { name: "Revenue", type: "number" },
];

describe("validateDataset", () => {
  it("scores clean data highly with no high-severity issues", () => {
    const rows: DatasetRow[] = Array.from({ length: 30 }, (_, i) => ({ Region: i % 3 ? "A" : "B", Revenue: 100 + i }));
    const r = validateDataset(schema, rows);
    expect(r.score).toBeGreaterThan(80);
    expect(r.issues.filter((x) => x.severity === "high")).toHaveLength(0);
  });

  it("flags heavy missingness as a high-severity issue and lowers the score", () => {
    const rows: DatasetRow[] = Array.from({ length: 20 }, (_, i) => ({ Region: i < 11 ? null : "A", Revenue: 100 }));
    const r = validateDataset(schema, rows);
    expect(r.issues.some((x) => x.severity === "high" && /empty/i.test(x.message))).toBe(true);
    expect(r.score).toBeLessThan(80);
  });

  it("detects duplicate rows", () => {
    const dup = { Region: "A", Revenue: 100 };
    const rows: DatasetRow[] = [dup, { ...dup }, { ...dup }, { Region: "B", Revenue: 200 }];
    const r = validateDataset(schema, rows);
    expect(r.duplicateRows).toBeGreaterThanOrEqual(2);
  });

  it("flags numeric columns that contain non-numeric values", () => {
    const rows: DatasetRow[] = Array.from({ length: 20 }, (_, i) => ({ Region: "A", Revenue: i < 5 ? ("N/A" as unknown as number) : 100 }));
    const r = validateDataset(schema, rows);
    expect(r.issues.some((x) => x.column === "Revenue")).toBe(true);
  });
});
