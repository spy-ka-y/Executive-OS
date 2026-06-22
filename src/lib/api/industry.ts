// Industry calibration. The same margin or growth number means very different
// things for a SaaS company vs a grocer, so thresholds and framing are tuned per
// business type instead of one-size-fits-all. The selected profile feeds both
// the AI grounding (so narratives are industry-aware) and the heuristic verdicts.

export type IndustryId = "generic" | "saas" | "retail" | "ecommerce" | "manufacturing" | "services" | "marketplace";

export interface IndustryProfile {
  id: IndustryId;
  label: string;
  /** Gross/operating margin that reads as healthy for this industry (%). */
  healthyMarginPct: number;
  /** Margin below which the business is structurally thin (%). */
  thinMarginPct: number;
  /** Period growth that counts as strong for this industry (%). */
  strongGrowthPct: number;
  /** Top-segment / customer share above which concentration is a real concern (%). */
  concentrationConcernPct: number;
  /** One-line note injected into the AI prompt for framing. */
  framing: string;
}

export const INDUSTRY_PROFILES: Record<IndustryId, IndustryProfile> = {
  generic: {
    id: "generic", label: "General business",
    healthyMarginPct: 18, thinMarginPct: 10, strongGrowthPct: 8, concentrationConcernPct: 40,
    framing: "A general business; apply balanced thresholds and avoid sector-specific assumptions.",
  },
  saas: {
    id: "saas", label: "SaaS / Software",
    healthyMarginPct: 75, thinMarginPct: 55, strongGrowthPct: 20, concentrationConcernPct: 30,
    framing: "A SaaS business: gross margins of 70-85% are normal, growth and net revenue retention matter more than near-term profit, and logo/customer concentration is a key risk.",
  },
  retail: {
    id: "retail", label: "Retail",
    healthyMarginPct: 8, thinMarginPct: 3, strongGrowthPct: 5, concentrationConcernPct: 45,
    framing: "A retailer: net margins of 3-8% are normal, so judge margin on that scale; inventory turns, same-store growth and seasonality dominate.",
  },
  ecommerce: {
    id: "ecommerce", label: "E-commerce / DTC",
    healthyMarginPct: 12, thinMarginPct: 5, strongGrowthPct: 12, concentrationConcernPct: 45,
    framing: "A DTC/e-commerce business: contribution margin after CAC and shipping matters most; growth and repeat-purchase rate are key; margins of 8-15% are typical.",
  },
  manufacturing: {
    id: "manufacturing", label: "Manufacturing",
    healthyMarginPct: 15, thinMarginPct: 7, strongGrowthPct: 6, concentrationConcernPct: 50,
    framing: "A manufacturer: capital intensity, capacity utilization and input-cost (COGS) volatility dominate; margins of 10-18% are typical and customer concentration is common.",
  },
  services: {
    id: "services", label: "Professional services",
    healthyMarginPct: 25, thinMarginPct: 12, strongGrowthPct: 10, concentrationConcernPct: 35,
    framing: "A services firm: utilization, billable rate and people cost drive margin; client concentration is a major risk; margins of 15-30% are typical.",
  },
  marketplace: {
    id: "marketplace", label: "Marketplace / Platform",
    healthyMarginPct: 20, thinMarginPct: 8, strongGrowthPct: 18, concentrationConcernPct: 35,
    framing: "A marketplace: take-rate, GMV growth and liquidity (supply/demand balance) matter; reported revenue may be net of pass-through; growth is weighted heavily.",
  },
};

export function getIndustryProfile(id: IndustryId | string | null | undefined): IndustryProfile {
  return INDUSTRY_PROFILES[(id as IndustryId)] ?? INDUSTRY_PROFILES.generic;
}

export type MarginVerdict = "healthy" | "moderate" | "thin";
export function marginVerdict(marginPct: number, profile: IndustryProfile): MarginVerdict {
  if (marginPct >= profile.healthyMarginPct) return "healthy";
  if (marginPct >= profile.thinMarginPct) return "moderate";
  return "thin";
}

/** Compact line for the AI grounding block. */
export function industryGroundingText(profile: IndustryProfile): string {
  return [
    `INDUSTRY CONTEXT: ${profile.label}.`,
    profile.framing,
    `Calibrate judgments to this sector: healthy margin ≈ ${profile.healthyMarginPct}%+, thin below ${profile.thinMarginPct}%, strong period growth ≈ ${profile.strongGrowthPct}%+, concentration is a concern above ${profile.concentrationConcernPct}%.`,
  ].join(" ");
}
