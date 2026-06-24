// Shared AI brain — client side. This is the SINGLE place that:
//   • invokes the model (via the executeBrain server function — one fetch path),
//   • constructs section-specific prompts,
//   • maps provider errors to friendly messages,
//   • exposes a loading/error/data hook (useBrain) for interactive components.
//
// No route or service file should call executeBrain directly or build its own
// fetch — they import from here. Provider is AWS Bedrock (see gemini.server.ts);
// AWS credentials are read server-side only.
import { useCallback, useRef, useState } from "react";
import {
  executeBrain,
  type BrainResult,
  type BrainError,
} from "@/lib/agents/executeBrain.functions";
import { intelligenceBriefText, type BusinessIntelligence } from "@/lib/api/intelligence";
import { capabilitySummaryText } from "@/lib/api/capability";
import { industryGroundingText, type IndustryProfile } from "@/lib/api/industry";
import type { KpiSummary, ChatMessage } from "@/lib/api/types";
import { chatSystemPrompt } from "@/lib/agents/brains/chat-brain";
import { ceoAgentSystemPrompt } from "@/lib/agents/brains/ceo-agent";
import { consultantAgentSystemPrompt } from "@/lib/agents/brains/consultant-agent";
import { boardroomAgentBrain } from "@/lib/agents/brains/boardroom-agent";

export type { BrainResult, BrainError };

// ── Single fetch path ──────────────────────────────────────────────────────
export interface BrainRequest {
  section: string;
  system: string;
  user: string;
  json?: boolean;
  model?: string;
}

export async function callBrain(req: BrainRequest): Promise<BrainResult> {
  try {
    return await executeBrain({
      data: {
        section: req.section,
        system: req.system,
        user: req.user,
        json: req.json ?? false,
        model: req.model,
      },
    });
  } catch (e) {
    // Transport/runtime failure before the handler returned a typed result.
    return {
      ok: false,
      error: { code: "network_error", message: e instanceof Error ? e.message : String(e) },
    };
  }
}

// ── Error → friendly copy ──────────────────────────────────────────────────
export function brainErrorMessage(error: BrainError): string {
  switch (error.code) {
    case "missing_key":
      return "The AI brain is not configured (no API key on the server). Showing the built-in analysis instead.";
    case "rate_limit":
      return "The AI brain is rate-limited right now. Please try again in a moment.";
    case "budget_exceeded":
      return "The daily live-AI call budget for this server is spent. Showing the built-in analysis; it resets tomorrow.";
    case "empty_response":
      return "The AI brain returned an empty answer. Please try rephrasing.";
    case "invalid_json":
    case "schema_invalid":
      return "The AI brain returned a malformed answer. Showing the built-in analysis instead.";
    case "network_error":
      return "Could not reach the AI brain. Check your connection and try again.";
    default:
      return error.message || "The AI brain hit an unexpected error.";
  }
}

// ── Grounding context ──────────────────────────────────────────────────────
export function groundingBlock(
  intel: BusinessIntelligence | null,
  kpis: KpiSummary | null,
  profile?: IndustryProfile | null,
): string {
  if (!intel && !kpis)
    return "No dataset is loaded. Reason from general executive best practice and say so.";
  const parts: string[] = [];
  if (profile) parts.push(industryGroundingText(profile));
  if (intel) parts.push("BUSINESS INTELLIGENCE:\n" + intelligenceBriefText(intel));
  if (intel) parts.push("DATA CAPABILITY (only quantify what is computable; never invent figures for the rest):\n" + capabilitySummaryText(intel.capability));
  if (intel?.trend) {
    const t = intel.trend;
    const fcParts = [
      `Revenue trend: ${t.direction} (slope ${t.slope.toFixed(0)}/period, R² ${t.r2.toFixed(2)}, p ${t.pValue.toFixed(3)}, fit ${t.strength}).`,
    ];
    if (intel.forecast?.backtestMape != null)
      fcParts.push(`Forecast backtest error on this series: ${intel.forecast.backtestMape}% MAPE.`);
    if (t.strength === "weak" || t.strength === "insufficient")
      fcParts.push("The trend is NOT statistically reliable — hedge any forward claim accordingly.");
    parts.push("STATISTICAL FIT:\n" + fcParts.join(" "));
  }
  if (kpis?.metrics?.length) {
    parts.push(
      "KPIs:\n" +
        kpis.metrics
          .map((m) => `• ${m.label}: ${m.value}${m.delta !== undefined ? ` (Δ ${m.delta})` : ""}`)
          .join("\n"),
    );
  }
  if (kpis?.anomalies?.length) {
    parts.push(
      "ANOMALIES:\n" +
        kpis.anomalies.map((a) => `• [${a.severity}] ${a.label}: ${a.note}`).join("\n"),
    );
  }
  if (intel?.bestRegion || intel?.bestCategory) {
    const seg: string[] = [];
    if (intel.bestRegion) seg.push(`Top region: ${intel.bestRegion.name}`);
    if (intel.worstRegion) seg.push(`Weakest region: ${intel.worstRegion.name}`);
    if (intel.bestCategory) seg.push(`Top category: ${intel.bestCategory.name}`);
    if (intel.worstCategory) seg.push(`Weakest category: ${intel.worstCategory.name}`);
    parts.push("SEGMENTS:\n" + seg.join(" · "));
  }
  return parts.join("\n\n");
}

// ── Section prompts ────────────────────────────────────────────────────────
// Executive Copilot (free-text chat) — system prompt comes from the chat brain.
const CHAT_SYSTEM = chatSystemPrompt;

export function buildChatPrompt(params: {
  question: string;
  intel: BusinessIntelligence | null;
  kpis: KpiSummary | null;
  history: ChatMessage[];
  profile?: IndustryProfile | null;
}): { system: string; user: string } {
  const recent = params.history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Executive" : "Copilot"}: ${m.content}`)
    .join("\n");
  const user = [
    groundingBlock(params.intel, params.kpis, params.profile),
    recent ? `\nCONVERSATION SO FAR:\n${recent}` : "",
    `\nEXECUTIVE QUESTION:\n${params.question}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system: CHAT_SYSTEM, user };
}

// CEO Brief (structured JSON) — grounded in the CEO Agent brain.
const CEO_BRIEF_SYSTEM = [
  ceoAgentSystemPrompt,
  "",
  "TASK: Produce a one-page executive brief from the business data.",
  "Return ONLY a valid JSON object (no markdown, no fences) with this exact shape:",
  '{ "summary": string, "health_score": number (0-100), "risks": [{ "title": string, "description": string, "severity": "low"|"med"|"high" }], "opportunities": [{ "title": string, "description": string, "upside": string }], "priorities": [{ "title": string, "owner": string, "due": string }], "forecast_highlights": [{ "label": string, "value": string }] }',
  "Provide 3-5 risks, 2-4 opportunities, 3-5 priorities, 3-4 forecast_highlights. Owners are executive roles (CEO/CFO/COO/CMO/CRO). Due values like '14d','30d','60d'. Ground all claims in the data.",
].join("\n");

export function buildCeoBriefPrompt(intel: BusinessIntelligence | null, kpis: KpiSummary | null, profile?: IndustryProfile | null) {
  return { system: CEO_BRIEF_SYSTEM, user: groundingBlock(intel, kpis, profile) };
}

// Consultant Report (structured JSON) — grounded in the Consultant Agent brain.
const CONSULTANT_SYSTEM = [
  consultantAgentSystemPrompt,
  "",
  "TASK: Analyze the business data and return ONLY a valid JSON object (no markdown, no fences) with this exact shape:",
  '{ "problems": [{ "title": string, "description": string, "evidence": string, "severity": "low"|"med"|"high", "financial_exposure": string, "strategic_recommendation": string, "category": "concentration"|"category"|"region"|"margin"|"customer"|"growth"|"forecast" }], "recommendations": [{ "title": string, "description": string, "impact": number(0-100), "effort": number(0-100), "timeframe": string, "expected_revenue_impact": string, "confidence": number(0-100), "owner": string, "strategic_risk": number(0-100) }], "impact_score": number(0-100), "roi_score": number(0-100), "risk_score": number(0-100), "investment_thesis": { "revenue_upside": string, "margin_improvement": string, "risk_reduction": string, "verdict": string, "posture": "Accelerate"|"Optimize"|"Stabilize"|"Defend" } }',
  "Provide 4-7 problems and 4-6 recommendations. impact_score = growth potential, roi_score = execution difficulty, risk_score = strategic risk. Ground every figure in the data.",
].join("\n");

export function buildConsultantPrompt(intel: BusinessIntelligence | null, kpis: KpiSummary | null, profile?: IndustryProfile | null) {
  return { system: CONSULTANT_SYSTEM, user: groundingBlock(intel, kpis, profile) };
}

// Boardroom agent (structured JSON per AgentResponseSchema)
export function buildBoardroomAgentPrompt(params: {
  agent: string;
  role: string;
  topic: string;
  intel: BusinessIntelligence | null;
  kpis: KpiSummary | null;
  priorDecisions?: string[];
}): { system: string; user: string } {
  const system = [
    `You are the ${params.agent} agent on an executive board. Mandate: ${params.role}.`,
    "Debate the question strictly from your role's lens, grounded in the data.",
    `Boardroom rules: ${boardroomAgentBrain.guardrails.join("; ")}.`,
    "Return ONLY a valid JSON object (no markdown, no fences) with this exact shape:",
    `{ "agent": "${params.agent}", "observation": string, "insight": string, "recommendation": string, "rationale": string, "stance": "Support"|"Conditional"|"Neutral"|"Oppose", "confidence": number(0-100), "referencedData": string[], "referencedDecisions": string[] }`,
  ].join("\n");
  const user = [
    groundingBlock(params.intel, params.kpis),
    params.priorDecisions?.length
      ? `\nPRIOR DECISIONS:\n${params.priorDecisions.map((d) => "• " + d).join("\n")}`
      : "",
    `\nBOARD QUESTION:\n${params.topic}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

// Execution Advisor (JSON list)
const ADVISOR_SYSTEM = [
  "You are the AI Execution Advisor. Given the live execution state, KPIs and risks, return ONLY a valid JSON object (no markdown, no fences):",
  '{ "advice": [{ "title": string, "reasoning": string, "confidence": number(0-100) }] }',
  "Provide 3-4 prioritized, specific, actionable items grounded in the provided state.",
].join("\n");

export function buildAdvisorPrompt(stateSummary: string) {
  return { system: ADVISOR_SYSTEM, user: stateSummary };
}

// Executive Brief narrative (free text) for Reports
const REPORT_BRIEF_SYSTEM = [
  "You are the CEO Agent writing a concise, board-ready executive brief in plain text (no markdown headers needed).",
  "Cover health, performance, top priorities and key risks. Ground everything in the supplied figures.",
].join(" ");

export function buildReportBriefPrompt(stateSummary: string) {
  return { system: REPORT_BRIEF_SYSTEM, user: stateSummary };
}

// ── Loading/error/data hook for interactive components ─────────────────────
export type BrainState = "idle" | "loading" | "done" | "error";

export interface UseBrain {
  state: BrainState;
  result: BrainResult | null;
  error: BrainError | null;
  /** Returns the result, or null if input was empty / a request superseded it. */
  run: (req: BrainRequest) => Promise<BrainResult | null>;
  reset: () => void;
}

export function useBrain(): UseBrain {
  const [state, setState] = useState<BrainState>("idle");
  const [result, setResult] = useState<BrainResult | null>(null);
  const [error, setError] = useState<BrainError | null>(null);
  const reqId = useRef(0);

  const run = useCallback(async (req: BrainRequest): Promise<BrainResult | null> => {
    if (!req.user.trim()) {
      const err: BrainError = { code: "empty_input", message: "Please enter something first." };
      setError(err);
      setState("error");
      return null;
    }
    const id = ++reqId.current;
    setState("loading");
    setError(null);
    const res = await callBrain(req);
    if (id !== reqId.current) return null; // superseded by a newer request
    setResult(res);
    if (res.ok) {
      setState("done");
    } else {
      setError(res.error);
      setState("error");
    }
    return res;
  }, []);

  const reset = useCallback(() => {
    reqId.current++;
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  return { state, result, error, run, reset };
}
