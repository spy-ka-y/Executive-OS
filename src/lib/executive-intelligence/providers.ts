// LLM Provider Registry — the providers ExecutiveOS actually runs against.
// Only Gemini is wired and used (see lib/ai/gemini.server.ts). Live connection
// status is fetched at runtime from the server, not declared here.
export type ProviderId = "gemini";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  vendor: string;
  defaultModel: string;
  connected: boolean;
  notes: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    defaultModel: "gemini-2.5-flash",
    connected: false, // resolved live at runtime from the server status
    notes: "Live provider. Runs the AI agents via the server-side GEMINI_API_KEY.",
  },
];

export interface ProviderReadiness {
  providerInterfaceReady: boolean;
  modelRoutingReady: boolean;
  promptArchitectureReady: boolean;
  apiKeysRequired: boolean;
  anyConnected: boolean;
}

export function providerReadiness(): ProviderReadiness {
  return {
    providerInterfaceReady: true,
    modelRoutingReady: true,
    promptArchitectureReady: true,
    apiKeysRequired: false,
    anyConnected: PROVIDERS.some((p) => p.connected),
  };
}

export interface OrchestrationPipelineStatus {
  key: string;
  label: string;
  status: "READY" | "PENDING" | "MISSING";
  detail: string;
}

export function orchestrationStatus(hasContext: boolean): OrchestrationPipelineStatus[] {
  return [
    {
      key: "context",
      label: "Context Builder",
      status: hasContext ? "READY" : "PENDING",
      detail: hasContext
        ? "Briefing object hydrated from intelligence, KPIs, memory, initiatives."
        : "Awaiting dataset to hydrate the briefing object.",
    },
    {
      key: "prompt",
      label: "Prompt Builder",
      status: "READY",
      detail: "System + user prompt + structured context payload generated each turn.",
    },
    {
      key: "agent-prompts",
      label: "Agent Prompt Generation",
      status: "READY",
      detail: "Per-agent prompt objects produced for all 7 personas.",
    },
    {
      key: "synthesis",
      label: "Consensus Synthesis",
      status: "READY",
      detail: "Stance distribution + final recommendation envelope ready for an LLM.",
    },
    {
      key: "writeback",
      label: "Memory Writeback",
      status: "READY",
      detail: "Decisions persist to Executive Memory on record.",
    },
  ];
}
