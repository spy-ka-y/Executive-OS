// Data-Capability Engine
// ----------------------------------------------------------------------------
// Given an uploaded dataset's schema + rows, this determines WHICH executive
// metrics can be honestly computed and which cannot. Every downstream insight
// (CEO Brief, Consultant, Mission Control, Simulator) gates on this map so the
// product never fabricates a number it has no data basis for. When a metric is
// NOT_COMPUTABLE we surface exactly which columns the business must add.
//
// This is the single source of truth for column-role detection — intelligence.ts
// and the AI service layer both consume it instead of re-deriving roles.
import type { DatasetColumn, DatasetRow } from "./types";

export type Role =
  | "revenue"
  | "profit"
  | "cost"
  | "region"
  | "category"
  | "customer"
  | "date"
  | "marketing"
  | "price"
  | "quantity"
  | "churn"
  | "headcount";

export type CapabilityStatus = "computable" | "partial" | "not_computable";

// Candidate column-name fragments per role. Matched case-insensitively as a
// substring so "Net Revenue", "sales_amount", "Region/Country" all resolve.
const ROLE_KEYS: Record<Role, string[]> = {
  revenue: ["revenue", "sales", "gross_sales", "net_sales", "turnover", "bookings", "amount", "income", "gross", "total"],
  profit: ["profit", "net_income", "net_profit", "earnings", "ebitda", "margin_value", "gross_profit"],
  cost: ["cost", "cogs", "expense", "opex", "spend_total", "cost_of_goods"],
  region: ["region", "country", "state", "territory", "market", "location", "city", "zone", "area", "geo"],
  category: ["category", "product", "segment", "department", "sku", "type", "industry", "brand", "line"],
  customer: ["customer", "client", "account", "buyer", "company"],
  date: ["date", "month", "period", "quarter", "week", "day", "timestamp", "year"],
  marketing: ["marketing", "ad_spend", "adspend", "campaign", "media_spend", "marketing_spend"],
  price: ["price", "unit_price", "avg_price", "asp", "rate", "unit_cost"],
  quantity: ["quantity", "qty", "units", "volume", "count", "orders", "units_sold"],
  churn: ["churn", "attrition", "cancel", "lost", "retention"],
  headcount: ["headcount", "employees", "staff", "fte", "team_size"],
};

// Roles that must be numeric to be useful as a metric column.
const NUMERIC_ROLES: ReadonlySet<Role> = new Set<Role>([
  "revenue",
  "profit",
  "cost",
  "marketing",
  "price",
  "quantity",
  "churn",
  "headcount",
]);

export type RoleMap = Partial<Record<Role, string>>;

export interface Capability {
  /** Stable id, e.g. "margin", "region.concentration", "price.elasticity". */
  id: string;
  label: string;
  status: CapabilityStatus;
  /** Roles this insight relies on. */
  requires: Role[];
  /** Required roles that are absent from the dataset. */
  missing: Role[];
  /** Human-ready explanation of what to add to unlock it. */
  note: string;
}

export interface DataCapability {
  /** role -> resolved column name (only present roles included). */
  roles: RoleMap;
  present: Role[];
  /** keyed by capability id */
  capabilities: Record<string, Capability>;
  rowCount: number;
  /** True if this role resolved to a real column. */
  has: (role: Role) => boolean;
  /** Capability lookup; unknown ids return not_computable. */
  status: (id: string) => CapabilityStatus;
  can: (id: string) => boolean;
  /** "Needs: Region, Date columns" style hint for an insight id. */
  needs: (id: string) => string;
}

function pickColumn(schema: DatasetColumn[], role: Role): string | undefined {
  const wantNumeric = NUMERIC_ROLES.has(role);
  const lowered = schema.map((c) => ({ col: c, l: c.name.toLowerCase().trim() }));
  for (const frag of ROLE_KEYS[role]) {
    // Prefer an exact-token or typed match before a loose substring match.
    const typed = lowered.find(
      (x) => x.l.includes(frag) && (!wantNumeric || x.col.type === "number"),
    );
    if (typed) return typed.col.name;
  }
  // Fall back to a substring match ignoring type (helps when a CSV imported a
  // numeric column as string), but only for non-numeric roles to avoid picking
  // an id column as "revenue".
  if (!wantNumeric) {
    for (const frag of ROLE_KEYS[role]) {
      const loose = lowered.find((x) => x.l.includes(frag));
      if (loose) return loose.col.name;
    }
  }
  return undefined;
}

const ROLE_LABEL: Record<Role, string> = {
  revenue: "Revenue",
  profit: "Profit",
  cost: "Cost / COGS",
  region: "Region",
  category: "Category / Product",
  customer: "Customer",
  date: "Date / Period",
  marketing: "Marketing spend",
  price: "Unit price",
  quantity: "Units / Quantity",
  churn: "Churn",
  headcount: "Headcount",
};

function labelRoles(roles: Role[]): string {
  return roles.map((r) => ROLE_LABEL[r]).join(", ");
}

// Definition of each insight and the roles it needs. `partialWhen` lets an
// insight degrade gracefully (e.g. profit derivable from revenue+cost).
interface CapDef {
  id: string;
  label: string;
  requires: Role[];
  /** Alternative role-sets that make it computable (any one satisfies). */
  anyOf?: Role[][];
  /** Minimum rows needed (e.g. time series). */
  minRows?: number;
}

const CAP_DEFS: CapDef[] = [
  { id: "revenue.total", label: "Total revenue", requires: ["revenue"] },
  {
    id: "profit.total",
    label: "Total profit",
    requires: [],
    anyOf: [["profit"], ["revenue", "cost"]],
  },
  {
    id: "margin",
    label: "Profit margin",
    requires: [],
    anyOf: [["revenue", "profit"], ["revenue", "cost"]],
  },
  { id: "region.concentration", label: "Regional concentration", requires: ["region", "revenue"] },
  { id: "category.concentration", label: "Category concentration", requires: ["category", "revenue"] },
  { id: "customer.concentration", label: "Customer concentration", requires: ["customer", "revenue"] },
  { id: "marketing.roi", label: "Marketing ROI", requires: ["marketing", "revenue"] },
  { id: "growth", label: "Growth trend", requires: ["date", "revenue"], minRows: 3 },
  { id: "forecast", label: "Revenue forecast", requires: ["date", "revenue"], minRows: 6 },
  { id: "price.elasticity", label: "Price elasticity", requires: ["price", "quantity"], minRows: 8 },
  { id: "churn.impact", label: "Churn impact", requires: ["churn", "revenue"] },
  { id: "headcount.efficiency", label: "Revenue per head", requires: ["headcount", "revenue"] },
];

function evalCapability(def: CapDef, roles: RoleMap, rowCount: number): Capability {
  const present = (r: Role) => roles[r] !== undefined;

  // Resolve the active requirement set: explicit requires, or the first
  // satisfied alternative in anyOf (else the first alternative as the target).
  let requires = def.requires;
  let satisfied = requires.every(present);

  if (def.anyOf && def.anyOf.length) {
    const hit = def.anyOf.find((set) => set.every(present));
    if (hit) {
      requires = [...def.requires, ...hit];
      satisfied = def.requires.every(present);
    } else {
      // Report the cheapest alternative as the path to unlock.
      const cheapest = [...def.anyOf].sort((a, b) => a.length - b.length)[0];
      requires = [...def.requires, ...cheapest];
      satisfied = false;
    }
  }

  const missing = requires.filter((r) => !present(r));
  const enoughRows = def.minRows ? rowCount >= def.minRows : true;

  let status: CapabilityStatus;
  let note: string;
  if (satisfied && enoughRows) {
    status = "computable";
    note = "Computable from the uploaded data.";
  } else if (satisfied && !enoughRows) {
    status = "partial";
    note = `Needs at least ${def.minRows} time periods to be reliable (have ${rowCount} rows).`;
  } else {
    status = "not_computable";
    note = missing.length
      ? `Needs ${labelRoles(missing)} column${missing.length > 1 ? "s" : ""} in your data.`
      : "Insufficient data to compute.";
  }

  return { id: def.id, label: def.label, status, requires, missing, note };
}

export function analyzeCapability(schema: DatasetColumn[], rows: DatasetRow[]): DataCapability {
  const roles: RoleMap = {};
  for (const role of Object.keys(ROLE_KEYS) as Role[]) {
    const col = pickColumn(schema, role);
    if (col) roles[role] = col;
  }
  const present = Object.keys(roles) as Role[];
  const rowCount = rows.length;

  const capabilities: Record<string, Capability> = {};
  for (const def of CAP_DEFS) capabilities[def.id] = evalCapability(def, roles, rowCount);

  return {
    roles,
    present,
    capabilities,
    rowCount,
    has: (role) => roles[role] !== undefined,
    status: (id) => capabilities[id]?.status ?? "not_computable",
    can: (id) => capabilities[id]?.status === "computable",
    needs: (id) => capabilities[id]?.note ?? "Not computable from this dataset.",
  };
}

// Compact textual capability summary for grounding LLM prompts so the model is
// told what it may and may not quantify.
export function capabilitySummaryText(cap: DataCapability): string {
  const lines: string[] = [];
  const computable = Object.values(cap.capabilities).filter((c) => c.status === "computable");
  const gated = Object.values(cap.capabilities).filter((c) => c.status !== "computable");
  lines.push(
    "COMPUTABLE METRICS (you may quantify these): " +
      (computable.length ? computable.map((c) => c.label).join(", ") : "none"),
  );
  if (gated.length) {
    lines.push(
      "NOT COMPUTABLE (do NOT invent figures for these; recommend the business add the column): " +
        gated.map((c) => `${c.label} (${c.missing.length ? labelRoles(c.missing) : "more rows"})`).join("; "),
    );
  }
  return lines.join("\n");
}
