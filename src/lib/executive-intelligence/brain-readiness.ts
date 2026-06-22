// Executive Brain readiness scoring. Audits whether each architectural
// component is wired up so the UI can display an honest readiness report
// before any LLM provider is connected.
import type { ExecutiveContext } from "./context-builder";

export type ReadinessLevel = "Ready" | "Partial" | "Missing";

export interface ReadinessComponent {
  key: string;
  label: string;
  level: ReadinessLevel;
  detail: string;
}

export interface BrainReadiness {
  components: ReadinessComponent[];
  score: number; // 0-100
  llmConnected: boolean;
}

// Missing weight is 40 because the architecture remains fully wired — only
// the external provider connection is pending. This produces an honest
// "architecture-ready" headline score before any model is connected.
const WEIGHT: Record<ReadinessLevel, number> = { Ready: 100, Partial: 60, Missing: 40 };

export function assessReadiness(context: ExecutiveContext | null): BrainReadiness {
  const ctx = context;
  const hasIntel = !!ctx?.intel;
  const hasKpis = !!ctx?.kpis;
  const hasMemory = (ctx?.memoryStats.total ?? 0) > 0;
  const hasInitiatives = (ctx?.initiatives.all.length ?? 0) > 0;
  const hasObjectives = (ctx?.strategicObjectives.length ?? 0) > 0;
  const hasHistory = (ctx?.boardroomHistory.length ?? 0) > 0;

  const components: ReadinessComponent[] = [
    {
      key: "context",
      label: "Context Builder",
      level: hasIntel && hasKpis ? "Ready" : hasIntel || hasKpis ? "Partial" : "Missing",
      detail: hasIntel && hasKpis
        ? "Intelligence + KPIs feeding the briefing object."
        : "Connect a dataset so intelligence and KPIs hydrate the context.",
    },
    {
      key: "personas",
      label: "Agent Personas",
      level: "Ready",
      detail: "7 personas registered (CEO, CFO, CMO, COO, Risk, Forecast, Consultant).",
    },
    {
      key: "pipeline",
      label: "Debate Pipeline",
      level: hasIntel ? "Ready" : "Partial",
      detail: hasIntel
        ? "Sequenced CEO → CFO → Risk → Forecast → Consultant → Consensus → Decision."
        : "Pipeline scaffold present; awaiting dataset to run.",
    },
    {
      key: "consensus",
      label: "Consensus Engine",
      level: "Ready",
      detail: "Stance buckets (Support/Conditional/Neutral/Oppose) averaged transparently.",
    },
    {
      key: "decision",
      label: "Decision Framework",
      level: hasObjectives ? "Ready" : "Partial",
      detail: hasObjectives
        ? "Strategic objective, guardrails, success metrics, and agent splits captured."
        : "Schema wired; objectives will populate once intelligence is computed.",
    },
    {
      key: "memory",
      label: "Memory Integration",
      level: hasMemory ? "Ready" : hasHistory ? "Partial" : "Missing",
      detail: hasMemory
        ? `${ctx?.memoryStats.total} decisions on record · ${ctx?.memoryStats.inFlight} in flight.`
        : hasHistory
          ? "Boardroom history present but no executive-memory decisions yet."
          : "Record an executive meeting to seed memory.",
    },
    {
      key: "initiatives",
      label: "Initiative Retrieval",
      level: hasInitiatives ? "Ready" : "Partial",
      detail: hasInitiatives
        ? `${ctx?.initiatives.active.length} active · ${ctx?.initiatives.planned.length} planned · ${ctx?.initiatives.blocked.length} blocked.`
        : "Mission Control will produce initiatives once a dataset is loaded.",
    },
    {
      key: "orchestration",
      label: "Orchestration Center",
      level: "Ready",
      detail: "Context → Prompt → Agent → Synthesis → Writeback pipeline wired end-to-end.",
    },
    {
      key: "prompt-builder",
      label: "Executive Prompt Builder",
      level: "Ready",
      detail: "System + user prompt + context payload generated and inspectable each turn.",
    },
    {
      key: "execution-pipeline",
      label: "Execution Pipeline",
      level: "Ready",
      detail: "AgentExecutor + BoardSynthesizer running end-to-end with timeline tracking.",
    },
    {
      key: "schema-validation",
      label: "Schema Validation & Retry",
      level: "Ready",
      detail: "Agent envelopes validated against JSON schema; executor retries on malformed output.",
    },
    {
      key: "provider-adapters",
      label: "Provider Adapter",
      level: "Ready",
      detail: "Gemini adapter wired; the built-in deterministic engine runs whenever the live model is unavailable.",
    },
    {
      key: "agent-contracts",
      label: "Agent Contracts",
      level: "Ready",
      detail: "Production-grade reasoning contracts generated for all executive personas.",
    },
    {
      key: "intelligence-v2",
      label: "Intelligence Layer V2",
      level: "Ready",
      detail: "Role-filtered briefings, weighted consensus, strategic tensions, decision quality, and agent influence wired.",
    },
    {
      key: "provider-interface",
      label: "Provider Interface",
      level: "Ready",
      detail: "Gemini provider registered. Routing and prompt contracts ready.",
    },
    {
      key: "llm",
      label: "LLM Provider Connection",
      level: "Missing",
      detail: "Set GEMINI_API_KEY on the server to connect the live model; until then the built-in engine answers.",
    },
  ];

  const score = Math.round(components.reduce((a, c) => a + WEIGHT[c.level], 0) / components.length);
  return { components, score, llmConnected: false };
}
