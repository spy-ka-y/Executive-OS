import { describe, it, expect } from "vitest";
import {
  decideTier,
  runInsightPipeline,
  type InsightMetrics,
  type Narrator,
} from "./runInsightPipeline";

const stubNarrator: Narrator = async ({ tier }) => ({
  initiative: `stub-initiative-for-${tier}`,
  narrative: `stub-narrative-for-${tier}`,
});

describe("decideTier", () => {
  it("S01: thin margin + sub-60 concentration → High", () => {
    expect(decideTier({ profit_margin: 4.2, customer_concentration_pct: 58 }).tier).toBe("High");
  });
  it("S02: healthy margin + low concentration → Low", () => {
    expect(decideTier({ profit_margin: 22, customer_concentration_pct: 18 }).tier).toBe("Low");
  });
  it("S03: negative margin alone → Critical even at low concentration", () => {
    expect(decideTier({ profit_margin: -1.8, customer_concentration_pct: 44 }).tier).toBe("Critical");
  });
  it("S04: concentration > 70 → Critical even with a healthy margin", () => {
    expect(decideTier({ profit_margin: 12.5, customer_concentration_pct: 74 }).tier).toBe("Critical");
  });
  it("60 < concentration ≤ 70 → High", () => {
    expect(decideTier({ profit_margin: 30, customer_concentration_pct: 65 }).tier).toBe("High");
  });
  it("S05: missing core fields → null tier and lists missing fields", () => {
    const r = decideTier({ profit_margin: null, customer_concentration_pct: null, revenue: null, churn_pct: null });
    expect(r.tier).toBeNull();
    expect(r.missingFields).toContain("profit_margin");
    expect(r.missingFields).toContain("customer_concentration_pct");
  });
  it("a single missing core field is still a refusal", () => {
    expect(decideTier({ profit_margin: 10, customer_concentration_pct: null }).tier).toBeNull();
  });
});

describe("runInsightPipeline", () => {
  it("uses the injected narrator for a decidable scenario", async () => {
    const out = await runInsightPipeline(
      { profit_margin: 4.2, customer_concentration_pct: 58 } as InsightMetrics,
      stubNarrator,
    );
    expect(out.riskLevel).toBe("High");
    expect(out.tierSource).toBe("rule");
    expect(out.initiative).toBe("stub-initiative-for-High");
    expect(out.insufficientData).toBe(false);
  });

  it("refuses (no tier, no invented numbers) when core fields are missing", async () => {
    const out = await runInsightPipeline(
      { revenue: null, profit_margin: null, customer_concentration_pct: null, churn_pct: null },
      stubNarrator,
    );
    expect(out.riskLevel).toBeNull();
    expect(out.insufficientData).toBe(true);
    expect(out.tierSource).toBe("none");
    expect(out.narratedBy).toBe("none");
    expect(out.initiative).toBe("N/A — request missing fields");
    expect(out.missingFields.length).toBeGreaterThan(0);
    // refusal narrative must not contain fabricated digits
    expect(/\d/.test(out.narrative)).toBe(false);
  });

  it("falls back to a templated narrative when the narrator throws", async () => {
    const throwing: Narrator = async () => {
      throw new Error("gemini down");
    };
    const out = await runInsightPipeline(
      { profit_margin: -1.8, customer_concentration_pct: 44 },
      throwing,
    );
    expect(out.riskLevel).toBe("Critical");
    expect(out.narratedBy).toBe("fallback");
    expect(out.initiative.length).toBeGreaterThan(0);
  });
});
