// Honest estimators. Every forward-looking figure the product shows goes
// through here so it is either (a) derived from the firm's own data with the
// basis disclosed, or (b) explicitly gated with the columns needed to compute
// it. No fixed "industry" coefficients are invented as if they were facts.
import type { BusinessIntelligence } from "./intelligence";
import { formatMoney } from "./intelligence";

export interface Estimate {
  computable: boolean;
  /** Formatted value band, or the gated "add column X" message. */
  display: string;
  /** Plain-English provenance shown to the user (empty when not computable). */
  basis: string;
  low: number | null;
  high: number | null;
}

function gated(note: string): Estimate {
  return { computable: false, display: note, basis: "", low: null, high: null };
}

// Forward revenue upside band for an initiative scaling `base` revenue.
// Grounded in the firm's realized period growth; gated when there is no series.
export function revenueUpsideBand(intel: BusinessIntelligence | null, base: number): Estimate {
  if (!intel) return gated("Add a date column so upside can be derived from your trend.");
  const band = intel.upsideBandPct;
  if (!band || base <= 0) {
    return gated(intel.capability.needs("growth"));
  }
  const low = base * (band.low / 100);
  const high = base * (band.high / 100);
  return {
    computable: true,
    display: `+${formatMoney(low)} to +${formatMoney(high)}`,
    basis: `Based on your realized period growth (${band.low}%–${band.high}% range), applied to ${formatMoney(base)}.`,
    low,
    high,
  };
}

// Revenue impact of a price change, using elasticity estimated from the firm's
// own price/units data. Gated when those columns are absent.
export function priceChangeRevenueImpact(
  intel: BusinessIntelligence | null,
  base: number,
  pricePct: number,
): Estimate {
  if (!intel) return gated("Add price and units columns to estimate elasticity.");
  const e = intel.priceElasticity;
  if (e === null || base <= 0) {
    return gated(intel.capability.needs("price.elasticity"));
  }
  // %ΔQ ≈ elasticity × %ΔP; revenue factor = (1+ΔP)(1+ΔQ).
  const qtyPct = e * pricePct;
  const factor = (1 + pricePct / 100) * (1 + qtyPct / 100);
  const impact = base * (factor - 1);
  return {
    computable: true,
    display: `${impact >= 0 ? "+" : ""}${formatMoney(impact)}`,
    basis: `Using price elasticity ${e} estimated from your price/units columns (a ${pricePct}% price move implies a ${qtyPct.toFixed(1)}% volume move).`,
    low: impact,
    high: impact,
  };
}

// Scenario shock exposure. The shock percentage is a disclosed, user-facing
// assumption (a stress test), applied to a real exposure base. We label it as
// a scenario so it is never mistaken for a prediction.
export function shockExposure(base: number, shockLowPct: number, shockHighPct: number): Estimate {
  if (base <= 0) return gated("No revenue base to stress-test.");
  const low = base * (shockLowPct / 100);
  const high = base * (shockHighPct / 100);
  return {
    computable: true,
    display: `${formatMoney(low)}–${formatMoney(high)}`,
    basis: `Scenario: a ${shockLowPct}–${shockHighPct}% shock to ${formatMoney(base)} of exposed revenue.`,
    low,
    high,
  };
}
