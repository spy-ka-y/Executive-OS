import { describe, it, expect } from "vitest";
import {
  linearTrend,
  forecastSeries,
  herfindahl,
  detectAnomalies,
  tDistTwoSidedP,
} from "./statistics";

describe("linearTrend", () => {
  it("recovers a perfect linear slope with R²=1 and a significant p-value", () => {
    const fit = linearTrend([10, 20, 30, 40, 50, 60]);
    expect(fit.slope).toBeCloseTo(10, 5);
    expect(fit.intercept).toBeCloseTo(10, 5);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.pValue).toBeLessThan(0.001);
    expect(fit.strength).toBe("strong");
    expect(fit.direction).toBe("up");
  });

  it("flags pure noise as a weak/flat fit, not a trend", () => {
    const fit = linearTrend([50, 48, 52, 49, 51, 50, 49, 51]);
    expect(fit.r2).toBeLessThan(0.3);
    expect(["weak", "moderate"]).toContain(fit.strength);
    expect(fit.direction).toBe("flat");
  });

  it("treats <4 points as insufficient", () => {
    expect(linearTrend([1, 2, 3]).strength).toBe("insufficient");
  });
});

describe("tDistTwoSidedP", () => {
  it("matches known t-table values within tolerance", () => {
    // t=2.0, df=10 -> p ≈ 0.0734 two-sided
    expect(tDistTwoSidedP(2.0, 10)).toBeCloseTo(0.0734, 2);
    // large t -> tiny p
    expect(tDistTwoSidedP(10, 20)).toBeLessThan(1e-7);
  });
});

describe("forecastSeries", () => {
  it("projects an upward series forward with an ordered prediction interval", () => {
    // Mild noise so the residual variance (and thus interval width) is non-zero.
    const r = forecastSeries([100, 112, 118, 131, 139, 152, 158, 171], 3);
    expect(r.points).toHaveLength(3);
    expect(r.points[0].value).toBeGreaterThan(171);
    expect(r.points[0].lower).toBeLessThan(r.points[0].value);
    expect(r.points[0].upper).toBeGreaterThan(r.points[0].value);
    // A near-linear series should backtest accurately.
    expect(r.backtestMape).not.toBeNull();
    expect(r.backtestMape!).toBeLessThan(10);
  });
});

describe("herfindahl", () => {
  it("reads a single dominant segment as high concentration", () => {
    expect(herfindahl([1]).label).toBe("high");
  });
  it("reads a broad even split as low concentration", () => {
    const h = herfindahl(new Array(8).fill(1 / 8));
    expect(h.label).toBe("low");
  });
});

describe("detectAnomalies", () => {
  it("flags a clear spike and leaves a clean series alone", () => {
    const out = detectAnomalies([10, 11, 10, 12, 11, 200, 10, 11]);
    expect(out.some((a) => a.value === 200 && a.severity === "high")).toBe(true);
    expect(detectAnomalies([10, 10, 10, 10, 10, 10])).toHaveLength(0);
  });
});
