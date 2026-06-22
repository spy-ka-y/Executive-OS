import { describe, it, expect } from "vitest";
import { revenueUpsideBand, priceChangeRevenueImpact, shockExposure } from "./estimates";
import type { BusinessIntelligence } from "./intelligence";

// Minimal stand-ins for the parts of BusinessIntelligence the estimators read.
const withBand = { upsideBandPct: { low: 4, high: 9 } } as unknown as BusinessIntelligence;
const noBand = {
  upsideBandPct: null,
  capability: { needs: () => "Needs Date column" },
} as unknown as BusinessIntelligence;
const withElasticity = { priceElasticity: -1.5 } as unknown as BusinessIntelligence;
const noElasticity = {
  priceElasticity: null,
  capability: { needs: () => "Needs price and units columns" },
} as unknown as BusinessIntelligence;

describe("revenueUpsideBand", () => {
  it("is gated when no intel or no series", () => {
    expect(revenueUpsideBand(null, 1000).computable).toBe(false);
    expect(revenueUpsideBand(noBand, 1000).computable).toBe(false);
  });
  it("computes a band from the realized growth when available", () => {
    const e = revenueUpsideBand(withBand, 100000);
    expect(e.computable).toBe(true);
    expect(e.low).toBeCloseTo(4000, 0);
    expect(e.high).toBeCloseTo(9000, 0);
    expect(e.display).toContain("+");
  });
});

describe("priceChangeRevenueImpact", () => {
  it("is gated without an estimated elasticity", () => {
    expect(priceChangeRevenueImpact(noElasticity, 1000, 10).computable).toBe(false);
  });
  it("applies elasticity: a price rise with elastic demand reduces revenue", () => {
    const e = priceChangeRevenueImpact(withElasticity, 100000, 10);
    expect(e.computable).toBe(true);
    // +10% price, elasticity -1.5 -> -15% volume -> (1.1)(0.85) = 0.935 -> negative impact
    expect(e.low!).toBeLessThan(0);
  });
});

describe("shockExposure", () => {
  it("returns a labeled scenario band", () => {
    const e = shockExposure(100000, 15, 30);
    expect(e.computable).toBe(true);
    expect(e.low).toBeCloseTo(15000, 0);
    expect(e.high).toBeCloseTo(30000, 0);
    expect(e.basis.toLowerCase()).toContain("scenario");
  });
});
