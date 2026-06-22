import { describe, it, expect } from "vitest";
import { analyzeCapability } from "./capability";
import type { DatasetColumn, DatasetRow } from "./types";

const schema: DatasetColumn[] = [
  { name: "Date", type: "date" },
  { name: "Region", type: "string" },
  { name: "Revenue", type: "number" },
];
const rows: DatasetRow[] = Array.from({ length: 8 }, (_, i) => ({
  Date: `2024-0${(i % 9) + 1}-01`,
  Region: i % 2 ? "EMEA" : "AMER",
  Revenue: 1000 + i * 100,
}));

describe("analyzeCapability", () => {
  it("detects roles from column names", () => {
    const cap = analyzeCapability(schema, rows);
    expect(cap.has("revenue")).toBe(true);
    expect(cap.has("region")).toBe(true);
    expect(cap.has("date")).toBe(true);
    expect(cap.has("customer")).toBe(false);
  });

  it("marks region concentration computable but customer concentration not", () => {
    const cap = analyzeCapability(schema, rows);
    expect(cap.can("region.concentration")).toBe(true);
    expect(cap.status("customer.concentration")).toBe("not_computable");
    // The gate message names the missing column.
    expect(cap.needs("customer.concentration").toLowerCase()).toContain("customer");
  });

  it("gates price elasticity when price/units columns are absent", () => {
    const cap = analyzeCapability(schema, rows);
    expect(cap.status("price.elasticity")).toBe("not_computable");
  });

  it("treats profit as computable when revenue + cost are present", () => {
    const withCost: DatasetColumn[] = [...schema, { name: "Cost", type: "number" }];
    const cap = analyzeCapability(withCost, rows.map((r) => ({ ...r, Cost: 500 })));
    expect(cap.can("margin")).toBe(true);
  });
});
