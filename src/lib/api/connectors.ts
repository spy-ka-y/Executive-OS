// Data connectors. A small abstraction so ExecutiveOS can pull data from a
// source instead of only manual file uploads. The reference implementation is a
// CSV/Google-Sheets URL connector that needs no OAuth — it works with any
// "publish to web → CSV" link or public CSV endpoint, and stores the source URL
// so the dataset can be refreshed on demand.
//
// Proprietary connectors (Stripe, QuickBooks, Salesforce) implement the same
// `Connector` shape but require your own OAuth app + server-side token exchange;
// they are intentionally left as stubs here (see STUB_CONNECTORS) so the wiring
// is ready without shipping fake integrations.
import Papa from "papaparse";
import type { DatasetRow } from "./types";

export interface ConnectorResult {
  rows: DatasetRow[];
  sourceName: string;
}

export interface Connector {
  id: string;
  label: string;
  /** Whether it can run today with no extra credentials/OAuth. */
  ready: boolean;
  description: string;
}

export const STUB_CONNECTORS: Connector[] = [
  { id: "csv-url", label: "CSV / Google Sheet URL", ready: true, description: "Any public CSV link or a Google Sheet published to the web. No login required." },
  { id: "stripe", label: "Stripe", ready: false, description: "Needs a Stripe OAuth app + server token exchange (not configured)." },
  { id: "quickbooks", label: "QuickBooks", ready: false, description: "Needs Intuit OAuth + server token exchange (not configured)." },
  { id: "salesforce", label: "Salesforce", ready: false, description: "Needs a Salesforce connected app + OAuth (not configured)." },
];

// Convert common Google Sheets share links into a CSV export URL so users can
// paste the normal browser URL. Leaves other URLs untouched.
export function normalizeSourceUrl(url: string): string {
  const u = url.trim();
  const gsheet = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (gsheet) {
    const id = gsheet[1];
    const gidMatch = u.match(/[#&?]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }
  return u;
}

// Fetch + parse rows from a CSV/Sheets URL. Throws a friendly error on failure
// (including the common CORS case, which a production deploy would solve with a
// small server-side proxy).
export async function fetchRowsFromUrl(url: string): Promise<ConnectorResult> {
  const target = normalizeSourceUrl(url);
  let text: string;
  try {
    const res = await fetch(target, { redirect: "follow" });
    if (!res.ok) throw new Error(`Source returned ${res.status} ${res.statusText}`);
    text = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not fetch the source. ${msg}. If this is a CORS error, publish the sheet to the web as CSV, or route the fetch through a server proxy.`,
    );
  }

  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(`Could not parse CSV from the source: ${parsed.errors[0]?.message ?? "unknown error"}.`);
  }
  const rows = (parsed.data as DatasetRow[]).filter((r) => r && Object.keys(r).length > 0);
  if (!rows.length) throw new Error("The source had no data rows.");

  // Derive a readable source name from the URL host/path.
  let sourceName = "Imported source";
  try {
    const u = new URL(target);
    sourceName = u.hostname.includes("google") ? "Google Sheet" : u.hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  return { rows, sourceName };
}
