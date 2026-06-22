import { describe, it, expect } from "vitest";
import { getIndustryProfile, marginVerdict } from "./industry";

describe("industry calibration", () => {
  it("judges the same margin differently per industry", () => {
    const saas = getIndustryProfile("saas");
    const retail = getIndustryProfile("retail");
    // A 9% margin is thin for SaaS but healthy for retail.
    expect(marginVerdict(9, saas)).toBe("thin");
    expect(marginVerdict(9, retail)).toBe("healthy");
  });

  it("falls back to the generic profile for unknown ids", () => {
    expect(getIndustryProfile("nope").id).toBe("generic");
    expect(getIndustryProfile(null).id).toBe("generic");
  });

  it("classifies healthy/moderate/thin bands", () => {
    const g = getIndustryProfile("generic"); // healthy>=18, thin<10
    expect(marginVerdict(20, g)).toBe("healthy");
    expect(marginVerdict(12, g)).toBe("moderate");
    expect(marginVerdict(5, g)).toBe("thin");
  });
});
