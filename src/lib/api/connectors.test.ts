import { describe, it, expect } from "vitest";
import { normalizeSourceUrl } from "./connectors";

describe("normalizeSourceUrl", () => {
  it("converts a Google Sheets edit URL to a CSV export URL", () => {
    const out = normalizeSourceUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42");
    expect(out).toContain("/spreadsheets/d/ABC123/export");
    expect(out).toContain("format=csv");
    expect(out).toContain("gid=42");
  });

  it("defaults gid to 0 when absent", () => {
    const out = normalizeSourceUrl("https://docs.google.com/spreadsheets/d/XYZ/edit");
    expect(out).toContain("gid=0");
  });

  it("leaves a plain CSV URL untouched", () => {
    const url = "https://example.com/data/report.csv";
    expect(normalizeSourceUrl(url)).toBe(url);
  });
});
