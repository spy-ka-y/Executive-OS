# Audit — Accuracy Pipeline (read-only, no code changed)

_Scope: how agents are invoked, where metrics come from, how Risk/forecast/recommendations
are produced, what validation exists, and schema mismatches. ExecutiveOS / Rabbitt BI Copilot._

## 1. Agents / "brains" defined and how each is invoked
There are **three layers**, and only one actually calls a model:

- **Prompt/persona registry — `src/lib/agents/brains/*` (11 brains)**: `data`, `kpi`,
  `forecast`, `research`, `consultant`, `ceo`, `decision`, `boardroom`, `execution`,
  `monitoring` (+ `chat`). Registered in `brains/index.ts` (`AGENT_BRAINS`, `getBrain`).
  These are **system-prompt definitions only**. They are *not* executed in the live flow —
  they feed the inspection panels via `getBrainStatus` (`executeBrain.functions.ts:112`).
- **Heuristic orchestrator — `src/lib/executive-intelligence/*` (~30 files)**: `orchestrate()`
  (used at `boardroom.tsx:155`) builds the board debate from **`mission.ts` `executiveDebate`** —
  pure heuristics, **no model call**.
- **Real model calls — 2 TanStack server functions → direct Gemini SDK**:
  - `src/lib/agents/executeBrain.functions.ts` → `executeGeminiPrompt`/`executeGeminiText`
    (`src/lib/ai/gemini.server.ts`, `@google/generative-ai`). Invoked from the client via
    `callBrain` (`src/lib/ai/brain.ts`) for Chat, the live Boardroom (one call per agent),
    CEO Brief, Consultant.
  - `src/lib/agents/executeCEO.functions.ts` → dedicated CEO agent call.
  - **No Google Agent Builder is used** — direct REST/SDK calls with a model fallback chain
    (`gemini-2.5-flash-lite → 2.5-flash → flash-latest`).

## 2. Where business metrics come from
- **Source of truth = the user's upload**, stored in Supabase **`dataset_rows`** (schemaless
  **JSONB** rows) + **`datasets`** (inferred schema). Read via `lib/api/datasets.ts`.
- Metrics are computed by **pure functions**: `lib/api/analysis.ts` (`computeKpis`,
  `forecastRevenue`) and `lib/api/intelligence.ts` (`computeIntelligence`).
- Computed outputs are cached to Supabase: `kpi_summaries`, `forecast_results`, `ceo_briefs`,
  `consultant_reports`, `boardroom_conversations`, `executive_decisions`, etc.
- **No mock business data.** BUT prescriptive coefficients are **hardcoded** (e.g.
  `mission.ts` initiative impact = `revenue × 0.08`, support bases `70/75`) — real inputs,
  invented multipliers.

## 3. Risk_Level / forecast / recommendation — how produced
| Output | Produced by | Structured? |
|---|---|---|
| **Risk_Level** | **Heuristic** (`mission.ts executiveDebate`, threshold on concentration/margin/consensus). **Not the LLM.** | Enum string, persisted to `executive_decisions.risk_level` |
| **Forecast number + band** | **Heuristic** linear regression (`analysis.ts forecastRevenue`). **Not the LLM.** | Numeric series |
| **Recommendation** | **Both**: live LLM (Boardroom/Consultant) **and** heuristic templates (`mission.ts`) | LLM path is **structured** — `AgentResponseSchema` (zod): `stance`, `confidence`, text fields |
- The live LLM returns **stance + self-reported confidence + prose** only. It does **not**
  emit Risk_Level or forecast numbers — those remain heuristic and are merged in the UI.

## 4. Test / eval / validation infrastructure
- **No automated tests** — no vitest/jest/playwright, no `*.test.*` in `src/`, no test deps.
- **Runtime structural validation only**: `lib/schemas/agentResponse.ts` (zod) gates LLM JSON;
  `executive-intelligence/schema-validator.ts` + `agent-contracts.ts` validate contract shape;
  `brain-readiness.ts` scores wiring. These check **shape, not correctness** — no backtest,
  no accuracy/error measurement, no eval harness.
- **Informal**: in-app "Brain Status" / "Agent Contracts" inspection panels;
  `reportLovableError` error capture; console logging.

## 5. Naming / schema mismatches
- **Biggest gap — metric resolution:** agents/intel expect *roles* (region, category, revenue,
  profit, customer) but `dataset_rows` is **arbitrary JSONB**. Reconciliation is **fuzzy keyword
  matching** (`REGION_KEYS`, `REVENUE_KEYS`, … in `intelligence.ts`). A column the keyword list
  doesn't recognize → that metric **silently resolves to null/empty**, with no error surfaced.
- **`executive_decisions.revenue_impact` / `profit_impact` are TEXT** (e.g. "+$420K over 2
  quarters"), not numeric — display strings, can't be re-aggregated or evaluated later.
- **Dropped LLM fields:** `AgentResponseSchema` validates `referencedData` /
  `referencedDecisions`, but the Boardroom UI **ignores them** (only stance/confidence/prose used).
- **Possibly orphaned tables:** `decision_simulations`, `action_plans` writers include the
  dead functions (`simulateDecision`, `generateActionPlan`, `runBoardroom` in `ai.ts`) flagged
  earlier — verify whether any live route still writes them.

## Gaps to fill
1. **No data-capability gating** — metrics compute regardless of whether the upload supports
   them; silent null on unrecognized columns instead of "can't compute / column not found."
2. **Hardcoded coefficients** for impact $ / margin bps / support bases — not fit to the data.
3. **No real accuracy metric** anywhere — forecast has no backtest (MAPE/RMSE); confidences are
   self-reported or constant.
4. **Risk_Level & forecast never reach the LLM as structured tool output** — they stay heuristic
   and are stitched in beside live AI prose.
5. **No eval/test harness** — nothing measures whether any number is right.
6. **Persisted impacts are free-text**, not numeric/structured → not analyzable downstream.
7. **No explicit column-role mapping** — fuzzy matching only; no user confirmation or fallback.
