# LLM Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npm run eval:agent` — a repeatable regression test that runs the end-to-end insight agent over the 5 golden scenarios, grades each with an independent LLM judge, and writes a markdown report + an `eval_runs` row.

**Architecture:** A deterministic-first agent (`runInsightPipeline`) decides the risk tier by rule and has Gemini write the initiative + narrative. An independent Gemini judge (distinct model, temp 0) scores each output 1–5 on four dimensions. A `tsx` runner script loads scenarios from Aurora (xlsx fallback), orchestrates agent→judge, computes pass/fail, and persists results.

**Tech Stack:** TypeScript, `tsx` (script runner), `vitest` (unit tests), `pg` (Aurora Postgres), `xlsx` (already present), `zod` (already present), `@google/generative-ai` via existing `src/lib/ai/gemini.server.ts`.

## Global Constraints

- Node/server-only modules use relative imports (NOT the `@/` alias) so `tsx` resolves them without path-alias config — matches `ml/parity_check.ts`.
- Deterministic-first: the rule decides the tier; the LLM never assigns or overrides it. Never fabricate a tier when core fields are missing.
- Pass rule: every judge dimension ≥ 3 AND `hallucinated_numbers` empty.
- Risk tier rule (verbatim): `conc > 70` → Critical; `60 < conc ≤ 70` → High; `conc ≤ 60 && margin ≤ 0` → Critical; `conc ≤ 60 && 0 < margin ≤ 5` → High; else → Low.
- Agent model: `gemini-2.5-flash`. Judge model: `gemini-2.5-pro`, temperature 0.
- Golden seed columns (xlsx): `Scenario_ID, Region, Category, Revenue, Profit_Margin, Customer_Concentration_pct, Churn_pct, Golden_Risk_Level, Golden_Initiative, Golden_Insight_Summary, Rubric_Criteria`.
- `eval_runs` DDL must be portable Postgres (works on Aurora) and self-applied by the runner via `CREATE TABLE IF NOT EXISTS`.
- Exit non-zero when `pass_rate < EVAL_MIN_PASS_RATE` (default `1.0`).

---

### Task 1: Tooling, deps, and config scaffolding

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`
- Modify: `.env.example`
- Test: `src/lib/eval/sanity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (vitest) and `npm run eval:agent` (tsx) scripts; `pg`, `@types/pg`, `tsx`, `vitest` available.

- [ ] **Step 1: Add the sanity test (failing — no runner yet)**

Create `src/lib/eval/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("eval harness toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm there is no test runner yet**

Run: `npm test`
Expected: FAIL — `npm error Missing script: "test"`.

- [ ] **Step 3: Install dependencies**

Run:
```bash
npm install -D vitest tsx pg @types/pg
```
Expected: installs succeed; `pg`, `tsx`, `vitest` appear under devDependencies in `package.json`.

- [ ] **Step 4: Add scripts to `package.json`**

In the `"scripts"` block, add these two entries (keep existing entries):

```json
    "test": "vitest run",
    "eval:agent": "tsx scripts/eval-agent.ts"
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Document new env in `.env.example`**

Append to `.env.example`:

```
# Aurora PostgreSQL — used ONLY by the LLM eval harness (npm run eval:agent)
# to read eval_golden_seed and write eval_runs. Standard libpq connection string.
DATABASE_URL=

# LLM eval harness knobs (optional)
# Minimum pass rate (0..1) below which `npm run eval:agent` exits non-zero.
EVAL_MIN_PASS_RATE=1.0
```

- [ ] **Step 7: Run the sanity test (passing)**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .env.example src/lib/eval/sanity.test.ts
git commit -m "chore: add vitest/tsx/pg toolchain for eval harness"
```

---

### Task 2: `runInsightPipeline` — the agent under test

**Files:**
- Create: `src/lib/agents/runInsightPipeline.ts`
- Test: `src/lib/agents/runInsightPipeline.test.ts`

**Interfaces:**
- Consumes: `executeGeminiPrompt` from `../ai/gemini.server` (only inside `geminiNarrator`).
- Produces:
  - `interface InsightMetrics { region?: string|null; category?: string|null; revenue?: number|null; profit_margin?: number|null; customer_concentration_pct?: number|null; churn_pct?: number|null; }`
  - `interface InsightResult { riskLevel: "Critical"|"High"|"Low"|null; initiative: string; narrative: string; insufficientData: boolean; missingFields: string[]; tierSource: "rule"|"none"; narratedBy: "gemini"|"fallback"|"none"; }`
  - `interface NarrationInput { tier: "Critical"|"High"|"Low"; metrics: InsightMetrics; }`
  - `interface NarrationOutput { initiative: string; narrative: string; }`
  - `type Narrator = (input: NarrationInput) => Promise<NarrationOutput>;`
  - `function decideTier(m: InsightMetrics): { tier: "Critical"|"High"|"Low"|null; missingFields: string[] }`
  - `function fallbackNarration(tier: "Critical"|"High"|"Low", m: InsightMetrics): NarrationOutput`
  - `const geminiNarrator: Narrator`
  - `function runInsightPipeline(m: InsightMetrics, narrate?: Narrator): Promise<InsightResult>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/agents/runInsightPipeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- runInsightPipeline`
Expected: FAIL — cannot resolve `./runInsightPipeline`.

- [ ] **Step 3: Implement `src/lib/agents/runInsightPipeline.ts`**

```ts
// End-to-end "insight agent": decides the risk tier deterministically (by the
// documented threshold rule), refuses when core fields are missing, then has
// Gemini write the recommended initiative + narrative. Mirrors the
// deterministic-first pattern in executeRisk.functions.ts (rule decides the
// WHAT; the LLM only explains the WHY). Plain async — callable from the eval
// runner and the product without the server-function RPC layer.
import { executeGeminiPrompt } from "../ai/gemini.server";

export type RiskTier = "Critical" | "High" | "Low";

export interface InsightMetrics {
  region?: string | null;
  category?: string | null;
  revenue?: number | null;
  profit_margin?: number | null;
  customer_concentration_pct?: number | null;
  churn_pct?: number | null;
}

export interface InsightResult {
  riskLevel: RiskTier | null;
  initiative: string;
  narrative: string;
  insufficientData: boolean;
  missingFields: string[];
  tierSource: "rule" | "none";
  narratedBy: "gemini" | "fallback" | "none";
}

export interface NarrationInput {
  tier: RiskTier;
  metrics: InsightMetrics;
}
export interface NarrationOutput {
  initiative: string;
  narrative: string;
}
export type Narrator = (input: NarrationInput) => Promise<NarrationOutput>;

const REFUSAL_INITIATIVE = "N/A — request missing fields";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Which numeric fields are absent — used both to gate the tier and to write an
// honest refusal that names exactly what is missing.
function missingNumericFields(m: InsightMetrics): string[] {
  const fields: Array<keyof InsightMetrics> = [
    "revenue",
    "profit_margin",
    "customer_concentration_pct",
    "churn_pct",
  ];
  return fields.filter((f) => !isNum(m[f]));
}

// Deterministic tier from the documented threshold rule. Core fields are
// profit_margin AND customer_concentration_pct; if either is missing we refuse
// (tier = null) rather than guess.
export function decideTier(m: InsightMetrics): {
  tier: RiskTier | null;
  missingFields: string[];
} {
  const missingFields = missingNumericFields(m);
  if (!isNum(m.profit_margin) || !isNum(m.customer_concentration_pct)) {
    return { tier: null, missingFields };
  }
  const conc = m.customer_concentration_pct;
  const margin = m.profit_margin;
  let tier: RiskTier;
  if (conc > 70) tier = "Critical";
  else if (conc > 60) tier = "High";
  else if (margin <= 0) tier = "Critical";
  else if (margin <= 5) tier = "High";
  else tier = "Low";
  return { tier, missingFields };
}

// Templated initiative + narrative when Gemini is unavailable. The TIER is still
// the rule's; only the prose is templated, and it says so. No invented numbers
// beyond the inputs already provided.
export function fallbackNarration(tier: RiskTier, m: InsightMetrics): NarrationOutput {
  const conc = isNum(m.customer_concentration_pct) ? m.customer_concentration_pct : null;
  const margin = isNum(m.profit_margin) ? m.profit_margin : null;
  const concDriven = conc !== null && conc > 60;
  const marginDriven = margin !== null && margin <= 5;

  let initiative: string;
  if (tier === "Low") initiative = "Regional Expansion";
  else if (concDriven) initiative = "Customer Diversification";
  else if (marginDriven) initiative = "Margin Defense Program";
  else initiative = "Risk Mitigation Review";

  const drivers: string[] = [];
  if (concDriven) drivers.push(`customer concentration at ${conc}%`);
  if (marginDriven) drivers.push(`a profit margin of ${margin}%`);
  const reason = drivers.length ? drivers.join(" and ") : "the assessed metric profile";
  const narrative =
    `Rule-assigned risk tier: ${tier}, driven by ${reason}. Recommended initiative: ` +
    `${initiative}. (Narrative generated without the LLM — the tier is the rule's.)`;
  return { initiative, narrative };
}

function buildNarrationPrompt(tier: RiskTier, m: InsightMetrics) {
  const system = [
    "You are the Chief Strategy agent for ExecutiveOS.",
    `A deterministic rule has ALREADY assigned the risk tier: "${tier}". That decision is FINAL.`,
    "Your job: (1) recommend ONE initiative appropriate to this tier and its dominant driver,",
    "and (2) write a 2-3 sentence insight narrative explaining the assessment.",
    "STRICT RULES:",
    `- Do NOT state, imply, or argue for any tier other than "${tier}".`,
    "- Ground everything in the provided numbers. Do NOT invent any number not given.",
    "- For Low risk, recommend a growth/expansion move, NOT a defensive one.",
    "- For concentration-driven risk, prefer diversification; for margin-driven risk, prefer a margin program.",
    "- Return ONLY a JSON object: { \"initiative\": string, \"narrative\": string }. No markdown, no prose outside JSON.",
  ].join("\n");

  const provided: string[] = [];
  if (isNum(m.revenue)) provided.push(`- Revenue: ${m.revenue}`);
  if (isNum(m.profit_margin)) provided.push(`- Profit margin: ${m.profit_margin}%`);
  if (isNum(m.customer_concentration_pct)) provided.push(`- Customer concentration: ${m.customer_concentration_pct}%`);
  if (isNum(m.churn_pct)) provided.push(`- Churn: ${m.churn_pct}%`);
  if (m.region) provided.push(`- Region: ${m.region}`);
  if (m.category) provided.push(`- Category: ${m.category}`);

  const user = [
    `ASSIGNED TIER: ${tier}.`,
    "PROVIDED METRICS (the ONLY numbers you may cite):",
    ...provided,
    "",
    "Return the initiative and narrative as JSON.",
  ].join("\n");

  return { system, user };
}

// Real narrator: Gemini writes the initiative + narrative around the locked tier.
// Throws on any failure so runInsightPipeline can fall back transparently.
export const geminiNarrator: Narrator = async ({ tier, metrics }) => {
  const { system, user } = buildNarrationPrompt(tier, metrics);
  const res = await executeGeminiPrompt({ system, user, model: "gemini-2.5-flash" });
  const p = res.parsed as { initiative?: unknown; narrative?: unknown };
  const initiative = typeof p?.initiative === "string" ? p.initiative.trim() : "";
  const narrative = typeof p?.narrative === "string" ? p.narrative.trim() : "";
  if (!initiative || !narrative) {
    throw new Error("Gemini narrator returned an incomplete object.");
  }
  return { initiative, narrative };
};

export async function runInsightPipeline(
  m: InsightMetrics,
  narrate: Narrator = geminiNarrator,
): Promise<InsightResult> {
  const { tier, missingFields } = decideTier(m);

  if (tier === null) {
    const fieldList = missingFields.join(", ");
    return {
      riskLevel: null,
      initiative: REFUSAL_INITIATIVE,
      narrative:
        `Core financial fields are missing (${fieldList}). I cannot assign a risk tier ` +
        `without them and will not guess. Please provide the missing fields to proceed.`,
      insufficientData: true,
      missingFields,
      tierSource: "none",
      narratedBy: "none",
    };
  }

  try {
    const { initiative, narrative } = await narrate({ tier, metrics: m });
    return {
      riskLevel: tier,
      initiative,
      narrative,
      insufficientData: false,
      missingFields,
      tierSource: "rule",
      narratedBy: "gemini",
    };
  } catch {
    const fb = fallbackNarration(tier, m);
    return {
      riskLevel: tier,
      initiative: fb.initiative,
      narrative: fb.narrative,
      insufficientData: false,
      missingFields,
      tierSource: "rule",
      narratedBy: "fallback",
    };
  }
}
```

Note: the refusal narrative contains the literal `${fieldList}` of field *names* (no digits), so the test asserting `/\d/` is false holds — field names like `profit_margin` contain no digits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- runInsightPipeline`
Expected: PASS — all `decideTier` and `runInsightPipeline` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/runInsightPipeline.ts src/lib/agents/runInsightPipeline.test.ts
git commit -m "feat: add runInsightPipeline end-to-end insight agent"
```

---

### Task 3: `judgeInsight` — independent LLM judge

**Files:**
- Create: `src/lib/ai/judge.server.ts`
- Test: `src/lib/ai/judge.server.test.ts`

**Interfaces:**
- Consumes: `executeGeminiPrompt` from `./gemini.server` (only inside `geminiJudge`); `z` from `zod`.
- Produces:
  - `interface GoldenScenario { scenario_id: string; region: string|null; category: string|null; revenue: number|null; profit_margin: number|null; customer_concentration_pct: number|null; churn_pct: number|null; golden_risk_level: string|null; golden_initiative: string|null; golden_insight_summary: string|null; rubric_criteria: string|null; }`
  - `interface AgentOutput { riskLevel: string|null; initiative: string; narrative: string; }`
  - `const JudgeVerdictSchema` (zod) and `type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>`
  - `function isPass(v: JudgeVerdict): boolean`
  - `type Judge = (scenario: GoldenScenario, output: AgentOutput) => Promise<JudgeVerdict>`
  - `const geminiJudge: Judge`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/judge.server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { JudgeVerdictSchema, isPass, type JudgeVerdict } from "./judge.server";

const base: JudgeVerdict = {
  factual_correctness: 5,
  cites_right_drivers: 5,
  actionability: 5,
  hallucination: 5,
  hallucinated_numbers: [],
  reasoning: {
    factual_correctness: "ok",
    cites_right_drivers: "ok",
    actionability: "ok",
    hallucination: "none",
  },
  overall: "strong",
};

describe("JudgeVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    expect(JudgeVerdictSchema.safeParse(base).success).toBe(true);
  });
  it("rejects scores out of the 1-5 range", () => {
    expect(JudgeVerdictSchema.safeParse({ ...base, actionability: 7 }).success).toBe(false);
  });
  it("rejects a missing dimension", () => {
    const { hallucination, ...partial } = base;
    expect(JudgeVerdictSchema.safeParse(partial).success).toBe(false);
  });
});

describe("isPass", () => {
  it("passes when all dimensions ≥ 3 and no hallucinated numbers", () => {
    expect(isPass({ ...base, factual_correctness: 3 })).toBe(true);
  });
  it("fails when any dimension < 3", () => {
    expect(isPass({ ...base, actionability: 2 })).toBe(false);
  });
  it("fails when hallucinated numbers are present, even with high scores", () => {
    expect(isPass({ ...base, hallucinated_numbers: ["$2.3M"] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- judge.server`
Expected: FAIL — cannot resolve `./judge.server`.

- [ ] **Step 3: Implement `src/lib/ai/judge.server.ts`**

```ts
// Independent LLM-as-judge for the insight agent's free-text quality. Uses a
// DISTINCT Gemini model from the agent (gemini-2.5-pro) at temperature 0, and
// requires structured JSON back. The judge receives the original input metrics
// so it can flag any number the agent invented that is not in the input.
import { z } from "zod";
import { executeGeminiPrompt } from "./gemini.server";

export interface GoldenScenario {
  scenario_id: string;
  region: string | null;
  category: string | null;
  revenue: number | null;
  profit_margin: number | null;
  customer_concentration_pct: number | null;
  churn_pct: number | null;
  golden_risk_level: string | null;
  golden_initiative: string | null;
  golden_insight_summary: string | null;
  rubric_criteria: string | null;
}

export interface AgentOutput {
  riskLevel: string | null;
  initiative: string;
  narrative: string;
}

export const JudgeVerdictSchema = z.object({
  factual_correctness: z.number().int().min(1).max(5),
  cites_right_drivers: z.number().int().min(1).max(5),
  actionability: z.number().int().min(1).max(5),
  hallucination: z.number().int().min(1).max(5), // 5 = no hallucination
  hallucinated_numbers: z.array(z.string()),
  reasoning: z.object({
    factual_correctness: z.string(),
    cites_right_drivers: z.string(),
    actionability: z.string(),
    hallucination: z.string(),
  }),
  overall: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

// Pass = every rubric dimension ≥ 3 AND zero hallucinated numbers.
export function isPass(v: JudgeVerdict): boolean {
  return (
    v.factual_correctness >= 3 &&
    v.cites_right_drivers >= 3 &&
    v.actionability >= 3 &&
    v.hallucination >= 3 &&
    v.hallucinated_numbers.length === 0
  );
}

export type Judge = (
  scenario: GoldenScenario,
  output: AgentOutput,
) => Promise<JudgeVerdict>;

export const JUDGE_MODEL = "gemini-2.5-pro";

function buildJudgePrompt(s: GoldenScenario, o: AgentOutput) {
  const system = [
    "You are a strict, impartial evaluator of an executive-AI agent's output.",
    "You did NOT write the agent's answer. Grade it against the golden reference and rubric.",
    "Score each dimension 1-5 (integers only):",
    "- factual_correctness: is the assessment correct vs the golden answer?",
    "- cites_right_drivers: does it cite the drivers the rubric requires?",
    "- actionability: is the recommended initiative appropriate and specific?",
    "- hallucination: 5 if it invents NO number absent from the input; lower the more it invents.",
    "List every invented number (not present in INPUT METRICS) in hallucinated_numbers (empty array if none).",
    "If the golden answer is 'Insufficient data', the correct agent behavior is to flag missing fields and refuse;",
    "score an invented tier or invented numbers as failing.",
    "Return ONLY this JSON object:",
    '{ "factual_correctness": int, "cites_right_drivers": int, "actionability": int, "hallucination": int, "hallucinated_numbers": string[], "reasoning": { "factual_correctness": string, "cites_right_drivers": string, "actionability": string, "hallucination": string }, "overall": string }',
  ].join("\n");

  const user = [
    "INPUT METRICS (the ONLY numbers that legitimately exist):",
    JSON.stringify({
      region: s.region,
      category: s.category,
      revenue: s.revenue,
      profit_margin: s.profit_margin,
      customer_concentration_pct: s.customer_concentration_pct,
      churn_pct: s.churn_pct,
    }),
    "",
    "GOLDEN REFERENCE:",
    JSON.stringify({
      golden_risk_level: s.golden_risk_level,
      golden_initiative: s.golden_initiative,
      golden_insight_summary: s.golden_insight_summary,
    }),
    "",
    `RUBRIC CRITERIA: ${s.rubric_criteria ?? "(none)"}`,
    "",
    "AGENT OUTPUT TO GRADE:",
    JSON.stringify({
      riskLevel: o.riskLevel,
      initiative: o.initiative,
      narrative: o.narrative,
    }),
    "",
    "Grade it now. Return only the JSON verdict.",
  ].join("\n");

  return { system, user };
}

export const geminiJudge: Judge = async (scenario, output) => {
  const { system, user } = buildJudgePrompt(scenario, output);
  const res = await executeGeminiPrompt({ system, user, model: JUDGE_MODEL });
  return JudgeVerdictSchema.parse(res.parsed);
};
```

Note: `executeGeminiPrompt` already sets `temperature: 0.4` for JSON mode in `gemini.server.ts`. For the judge we want temperature 0 — see Task 7, Step 1 for the one-line gemini.server change that makes the JSON path deterministic at temp 0 while leaving the existing callers unaffected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- judge.server`
Expected: PASS — schema + `isPass` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/judge.server.ts src/lib/ai/judge.server.test.ts
git commit -m "feat: add independent Gemini LLM-as-judge for insight quality"
```

---

### Task 4: Scenario loading (Aurora read + xlsx fallback)

**Files:**
- Create: `src/lib/eval/scenarios.ts`
- Test: `src/lib/eval/scenarios.test.ts`

**Interfaces:**
- Consumes: `GoldenScenario` from `../ai/judge.server`; `InsightMetrics` from `../agents/runInsightPipeline`; `xlsx`; `pg` (`Pool`).
- Produces:
  - `function readGoldenXlsx(file: string): GoldenScenario[]`
  - `function metricsFromScenario(s: GoldenScenario): InsightMetrics`
  - `async function loadScenarios(opts: { databaseUrl?: string; xlsxPath: string }): Promise<{ scenarios: GoldenScenario[]; source: "aurora" | "xlsx" }>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/eval/scenarios.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scenarios`
Expected: FAIL — cannot resolve `./scenarios`.

- [ ] **Step 3: Implement `src/lib/eval/scenarios.ts`**

```ts
// Loads the golden eval scenarios. Primary source is Aurora (eval_golden_seed)
// via node-postgres; if DATABASE_URL is absent, the table is empty, or the DB is
// unreachable, it falls back to the xlsx in data/seed/ so the eval always runs.
import * as XLSXns from "xlsx";
import { Pool } from "pg";
import type { GoldenScenario } from "../ai/judge.server";
import type { InsightMetrics } from "../agents/runInsightPipeline";

// xlsx is CommonJS; normalize the import across ESM/CJS interop (tsx, vitest).
const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns;

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, $%]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function mapGolden(r: Row): GoldenScenario {
  return {
    scenario_id: String(r["Scenario_ID"] ?? r["scenario_id"]),
    region: str(r["Region"] ?? r["region"]),
    category: str(r["Category"] ?? r["category"]),
    revenue: num(r["Revenue"] ?? r["revenue"]),
    profit_margin: num(r["Profit_Margin"] ?? r["profit_margin"]),
    customer_concentration_pct: num(r["Customer_Concentration_pct"] ?? r["customer_concentration_pct"]),
    churn_pct: num(r["Churn_pct"] ?? r["churn_pct"]),
    golden_risk_level: str(r["Golden_Risk_Level"] ?? r["golden_risk_level"]),
    golden_initiative: str(r["Golden_Initiative"] ?? r["golden_initiative"]),
    golden_insight_summary: str(r["Golden_Insight_Summary"] ?? r["golden_insight_summary"]),
    rubric_criteria: str(r["Rubric_Criteria"] ?? r["rubric_criteria"]),
  };
}

export function readGoldenXlsx(file: string): GoldenScenario[] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
  return rows.map(mapGolden);
}

export function metricsFromScenario(s: GoldenScenario): InsightMetrics {
  return {
    region: s.region,
    category: s.category,
    revenue: s.revenue,
    profit_margin: s.profit_margin,
    customer_concentration_pct: s.customer_concentration_pct,
    churn_pct: s.churn_pct,
  };
}

async function readGoldenAurora(databaseUrl: string): Promise<GoldenScenario[]> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    const res = await pool.query("select * from eval_golden_seed order by scenario_id");
    return res.rows.map((r) => mapGolden(r as Row));
  } finally {
    await pool.end();
  }
}

export async function loadScenarios(opts: {
  databaseUrl?: string;
  xlsxPath: string;
}): Promise<{ scenarios: GoldenScenario[]; source: "aurora" | "xlsx" }> {
  if (opts.databaseUrl) {
    try {
      const scenarios = await readGoldenAurora(opts.databaseUrl);
      if (scenarios.length > 0) return { scenarios, source: "aurora" };
      console.warn("[eval] eval_golden_seed is empty in Aurora — falling back to xlsx.");
    } catch (e) {
      console.warn(`[eval] Aurora read failed (${e instanceof Error ? e.message : e}) — falling back to xlsx.`);
    }
  }
  return { scenarios: readGoldenXlsx(opts.xlsxPath), source: "xlsx" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- scenarios`
Expected: PASS — read, map, and both fallback cases green. (The unreachable-DB case logs a warning then returns the xlsx rows.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/scenarios.ts src/lib/eval/scenarios.test.ts
git commit -m "feat: load golden scenarios from Aurora with xlsx fallback"
```

---

### Task 5: Result persistence (eval_runs DDL + Aurora write + JSONL fallback)

**Files:**
- Create: `src/lib/eval/persistence.ts`
- Create: `supabase/migrations/20260620193000_eval_runs.sql`
- Test: `src/lib/eval/persistence.test.ts`

**Interfaces:**
- Consumes: `JudgeVerdict` from `../ai/judge.server`; `pg` (`Pool`); `node:fs`.
- Produces:
  - `interface RunFailure { scenario_id: string; verdict: JudgeVerdict | null; judgeError?: string }`
  - `interface RunSummary { runAt: string; agentModel: string; judgeModel: string; total: number; passed: number; passRate: number; reportPath: string; failures: RunFailure[]; notes: string }`
  - `const EVAL_RUNS_DDL: string`
  - `async function persistRun(summary: RunSummary, opts: { databaseUrl?: string; jsonlPath: string }): Promise<{ target: "aurora" | "jsonl"; detail: string }>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/eval/persistence.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { persistRun, EVAL_RUNS_DDL, type RunSummary } from "./persistence";

const summary: RunSummary = {
  runAt: "2026-06-20T00:00:00.000Z",
  agentModel: "gemini-2.5-flash",
  judgeModel: "gemini-2.5-pro",
  total: 5,
  passed: 4,
  passRate: 0.8,
  reportPath: "docs/eval/agent-eval-x.md",
  failures: [{ scenario_id: "S03", verdict: null, judgeError: "boom" }],
  notes: "test run",
};

const tmp = path.join(os.tmpdir(), `eval-jsonl-${Date.now()}.jsonl`);
afterEach(() => {
  if (fs.existsSync(tmp)) fs.rmSync(tmp);
});

describe("EVAL_RUNS_DDL", () => {
  it("is an idempotent CREATE TABLE", () => {
    expect(EVAL_RUNS_DDL).toMatch(/create table if not exists eval_runs/i);
  });
});

describe("persistRun", () => {
  it("writes to JSONL when no databaseUrl is provided", async () => {
    const r = await persistRun(summary, { jsonlPath: tmp });
    expect(r.target).toBe("jsonl");
    const line = JSON.parse(fs.readFileSync(tmp, "utf8").trim());
    expect(line.passRate).toBe(0.8);
    expect(line.failures[0].scenario_id).toBe("S03");
  });

  it("falls back to JSONL when the database is unreachable", async () => {
    const r = await persistRun(summary, {
      databaseUrl: "postgres://invalid:invalid@127.0.0.1:1/none",
      jsonlPath: tmp,
    });
    expect(r.target).toBe("jsonl");
    expect(fs.existsSync(tmp)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- persistence`
Expected: FAIL — cannot resolve `./persistence`.

- [ ] **Step 3: Create the migration `supabase/migrations/20260620193000_eval_runs.sql`**

```sql
-- LLM eval harness run log (Prompt 4). One row per `npm run eval:agent` run.
-- Portable Postgres DDL — applies to Aurora as well as Supabase. The eval runner
-- also self-applies this via CREATE TABLE IF NOT EXISTS, so it works against
-- Aurora without a migration tool.
create table if not exists public.eval_runs (
  id          bigint generated always as identity primary key,
  run_at      timestamptz not null default now(),
  agent_model text,
  judge_model text,
  total       integer not null,
  passed      integer not null,
  pass_rate   numeric not null,
  report_path text,
  failures    jsonb,
  notes       text
);
```

- [ ] **Step 4: Implement `src/lib/eval/persistence.ts`**

```ts
// Persists one eval-run summary row. Primary target is Aurora (eval_runs, self-
// created if absent). If Aurora is unreachable or no DATABASE_URL is set, the
// summary is appended to a local JSONL so a run's results are never lost.
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import type { JudgeVerdict } from "../ai/judge.server";

export interface RunFailure {
  scenario_id: string;
  verdict: JudgeVerdict | null;
  judgeError?: string;
}

export interface RunSummary {
  runAt: string;
  agentModel: string;
  judgeModel: string;
  total: number;
  passed: number;
  passRate: number;
  reportPath: string;
  failures: RunFailure[];
  notes: string;
}

// Mirrors supabase/migrations/20260620193000_eval_runs.sql (without the schema
// qualifier so it applies to whichever default schema the connection uses).
export const EVAL_RUNS_DDL = `create table if not exists eval_runs (
  id          bigint generated always as identity primary key,
  run_at      timestamptz not null default now(),
  agent_model text,
  judge_model text,
  total       integer not null,
  passed      integer not null,
  pass_rate   numeric not null,
  report_path text,
  failures    jsonb,
  notes       text
)`;

function appendJsonl(jsonlPath: string, summary: RunSummary): void {
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  fs.appendFileSync(jsonlPath, JSON.stringify(summary) + "\n", "utf8");
}

async function writeAurora(databaseUrl: string, summary: RunSummary): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(EVAL_RUNS_DDL);
    await pool.query(
      `insert into eval_runs
         (run_at, agent_model, judge_model, total, passed, pass_rate, report_path, failures, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        summary.runAt,
        summary.agentModel,
        summary.judgeModel,
        summary.total,
        summary.passed,
        summary.passRate,
        summary.reportPath,
        JSON.stringify(summary.failures),
        summary.notes,
      ],
    );
  } finally {
    await pool.end();
  }
}

export async function persistRun(
  summary: RunSummary,
  opts: { databaseUrl?: string; jsonlPath: string },
): Promise<{ target: "aurora" | "jsonl"; detail: string }> {
  if (opts.databaseUrl) {
    try {
      await writeAurora(opts.databaseUrl, summary);
      return { target: "aurora", detail: "eval_runs row inserted" };
    } catch (e) {
      console.warn(`[eval] Aurora write failed (${e instanceof Error ? e.message : e}) — writing JSONL.`);
    }
  }
  appendJsonl(opts.jsonlPath, summary);
  return { target: "jsonl", detail: opts.jsonlPath };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- persistence`
Expected: PASS — DDL shape + both JSONL paths green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/eval/persistence.ts src/lib/eval/persistence.test.ts supabase/migrations/20260620193000_eval_runs.sql
git commit -m "feat: persist eval runs to Aurora eval_runs with JSONL fallback"
```

---

### Task 6: Markdown report builder

**Files:**
- Create: `src/lib/eval/report.ts`
- Test: `src/lib/eval/report.test.ts`

**Interfaces:**
- Consumes: `GoldenScenario`, `JudgeVerdict` from `../ai/judge.server`; `InsightResult` from `../agents/runInsightPipeline`; `RunSummary` from `./persistence`.
- Produces:
  - `interface ScenarioRun { scenario: GoldenScenario; agent: InsightResult; verdict: JudgeVerdict | null; judgeError?: string; pass: boolean }`
  - `function buildMarkdownReport(runs: ScenarioRun[], summary: RunSummary): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/eval/report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMarkdownReport, type ScenarioRun } from "./report";
import type { RunSummary } from "./persistence";

const passingRun: ScenarioRun = {
  scenario: {
    scenario_id: "S01", region: "Europe", category: "Electronics",
    revenue: 1240000, profit_margin: 4.2, customer_concentration_pct: 58, churn_pct: 9.5,
    golden_risk_level: "High", golden_initiative: "Margin Defense Program",
    golden_insight_summary: "…", rubric_criteria: "…",
  },
  agent: {
    riskLevel: "High", initiative: "Margin Defense Program", narrative: "…",
    insufficientData: false, missingFields: [], tierSource: "rule", narratedBy: "gemini",
  },
  verdict: {
    factual_correctness: 5, cites_right_drivers: 5, actionability: 4, hallucination: 5,
    hallucinated_numbers: [], reasoning: { factual_correctness: "a", cites_right_drivers: "b", actionability: "c", hallucination: "d" },
    overall: "good",
  },
  pass: true,
};

const failingRun: ScenarioRun = {
  ...passingRun,
  scenario: { ...passingRun.scenario, scenario_id: "S03" },
  verdict: { ...passingRun.verdict!, actionability: 2, overall: "weak initiative" },
  pass: false,
};

const summary: RunSummary = {
  runAt: "2026-06-20T00:00:00.000Z", agentModel: "gemini-2.5-flash", judgeModel: "gemini-2.5-pro",
  total: 2, passed: 1, passRate: 0.5, reportPath: "docs/eval/agent-eval-x.md",
  failures: [{ scenario_id: "S03", verdict: failingRun.verdict, judgeError: undefined }],
  notes: "source=xlsx",
};

describe("buildMarkdownReport", () => {
  const md = buildMarkdownReport([passingRun, failingRun], summary);
  it("shows the pass rate", () => {
    expect(md).toContain("50%");
    expect(md).toContain("1/2");
  });
  it("includes a row per scenario", () => {
    expect(md).toContain("S01");
    expect(md).toContain("S03");
  });
  it("includes full judge reasoning for failures only", () => {
    expect(md).toContain("weak initiative");
  });
  it("links the growth checklist", () => {
    expect(md).toContain("GOLDEN_SEED_GROWTH.md");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- report`
Expected: FAIL — cannot resolve `./report`.

- [ ] **Step 3: Implement `src/lib/eval/report.ts`**

```ts
// Pure markdown report builder for an eval run. No I/O — the runner writes the
// returned string to disk.
import type { GoldenScenario, JudgeVerdict } from "../ai/judge.server";
import type { InsightResult } from "../agents/runInsightPipeline";
import type { RunSummary } from "./persistence";

export interface ScenarioRun {
  scenario: GoldenScenario;
  agent: InsightResult;
  verdict: JudgeVerdict | null;
  judgeError?: string;
  pass: boolean;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function scoreCell(v: JudgeVerdict | null): string {
  if (!v) return "—";
  return `${v.factual_correctness}/${v.cites_right_drivers}/${v.actionability}/${v.hallucination}`;
}

export function buildMarkdownReport(runs: ScenarioRun[], summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Agent Eval Report — ${summary.runAt}`);
  lines.push("");
  lines.push(`**Pass rate:** ${pct(summary.passRate)} (${summary.passed}/${summary.total})`);
  lines.push(`**Agent model:** ${summary.agentModel} · **Judge model:** ${summary.judgeModel}`);
  lines.push(`**Notes:** ${summary.notes}`);
  lines.push("");
  lines.push("Scores are factual / drivers / actionability / hallucination (1-5). Pass = all ≥ 3 and no hallucinated numbers.");
  lines.push("");
  lines.push("| Scenario | Result | Tier (agent → golden) | Scores |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of runs) {
    const result = r.pass ? "✅ PASS" : "❌ FAIL";
    const tier = `${r.agent.riskLevel ?? "—"} → ${r.scenario.golden_risk_level ?? "—"}`;
    lines.push(`| ${r.scenario.scenario_id} | ${result} | ${tier} | ${scoreCell(r.verdict)} |`);
  }
  lines.push("");

  const failures = runs.filter((r) => !r.pass);
  if (failures.length) {
    lines.push("## Failures — full judge reasoning");
    lines.push("");
    for (const r of failures) {
      lines.push(`### ${r.scenario.scenario_id}`);
      lines.push("");
      lines.push(`- **Agent tier:** ${r.agent.riskLevel ?? "—"} · **Golden:** ${r.scenario.golden_risk_level ?? "—"}`);
      lines.push(`- **Agent initiative:** ${r.agent.initiative}`);
      lines.push(`- **Agent narrative:** ${r.agent.narrative}`);
      if (r.judgeError) {
        lines.push(`- **Judge error:** ${r.judgeError}`);
      } else if (r.verdict) {
        const v = r.verdict;
        lines.push(`- **Scores:** factual ${v.factual_correctness}, drivers ${v.cites_right_drivers}, actionability ${v.actionability}, hallucination ${v.hallucination}`);
        if (v.hallucinated_numbers.length) lines.push(`- **Hallucinated numbers:** ${v.hallucinated_numbers.join(", ")}`);
        lines.push(`- **Reasoning — factual:** ${v.reasoning.factual_correctness}`);
        lines.push(`- **Reasoning — drivers:** ${v.reasoning.cites_right_drivers}`);
        lines.push(`- **Reasoning — actionability:** ${v.reasoning.actionability}`);
        lines.push(`- **Reasoning — hallucination:** ${v.reasoning.hallucination}`);
        lines.push(`- **Overall:** ${v.overall}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("> Grow the golden seed: see [GOLDEN_SEED_GROWTH.md](./GOLDEN_SEED_GROWTH.md).");
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- report`
Expected: PASS — pass rate, per-scenario rows, failure reasoning, checklist link all present.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eval/report.ts src/lib/eval/report.test.ts
git commit -m "feat: add markdown report builder for eval runs"
```

---

### Task 7: Runner script + temp-0 judge config + growth checklist

**Files:**
- Create: `scripts/eval-agent.ts`
- Modify: `src/lib/ai/gemini.server.ts` (JSON path: allow temperature override; default unchanged)
- Create: `docs/eval/GOLDEN_SEED_GROWTH.md`
- Test: (manual smoke — this task wires I/O + process exit, covered by the unit tests of its parts plus a live smoke run)

**Interfaces:**
- Consumes: `loadScenarios`, `metricsFromScenario` (`../src/lib/eval/scenarios`); `runInsightPipeline` (`../src/lib/agents/runInsightPipeline`); `geminiJudge`, `isPass`, `JUDGE_MODEL` (`../src/lib/ai/judge.server`); `buildMarkdownReport`, `ScenarioRun` (`../src/lib/eval/report`); `persistRun`, `RunSummary`, `RunFailure` (`../src/lib/eval/persistence`).
- Produces: the `eval:agent` executable behavior + the growth-checklist doc.

- [ ] **Step 1: Make the JSON Gemini path honor an explicit temperature (for a deterministic judge)**

In `src/lib/ai/gemini.server.ts`, the `GeminiPromptInput` interface and `executeGeminiPrompt` currently hardcode `temperature: 0.4`. Add an optional `temperature` and use it when provided.

Change the interface (around line 50):

```ts
export interface GeminiPromptInput {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
}
```

Change the `generationConfig` line inside `executeGeminiPrompt` (around line 79) from:

```ts
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
```

to:

```ts
      generationConfig: { responseMimeType: "application/json", temperature: input.temperature ?? 0.4 },
```

Then make the judge deterministic — in `src/lib/ai/judge.server.ts`, update the `geminiJudge` call to pass `temperature: 0`:

```ts
  const res = await executeGeminiPrompt({ system, user, model: JUDGE_MODEL, temperature: 0 });
```

- [ ] **Step 2: Run the existing suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — all prior tests still green (default callers unaffected; judge schema/isPass tests unchanged).

- [ ] **Step 3: Create the growth checklist `docs/eval/GOLDEN_SEED_GROWTH.md`**

```markdown
# Golden Seed Growth Checklist

`eval_golden_seed` ships with 5 scenarios. To make `npm run eval:agent` a real
regression net, grow it to **50–100 scenarios** over time. Track coverage here.

## Coverage targets

- [ ] **Every risk tier** represented multiple times: Critical, High, Low.
- [ ] **Every initiative type** the product can recommend (Margin Defense,
      Customer Diversification, Regional Expansion, Risk Mitigation, …).
- [ ] **3+ missing-data / malformed-input cases** (like S05): all-null,
      partial-null, wrong types, out-of-range values — correct behavior is to
      flag missing/invalid fields and refuse, never to guess a tier.
- [ ] **3+ adversarial cases** (like S03 / S04): numbers that look fine alone
      but are dangerous in combination — e.g. healthy margin + >70%
      concentration, or sub-60% concentration + negative margin.

## How to add a scenario

1. Add a row to `data/seed/ExecutiveOS_LLM_Eval_Golden_Seed.xlsx` with all
   `Golden_*` fields and a precise `Rubric_Criteria` describing what a correct
   answer must do (and what must fail).
2. Re-seed the database table from the xlsx (the eval also reads the xlsx
   directly as a fallback).
3. Run `npm run eval:agent` and confirm the new scenario behaves as intended.

## Current scenarios

| ID | Tier | Theme |
| --- | --- | --- |
| S01 | High | Thin margin + concentration approaching the 60% band |
| S02 | Low | Healthy margin, low concentration — expansion-ready |
| S03 | Critical | Negative margin alone triggers Critical |
| S04 | Critical | >70% concentration triggers Critical despite a good margin |
| S05 | Insufficient data | All core fields missing — must refuse |
```

- [ ] **Step 4: Implement the runner `scripts/eval-agent.ts`**

```ts
/**
 * LLM eval harness: runs the end-to-end insight agent over every golden
 * scenario, grades each with an independent Gemini judge, writes a markdown
 * report + an eval_runs row, and exits non-zero if the pass rate is below
 * EVAL_MIN_PASS_RATE (default 1.0).
 *
 * Usage:
 *   npm run eval:agent
 *
 * Env (read from process.env or the repo .env):
 *   GEMINI_API_KEY        required (agent narration + judge)
 *   DATABASE_URL          optional — Aurora; reads eval_golden_seed, writes eval_runs
 *   EVAL_MIN_PASS_RATE    optional — default 1.0
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScenarios, metricsFromScenario } from "../src/lib/eval/scenarios";
import { runInsightPipeline } from "../src/lib/agents/runInsightPipeline";
import { geminiJudge, isPass, JUDGE_MODEL } from "../src/lib/ai/judge.server";
import { buildMarkdownReport, type ScenarioRun } from "../src/lib/eval/report";
import { persistRun, type RunFailure, type RunSummary } from "../src/lib/eval/persistence";

const AGENT_MODEL = "gemini-2.5-flash";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_PATH = path.join(ROOT, "data", "seed", "ExecutiveOS_LLM_Eval_Golden_Seed.xlsx");
const EVAL_DIR = path.join(ROOT, "docs", "eval");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL || undefined;
  const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? "1.0");

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to run the agent + judge.");
  }

  const { scenarios, source } = await loadScenarios({ databaseUrl, xlsxPath: XLSX_PATH });
  console.log(`[eval] loaded ${scenarios.length} scenarios from ${source}`);

  const runs: ScenarioRun[] = [];
  for (const scenario of scenarios) {
    const agent = await runInsightPipeline(metricsFromScenario(scenario));
    let verdict = null;
    let judgeError: string | undefined;
    try {
      verdict = await geminiJudge(scenario, {
        riskLevel: agent.riskLevel,
        initiative: agent.initiative,
        narrative: agent.narrative,
      });
    } catch (e) {
      judgeError = e instanceof Error ? e.message : String(e);
    }
    const pass = verdict ? isPass(verdict) : false;
    runs.push({ scenario, agent, verdict, judgeError, pass });
    console.log(`[eval] ${scenario.scenario_id}: ${pass ? "PASS" : "FAIL"}${judgeError ? ` (judge error: ${judgeError})` : ""}`);
  }

  const passed = runs.filter((r) => r.pass).length;
  const passRate = runs.length ? passed / runs.length : 0;
  const runAt = new Date().toISOString();
  const stamp = runAt.replace(/[:.]/g, "-");
  const reportPath = path.join(EVAL_DIR, `agent-eval-${stamp}.md`);
  const latestPath = path.join(EVAL_DIR, "agent-eval-latest.md");

  const failures: RunFailure[] = runs
    .filter((r) => !r.pass)
    .map((r) => ({ scenario_id: r.scenario.scenario_id, verdict: r.verdict, judgeError: r.judgeError }));

  const summary: RunSummary = {
    runAt,
    agentModel: AGENT_MODEL,
    judgeModel: JUDGE_MODEL,
    total: runs.length,
    passed,
    passRate,
    reportPath: path.relative(ROOT, reportPath),
    failures,
    notes: `source=${source}`,
  };

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const md = buildMarkdownReport(runs, summary);
  fs.writeFileSync(reportPath, md, "utf8");
  fs.writeFileSync(latestPath, md, "utf8");
  console.log(`[eval] report written to ${path.relative(ROOT, reportPath)}`);

  const persisted = await persistRun(summary, {
    databaseUrl,
    jsonlPath: path.join(EVAL_DIR, "agent_eval_runs.jsonl"),
  });
  console.log(`[eval] results persisted to ${persisted.target} (${persisted.detail})`);

  console.log(`\n[eval] pass rate ${Math.round(passRate * 100)}% (${passed}/${runs.length}); threshold ${Math.round(minPassRate * 100)}%`);
  if (passRate < minPassRate) {
    console.error("[eval] ❌ below threshold — failing.");
    process.exit(1);
  }
  console.log("[eval] ✅ at or above threshold.");
}

main().catch((e) => {
  console.error("\n[eval] ❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 5: Smoke-test the runner end to end**

Ensure `GEMINI_API_KEY` is set in `.env` (leave `DATABASE_URL` unset to exercise the xlsx + JSONL path).

Run: `npm run eval:agent`
Expected:
- Logs `loaded 5 scenarios from xlsx`.
- Logs a PASS/FAIL line per scenario (S01–S05).
- Writes `docs/eval/agent-eval-<stamp>.md` and `docs/eval/agent-eval-latest.md`.
- Logs `results persisted to jsonl` and creates `docs/eval/agent_eval_runs.jsonl`.
- Prints a final pass-rate line; exits 0 if all pass, non-zero otherwise.

Sanity-check the report: S05 should show the agent refusing (tier `—`) and, per its rubric, PASS; S01–S04 tiers should match golden (High/Low/Critical/Critical).

- [ ] **Step 6: Add the generated eval artifacts to .gitignore**

Append to `.gitignore`:

```
# Eval harness run artifacts (reports + local run log)
docs/eval/agent-eval-*.md
docs/eval/agent_eval_runs.jsonl
```

(Keep `docs/eval/GOLDEN_SEED_GROWTH.md` and `docs/eval/agent-eval-latest.md` tracked — `agent-eval-latest.md` is a stable pointer worth versioning; the timestamped per-run reports and JSONL are not.)

Adjust: since the glob `agent-eval-*.md` would also ignore `agent-eval-latest.md`, instead use:

```
# Eval harness run artifacts
docs/eval/agent-eval-2*.md
docs/eval/agent_eval_runs.jsonl
```

(`agent-eval-2*.md` matches the ISO-timestamp reports, which start with the year `2…`, while leaving `agent-eval-latest.md` tracked.)

- [ ] **Step 7: Commit**

```bash
git add scripts/eval-agent.ts src/lib/ai/gemini.server.ts src/lib/ai/judge.server.ts docs/eval/GOLDEN_SEED_GROWTH.md docs/eval/agent-eval-latest.md .gitignore
git commit -m "feat: add npm run eval:agent runner + golden seed growth checklist"
```

---

## Self-Review

**Spec coverage:**
- Eval runner over each `eval_golden_seed` row → Task 7 (runner) + Task 4 (loading).
- (a) Calls the full agent pipeline → Task 2 (`runInsightPipeline`), invoked in Task 7.
- (b) Captures tier + initiative + narrative → Task 2 `InsightResult`.
- (c) Separate judge call, 4 dimensions + hallucination, structured JSON → Task 3.
- (d) pass/fail (no dimension < 3, zero hallucination flags) → Task 3 `isPass`.
- Summary: % passed + failure reasoning → markdown report (Task 6) + `eval_runs` row (Task 5).
- Single command `npm run eval:agent` → Task 1 (script) + Task 7 (runner).
- Growth checklist (50–100, tiers, initiatives, 3+ missing, 3+ adversarial) → Task 7 doc.
- Aurora via `pg` + xlsx fallback → Task 4; eval_runs write + JSONL fallback → Task 5.
- Distinct judge model + temp 0 → Task 3 + Task 7 Step 1.
- Deterministic tier by rule, refuse on missing core fields (S05) → Task 2.

**Placeholder scan:** No TBD/TODO/"handle errors" placeholders; every code step shows complete code; the only `<stamp>`/`<ts>` tokens are runtime timestamps.

**Type consistency:** `InsightMetrics`, `InsightResult`, `Narrator`, `GoldenScenario`, `AgentOutput`, `JudgeVerdict`, `ScenarioRun`, `RunSummary`, `RunFailure` are each defined once and imported by consumers with matching names. `geminiNarrator`/`geminiJudge`/`isPass`/`decideTier`/`buildMarkdownReport`/`persistRun`/`loadScenarios`/`metricsFromScenario`/`EVAL_RUNS_DDL`/`JUDGE_MODEL` names are consistent across definition and use.
