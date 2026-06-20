import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readGoldenXlsx, metricsFromScenario, loadScenarios } from "./scenarios";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const XLSX_PATH = path.join(ROOT, "data", "seed", "ExecutiveOS_LLM_Eval_Golden_Seed.xlsx");

describe("readGoldenXlsx", () => {
  it("reads the 5 golden scenarios with normalized fields", () => {
    const rows = readGoldenXlsx(XLSX_PATH);
    expect(rows).toHaveLength(5);
    const s01 = rows.find((r) => r.scenario_id === "S01")!;
    expect(s01.profit_margin).toBe(4.2);
    expect(s01.customer_concentration_pct).toBe(58);
    expect(s01.golden_risk_level).toBe("High");
  });
  it("normalizes the all-null S05 numeric fields to null", () => {
    const s05 = readGoldenXlsx(XLSX_PATH).find((r) => r.scenario_id === "S05")!;
    expect(s05.profit_margin).toBeNull();
    expect(s05.customer_concentration_pct).toBeNull();
    expect(s05.golden_risk_level).toBe("Insufficient data");
  });
});

describe("metricsFromScenario", () => {
  it("maps a scenario to the agent's InsightMetrics shape", () => {
    const s = readGoldenXlsx(XLSX_PATH).find((r) => r.scenario_id === "S03")!;
    const m = metricsFromScenario(s);
    expect(m.profit_margin).toBe(-1.8);
    expect(m.customer_concentration_pct).toBe(44);
  });
});

describe("loadScenarios", () => {
  it("falls back to xlsx when no databaseUrl is provided", async () => {
    const { scenarios, source } = await loadScenarios({ xlsxPath: XLSX_PATH });
    expect(source).toBe("xlsx");
    expect(scenarios).toHaveLength(5);
  });
  it("falls back to xlsx when the database is unreachable", async () => {
    const { source } = await loadScenarios({
      databaseUrl: "postgres://invalid:invalid@127.0.0.1:1/none",
      xlsxPath: XLSX_PATH,
    });
    expect(source).toBe("xlsx");
  });
});
