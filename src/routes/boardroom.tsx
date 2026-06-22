import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Users,
  PlayCircle,
  MessageSquareQuote,
  Gauge,
  Trophy,
  FlaskConical,
  History,
  FileText,
  CircleDot,
  Brain,
  ChevronDown,
  Cpu,
  Workflow,
  Layers,
  Sparkles,
  ShieldCheck,
  Terminal,
  Code2,
  Bot,
  GitMerge,
  Plug,
  Zap,
  Scale,
  Award,
  Target,
} from "lucide-react";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/score-ring";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import { computeBusinessIntelligence } from "@/lib/api/intelligence";
import { type BoardroomAgentResponse, deriveInitiatives } from "@/lib/api/mission";
import { saveBoardroom, listBoardroom, saveExecutiveDecision, listExecutiveDecisions } from "@/lib/api/persistence";
import type { SimulationScenario, ExecutiveDecision } from "@/lib/api/types";
import { buildExecutiveContext, orchestrate, type ExecutiveContext } from "@/lib/executive-intelligence/agent-orchestrator";
import { AGENT_PERSONAS, AGENT_ORDER, type AgentId, type AgentPersona } from "@/lib/executive-intelligence/agent-personas";
import { calculateConsensus, type ConsensusBreakdown, type Stance } from "@/lib/executive-intelligence/consensus-engine";
import { buildDecisionRecord, type BoardDecisionRecord } from "@/lib/executive-intelligence/decision-framework";
import { assessReadiness, type BrainReadiness, type ReadinessLevel } from "@/lib/executive-intelligence/brain-readiness";
import { buildExecutivePrompt, type AgentPromptObject, type ExecutivePromptBundle } from "@/lib/executive-intelligence/prompt-builder";
import { runExecutionPipeline, type PipelineResult } from "@/lib/executive-intelligence/execution-pipeline";
import type { AgentExecutionResult } from "@/lib/executive-intelligence/agent-executor";
import type { FinalBoardDecision } from "@/lib/executive-intelligence/board-synthesizer";
import type { ExecutionStage } from "@/lib/executive-intelligence/execution-status";
import { PROVIDER_ADAPTERS } from "@/lib/executive-intelligence/provider-adapters";
import { PROVIDERS, providerReadiness, orchestrationStatus } from "@/lib/executive-intelligence/providers";
import { tokenSimilarity } from "@/lib/executive-intelligence/memory-engine";
import { listAgentContracts, validateAllContracts, type AgentContract } from "@/lib/executive-intelligence/agent-contracts";
import { buildAllBriefings, type AgentBriefing } from "@/lib/executive-intelligence/agent-briefings";
import { computeAllAlignments, type AgentAlignment } from "@/lib/executive-intelligence/pressure-engine";
import { detectTensions, type StrategicTension } from "@/lib/executive-intelligence/conflict-engine";
import { computeWeightedConsensus, type WeightedConsensus } from "@/lib/executive-intelligence/weighted-consensus";
import { computeDecisionQuality, type DecisionQuality } from "@/lib/executive-intelligence/decision-quality";
import { computeAgentInfluence, type AgentInfluence } from "@/lib/executive-intelligence/agent-influence";
import { executeCEO, getGeminiStatus, type ExecuteCEOResult } from "@/lib/agents/executeCEO.functions";
import { pingBrain } from "@/lib/agents/executeBrain.functions";
import { useServerFn } from "@tanstack/react-start";
import { callBrain, buildBoardroomAgentPrompt } from "@/lib/ai/brain";
import { AgentResponseSchema } from "@/lib/schemas/agentResponse";

export const Route = createFileRoute("/boardroom")({
  head: () => ({ meta: [{ title: "AI Boardroom, ExecutiveOS" }] }),
  component: BoardroomPage,
});

const QUICK_QUESTIONS = [
  "Should we expand internationally?",
  "What should be our top priority next quarter?",
  "Where should we invest additional budget?",
  "How can we increase revenue?",
  "What is our biggest risk?",
  "Should we hire more salespeople?",
];

const SCENARIOS: { label: string; scenario: SimulationScenario }[] = [
  { label: "Increase marketing spend 20%", scenario: { priceChangePct: 0, marketingSpendDeltaPct: 20, headcountDelta: 0, churnDeltaPct: 0 } },
  { label: "Reduce pricing 10%", scenario: { priceChangePct: -10, marketingSpendDeltaPct: 0, headcountDelta: 0, churnDeltaPct: -3 } },
  { label: "Expand into a new region", scenario: { priceChangePct: 0, marketingSpendDeltaPct: 15, headcountDelta: 8, churnDeltaPct: 0 } },
  { label: "Launch new category", scenario: { priceChangePct: 0, marketingSpendDeltaPct: 25, headcountDelta: 5, churnDeltaPct: 0 } },
  { label: "Hire additional sales team", scenario: { priceChangePct: 0, marketingSpendDeltaPct: 5, headcountDelta: 10, churnDeltaPct: -1 } },
  { label: "Acquire more customers", scenario: { priceChangePct: -3, marketingSpendDeltaPct: 30, headcountDelta: 4, churnDeltaPct: 0 } },
];

const AGENT_CHIPS: Record<BoardroomAgentResponse["agent"], string> = {
  CEO: "from-primary to-primary/60",
  CFO: "from-secondary to-secondary/60",
  CMO: "from-chart-3 to-chart-3/60",
  COO: "from-chart-2 to-chart-2/60",
  Risk: "from-destructive to-destructive/60",
  Forecast: "from-chart-4 to-chart-4/60",
  Consultant: "from-chart-5 to-chart-5/60",
};

function BoardroomPage() {
  const qc = useQueryClient();
  const { activeDatasetId } = useActiveDataset();
  const [topic, setTopic] = useState("What should be our top priority next quarter?");
  const [scenario, setScenario] = useState<SimulationScenario | null>(null);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; startedAt: string; datasetId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // Phase 11, Live AI debate: real Gemini reasoning for every board agent
  // (not just CEO). Keyed by agent; merged over the heuristic responses below.
  type AiAgentReply = { observation: string; insight: string; recommendation: string; rationale: string; confidence: number; support: number };
  const [aiAgents, setAiAgents] = useState<Record<string, AiAgentReply>>({});
  const [debateBusy, setDebateBusy] = useState(false);
  const [debateError, setDebateError] = useState<string | null>(null);
  const debateRunId = useRef(0);

  const { data: dataset } = useQuery({
    queryKey: ["dataset", activeDatasetId],
    queryFn: () => (activeDatasetId ? getDataset(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["dataset-rows", activeDatasetId],
    queryFn: () => (activeDatasetId ? getDatasetRows(activeDatasetId) : []),
    enabled: !!activeDatasetId,
  });
  const { data: meetings = [] } = useQuery({
    queryKey: ["boardroom", activeDatasetId],
    queryFn: () => listBoardroom(activeDatasetId),
  });
  const { data: memory = [] } = useQuery({
    queryKey: ["executive-decisions", activeDatasetId],
    queryFn: () => listExecutiveDecisions(activeDatasetId),
  });

  const intel = useMemo(() => {
    if (!dataset || !rows.length) return null;
    const kpis = computeKpis(rows, dataset.schema);
    return computeBusinessIntelligence(rows, dataset.schema, kpis);
  }, [dataset, rows]);
  const kpis = useMemo(() => (dataset && rows.length ? computeKpis(rows, dataset.schema) : null), [dataset, rows]);
  const initiatives = useMemo(() => deriveInitiatives(intel, kpis), [intel, kpis]);

  const context = useMemo(
    () => buildExecutiveContext({ question: topic, memory, initiatives, intel, kpis, meetings }),
    [topic, memory, initiatives, intel, kpis, meetings],
  );
  const debate = useMemo(() => orchestrate(context, scenario), [context, scenario]);
  const consensus = useMemo(() => calculateConsensus(debate.responses), [debate]);
  const decisionRecord = useMemo(
    () => buildDecisionRecord(debate.decision, consensus, context, debate.strategicAlignment),
    [debate, consensus, context],
  );
  const readiness = useMemo(() => assessReadiness(intel ? context : null), [context, intel]);
  const promptBundle = useMemo<ExecutivePromptBundle>(() => buildExecutivePrompt(context), [context]);
  const [pipeline, setPipeline] = useState<PipelineResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    runExecutionPipeline({ context, debate, promptBundle })
      .then((res) => { if (!cancelled) setPipeline(res); })
      .catch(() => { if (!cancelled) setPipeline(null); });
    return () => { cancelled = true; };
  }, [context, debate, promptBundle]);
  const agentExecutions: AgentExecutionResult[] = pipeline?.agentResults ?? [];
  const executionStages: ExecutionStage[] = pipeline?.stages ?? [];
  const finalBoardDecision: FinalBoardDecision | null = pipeline?.finalDecision ?? null;
  const orchestration = useMemo(() => orchestrationStatus(!!intel), [intel]);
  const provReadinessBase = useMemo(() => providerReadiness(), []);

  // Phase 10, Real CEO execution via Gemini (server function).
  const callCEO = useServerFn(executeCEO);
  const callGeminiStatus = useServerFn(getGeminiStatus);
  const callPingBrain = useServerFn(pingBrain);
  const [ceoExecution, setCeoExecution] = useState<{
    state: "idle" | "running" | "completed" | "failed";
    result?: ExecuteCEOResult;
    startedAt?: number;
    durationMs?: number;
  }>({ state: "idle" });
  const [geminiStatus, setGeminiStatus] = useState<{ connected: boolean; model: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fast first paint from key presence, then upgrade to a REAL connectivity
    // probe (one cached model call) so "Connected" means we actually reached it.
    callGeminiStatus({})
      .then((s) => { if (!cancelled) setGeminiStatus(s); })
      .catch(() => { if (!cancelled) setGeminiStatus({ connected: false, model: "gemini-2.5-flash" }); });
    callPingBrain({})
      .then((p) => {
        if (cancelled) return;
        if (p.ok) setGeminiStatus({ connected: true, model: p.model });
        else setGeminiStatus({ connected: false, model: "gemini-2.5-flash" });
      })
      .catch(() => { /* keep the key-presence status */ });
    return () => { cancelled = true; };
  }, [callGeminiStatus, callPingBrain]);

  useEffect(() => {
    if (!intel) return;
    const ceoPrompt = promptBundle.agentPrompts.find((p) => p.role === "CEO");
    const ceoContract = listAgentContracts().find((c) => c.agent === "CEO");
    if (!ceoPrompt || !ceoContract) return;
    let cancelled = false;
    const startedAt = performance.now();
    setCeoExecution({ state: "running", startedAt: Date.now() });
    callCEO({
      data: {
        systemPrompt: promptBundle.systemPrompt,
        userPrompt: promptBundle.userPrompt,
        contextPayload: promptBundle.contextPayload,
        agentPrompt: ceoPrompt as unknown as Record<string, unknown>,
        contract: ceoContract as unknown as Record<string, unknown>,
      },
    })
      .then((result) => {
        if (cancelled) return;
        const durationMs = Math.round(performance.now() - startedAt);
        setCeoExecution({ state: result.ok ? "completed" : "failed", result, durationMs });
      })
      .catch((err) => {
        if (cancelled) return;
        const durationMs = Math.round(performance.now() - startedAt);
        setCeoExecution({
          state: "failed",
          result: { ok: false, error: { code: "network_error", message: err instanceof Error ? err.message : String(err) } },
          durationMs,
        });
      });
    return () => { cancelled = true; };
  }, [intel, promptBundle, callCEO]);

  // Overlay the real CEO envelope onto the heuristic pipeline output so the
  // existing Section 14 / 15 UI surfaces live Gemini reasoning for CEO.
  const agentExecutionsLive: AgentExecutionResult[] = useMemo(() => {
    if (!pipeline) return agentExecutions;
    if (!(ceoExecution.result && ceoExecution.result.ok)) return agentExecutions;
    const real = ceoExecution.result;
    return agentExecutions.map((r) => {
      if (r.status.agent !== "CEO") return r;
      const supportFromStance =
        real.response.stance === "Support" ? 85 :
        real.response.stance === "Conditional" ? 65 :
        real.response.stance === "Neutral" ? 50 : 25;
      return {
        ...r,
        envelope: {
          role: "CEO",
          observation: real.response.observation,
          insight: real.response.insight,
          recommendation: real.response.recommendation,
          rationale: real.response.rationale,
          stance: real.response.stance,
          support: supportFromStance,
          confidence: Math.round(real.response.confidence),
        },
        status: {
          ...r.status,
          status: "Completed",
          provider: `Gemini · ${real.meta.model}`,
          durationMs: real.meta.durationMs,
          fellBackToHeuristic: false,
          validationErrors: [],
          error: undefined,
        },
        provider: "gemini",
        model: real.meta.model,
        promptTokens: real.meta.promptTokens,
        responseTokens: real.meta.responseTokens,
        attempts: 1,
        validationErrors: [],
        raw: real.raw,
      };
    });
  }, [pipeline, agentExecutions, ceoExecution]);

  const provReadiness = useMemo(
    () => ({ ...provReadinessBase, anyConnected: !!geminiStatus?.connected || provReadinessBase.anyConnected }),
    [provReadinessBase, geminiStatus],
  );
  const briefings = useMemo<AgentBriefing[]>(() => buildAllBriefings(context), [context]);
  const weighted = useMemo<WeightedConsensus>(() => computeWeightedConsensus(debate.responses), [debate]);
  const alignments = useMemo<AgentAlignment[]>(
    () => computeAllAlignments(debate.responses, debate.decision, context, debate.strategicAlignment),
    [debate, context],
  );
  const tensions = useMemo<StrategicTension[]>(() => detectTensions(debate.responses), [debate]);
  const quality = useMemo<DecisionQuality>(
    () => computeDecisionQuality(weighted.score, debate.strategicAlignment, debate.decision, context),
    [weighted, debate, context],
  );
  const influence = useMemo<AgentInfluence[]>(() => computeAgentInfluence(memory), [memory]);
  const alignmentByAgent = useMemo(() => {
    const m = new Map<string, AgentAlignment>();
    alignments.forEach((a) => m.set(a.agent, a));
    return m;
  }, [alignments]);
  const activeMeeting = activeMeetingId ? meetings.find((m) => m.id === activeMeetingId) : null;

  function startSession() {
    const id = crypto.randomUUID();
    setSession({ id, startedAt: new Date().toISOString(), datasetId: activeDatasetId });
    toast.success("Executive meeting in session, agents are reasoning live");
    void runLiveDebate();
  }

  async function recordMeeting() {
    setBusy(true);
    try {
      const decision = liveDecision;
      const responses = liveResponses;
      const header = `MEETING · ${session ? `Session ${session.id.slice(0, 8)} · started ${new Date(session.startedAt).toLocaleString()}` : new Date().toLocaleString()}\nQuestion: ${topic}${scenario ? `\nScenario: price ${scenario.priceChangePct}%, marketing ${scenario.marketingSpendDeltaPct}%, headcount ${scenario.headcountDelta}, churn ${scenario.churnDeltaPct}%` : ""}`;
      const msgs = [
        { id: crypto.randomUUID(), agent: "CEO" as const, content: header },
        ...responses.map((r) => ({
          id: crypto.randomUUID(),
          agent: (r.agent === "Risk" || r.agent === "Forecast" || r.agent === "Consultant" ? "CRO" : r.agent) as "CEO" | "CFO" | "CMO" | "COO" | "CRO",
          content: `[${r.agent} Agent · ${r.support}% support · ${r.confidence}% confidence]\nObservation: ${r.observation}\nInsight: ${r.insight}\nRecommendation: ${r.recommendation}\nRationale: ${r.rationale}`,
        })),
        {
          id: crypto.randomUUID(),
          agent: "CEO" as const,
          content: `BOARD DECISION · ${decision.recommendedAction}\nRevenue Impact: ${decision.expectedRevenueImpact} · Profit: ${decision.expectedProfitImpact} · Risk: ${decision.riskLevel} · Consensus ${decision.consensusScore}/100 · Owner ${decision.recommendedOwner} · ${decision.timeline}\nNext: ${decision.nextActions.join(" · ")}`,
        },
      ];
      const saved = await saveBoardroom({ dataset_id: activeDatasetId, topic, messages: msgs });
      // Executive Memory: persist decision record
      await saveExecutiveDecision({
        dataset_id: activeDatasetId,
        conversation_id: saved.id ?? null,
        question: topic,
        decision: decision.recommendedAction,
        consensus_score: decision.consensusScore,
        confidence_score: decision.confidence,
        revenue_impact: decision.expectedRevenueImpact,
        profit_impact: decision.expectedProfitImpact,
        risk_level: decision.riskLevel,
        owner: decision.recommendedOwner,
        timeline: decision.timeline,
        next_actions: decision.nextActions,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["boardroom", activeDatasetId] }),
        qc.invalidateQueries({ queryKey: ["executive-decisions", activeDatasetId] }),
        qc.invalidateQueries({ queryKey: ["executive-decisions"] }),
      ]);
      setSession(null);
      toast.success("Meeting recorded · decision committed to Executive Memory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record meeting");
    } finally {
      setBusy(false);
    }
  }


  // Reset live AI replies whenever the question changes so stale answers from a
  // previous question never show against a new one.
  useEffect(() => { setAiAgents({}); setDebateError(null); }, [topic]);

  // Merge real AI replies over the heuristic responses for the debate display.
  const liveResponses = useMemo(
    () => debate.responses.map((r) => {
      const ai = aiAgents[r.agent];
      return ai ? { ...r, observation: ai.observation, insight: ai.insight, recommendation: ai.recommendation, rationale: ai.rationale, confidence: ai.confidence, support: ai.support } : r;
    }),
    [debate.responses, aiAgents],
  );

  // When the live Gemini debate has produced replies, the headline Board
  // Decision must reflect THOSE agents — not the heuristic baseline. Recompute
  // consensus and confidence from the actual live agent supports/confidences so
  // the verdict genuinely changes with the live debate.
  const hasLiveDebate = Object.keys(aiAgents).length > 0;
  const liveDecision = useMemo(() => {
    const d = debate.decision;
    if (!hasLiveDebate || liveResponses.length === 0) return d;
    const consensusScore = Math.round(
      liveResponses.reduce((a, b) => a + b.support, 0) / liveResponses.length,
    );
    const confidence = Math.round(
      liveResponses.reduce((a, b) => a + b.confidence, 0) / liveResponses.length,
    );
    // Risk escalates if the live board fails to reach consensus, otherwise the
    // data-derived risk level stands.
    const riskLevel: typeof d.riskLevel =
      consensusScore < 50 ? "High" : consensusScore < 62 && d.riskLevel === "Low" ? "Medium" : d.riskLevel;
    return { ...d, consensusScore, confidence, riskLevel };
  }, [debate.decision, liveResponses, hasLiveDebate]);

  const stanceToSupport = (s: string) => (s === "Support" ? 85 : s === "Conditional" ? 65 : s === "Neutral" ? 50 : 25);

  // Run a real, parallel AI debate, one Gemini call per board agent, grounded
  // in the dataset. Heuristic responses remain as the fallback for any agent
  // whose call fails or returns a malformed payload.
  async function runLiveDebate() {
    if (!intel || debateBusy) return;
    const runId = ++debateRunId.current;
    setDebateBusy(true);
    setDebateError(null);
    const priorDecisions = context.relatedDecisions.related.slice(0, 4).map((d) => d.decision);
    try {
      const results = await Promise.all(
        debate.responses.map(async (r) => {
          const { system, user } = buildBoardroomAgentPrompt({ agent: r.agent, role: r.role, topic, intel, kpis, priorDecisions });
          const res = await callBrain({ section: `boardroom-${r.agent}`, system, user, json: true });
          if (!res.ok || !res.parsed) return null;
          const parsed = AgentResponseSchema.safeParse(res.parsed);
          if (!parsed.success) return null;
          const d = parsed.data;
          return [r.agent, {
            observation: d.observation,
            insight: d.insight,
            recommendation: d.recommendation,
            rationale: d.rationale,
            confidence: Math.round(d.confidence),
            support: stanceToSupport(d.stance),
          }] as const;
        }),
      );
      if (runId !== debateRunId.current) return;
      const next: Record<string, AiAgentReply> = {};
      let okCount = 0;
      for (const entry of results) { if (entry) { next[entry[0]] = entry[1]; okCount++; } }
      setAiAgents(next);
      if (okCount === 0) setDebateError("The AI brain is unavailable, showing the built-in debate. Check the server's GEMINI_API_KEY.");
    } catch (e) {
      if (runId === debateRunId.current) setDebateError(e instanceof Error ? e.message : "Live debate failed.");
    } finally {
      if (runId === debateRunId.current) setDebateBusy(false);
    }
  }

  const participantCount = debate.responses.length;
  const lastMeeting = meetings[0];

  return (
    <>
      <PageHeader
        eyebrow="06, AI Boardroom"
        title="Executive Leadership Meeting"
        description="A virtual leadership team, CEO, CFO, CMO, COO, Risk, Forecast and Consultant agents, debates each strategic question and lands a single board decision grounded in your numbers."
      />

      {/* SECTION 1, Meeting header */}
      <section className="executive-card-elevated rounded-xl p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-secondary grid place-items-center text-primary-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Executive Meeting</p>
              <h2 className="font-display text-2xl leading-tight">Boardroom Session</h2>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                <span>Dataset · <span className="text-foreground">{dataset?.name ?? "-"}</span></span>
                {session ? (
                  <span className="flex items-center gap-1"><CircleDot className="h-3 w-3 text-success animate-pulse" /> Session {session.id.slice(0, 8)} · started {new Date(session.startedAt).toLocaleTimeString()}</span>
                ) : (
                  <span className="flex items-center gap-1"><CircleDot className="h-3 w-3 text-muted-foreground" /> Idle, start a meeting to convene</span>
                )}
                <span>{participantCount} agents</span>
                <span>Last recorded · {lastMeeting?.created_at ? new Date(lastMeeting.created_at).toLocaleString() : "none yet"}</span>
              </div>

            </div>
          </div>
          <Button onClick={startSession} disabled={!!session} size="lg">
            <PlayCircle className="h-4 w-4 mr-2" /> {session ? "Meeting in session" : "Start Executive Meeting"}
          </Button>

        </div>
      </section>

      {!activeDatasetId ? (
        <EmptyState title="Select a dataset" description="Choose a dataset in the sidebar so executive agents can debate grounded in your numbers." />
      ) : !intel ? (
        <EmptyState title="Loading intelligence" description="Computing business intelligence for the executive team…" />
      ) : (
        <>
          {/* SECTION 6, Board decision (shown first after a meeting starts) */}
          <Section icon={<Trophy className="h-4 w-4" />} label="06" title="Board Decision" subtitle="The synthesized executive decision.">
            {debate.conflicts.length > 0 && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 mb-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-destructive mb-2">Strategic Conflict Detected</p>
                <ul className="space-y-2">
                  {debate.conflicts.map((c, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-foreground">{c.with}</span>
                      <span className="text-muted-foreground"> · {c.kind === "initiative" ? "Active initiative" : "Open decision"}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="executive-card-elevated rounded-xl p-6">
              <p className="text-[10px] uppercase tracking-[0.22em] text-secondary mb-2">Recommended Action</p>
              <h3 className="font-display text-2xl leading-tight">{liveDecision.recommendedAction}</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
                <DecisionStat label="Revenue Impact*" value={liveDecision.expectedRevenueImpact} tone="success" />
                <DecisionStat label="Profit Impact*" value={liveDecision.expectedProfitImpact} tone="success" />
                <DecisionStat label="Risk Level" value={liveDecision.riskLevel} tone={liveDecision.riskLevel === "High" ? "destructive" : liveDecision.riskLevel === "Medium" ? "warning" : "success"} />
                <DecisionStat label="Strategic Alignment" value={`${debate.strategicAlignment}/100`} tone={debate.strategicAlignment >= 70 ? "success" : debate.strategicAlignment >= 50 ? "warning" : "destructive"} />
                <DecisionStat label="Confidence" value={`${liveDecision.confidence}%`} />
                <DecisionStat label="Recommended Owner" value={liveDecision.recommendedOwner} />
                <DecisionStat label="Timeline" value={liveDecision.timeline} />
                <DecisionStat label="Consensus" value={`${liveDecision.consensusScore}/100`} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                {hasLiveDebate ? "Consensus & confidence computed from the live Gemini agent debate." : "Heuristic baseline. Start a meeting to run the live AI debate."}
                {" "}*Revenue/profit impact is an illustrative estimate (revenue-scaled), not a modeled prediction.
              </p>
            </div>
          </Section>

          {/* SECTION 9, Boardroom summary (shown immediately after the decision) */}
          <Section icon={<FileText className="h-4 w-4" />} label="09" title="Boardroom Summary" subtitle="Key agreements, disagreements, final recommendation and next actions.">
            <div className="grid md:grid-cols-2 gap-4">
              <SummaryCard title="Key Agreements" items={liveDecision.keyAgreements} tone="success" />
              <SummaryCard title="Key Disagreements" items={liveDecision.keyDisagreements} tone="warning" />
              <SummaryCard title="Final Recommendation" items={[liveDecision.recommendedAction]} tone="primary" />
              <SummaryCard title="Next Actions" items={liveDecision.nextActions} tone="secondary" />
            </div>
            <div className="executive-card-elevated rounded-xl p-5 mt-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Boardroom Confidence Score</p>
                <p className="font-display text-3xl">{liveDecision.confidence}/100</p>
              </div>
              <Button onClick={recordMeeting} disabled={busy}><PlayCircle className="h-4 w-4 mr-2" /> Record this meeting</Button>
            </div>
          </Section>

          {/* SECTION 2, Question center */}
          <Section icon={<MessageSquareQuote className="h-4 w-4" />} label="02" title="Executive Question Center" subtitle="Submit a strategic question or pick a quick action. The agents respond from their role.">

            <div className="executive-card rounded-xl p-5 space-y-3">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} className="bg-background/40 font-display text-base h-12 transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40" placeholder="What should the board debate?" />
              <div className="flex flex-wrap gap-2">
                {QUICK_QUESTIONS.map((q) => (
                  <button key={q} onClick={() => setTopic(q)} className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${topic === q ? "bg-primary/20 border-primary text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{q}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button size="sm" onClick={() => void runLiveDebate()} disabled={!intel || debateBusy || !topic.trim()}>
                  <Brain className={`h-4 w-4 mr-2 ${debateBusy ? "animate-pulse" : ""}`} />
                  {debateBusy ? "Agents reasoning…" : Object.keys(aiAgents).length > 0 ? "Re-run live AI debate" : "Run live AI debate"}
                </Button>
                {debateBusy ? (
                  <span className="text-xs text-muted-foreground animate-pulse">Each executive agent is reasoning over your dataset…</span>
                ) : debateError ? (
                  <span className="text-xs text-warning">{debateError}</span>
                ) : Object.keys(aiAgents).length > 0 ? (
                  <span className="text-xs text-success flex items-center gap-1"><Sparkles className="h-3 w-3" /> {Object.keys(aiAgents).length} agents answered with live AI · grounded in your data</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Run a live debate to have each agent reason with real AI (Gemini).</span>
                )}
              </div>
            </div>
          </Section>

          {/* SECTION 2.5, Relevant Historical Decisions (Memory-Aware) */}
          <Section icon={<History className="h-4 w-4" />} label="02.5" title="Relevant Historical Decisions" subtitle="Decisions retrieved from Executive Memory that the board will reference while debating this question.">
            {debate.responses.every((r) => r.referencedDecisions.length === 0) && context.relatedDecisions.related.length === 0 ? (
              <div className="executive-card rounded-xl p-5 text-sm text-muted-foreground">No prior decisions match this question yet. Agents will reason from data alone.</div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {context.relatedDecisions.related.map((d) => (
                  <div key={d.id} className="executive-card rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{d.decision}</p>
                      <Badge variant="outline" className={
                        d.status === "Completed" ? "bg-success/15 text-success border-success/30" :
                        d.status === "Blocked" ? "bg-destructive/15 text-destructive border-destructive/30" :
                        d.status === "In Progress" ? "bg-warning/15 text-warning border-warning/30" :
                        "bg-muted/30 text-muted-foreground border-border/60"
                      }>{d.status}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">Q: {d.question}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div><span className="text-muted-foreground">Consensus</span> <span className="font-medium">{d.consensus_score}/100</span></div>
                      <div><span className="text-muted-foreground">Owner</span> <span className="font-medium">{d.owner ?? "-"}</span></div>
                      <div><span className="text-muted-foreground">Timeline</span> <span className="font-medium">{d.timeline ?? "-"}</span></div>
                      <div><span className="text-muted-foreground">Revenue</span> <span className="font-medium">{d.revenue_impact ?? "-"}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* SECTION 3, Executive Agents */}
          <Section icon={<Users className="h-4 w-4" />} label="03" title="Executive Agents" subtitle="Each agent holds a distinct mandate. Their current position is computed from your data and prior decisions.">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              {liveResponses.map((a) => {
                const align = alignmentByAgent.get(a.agent);
                return (
                <div key={a.agent} className="executive-card-elevated rounded-2xl p-5">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${AGENT_CHIPS[a.agent]} grid place-items-center text-primary-foreground text-xs font-bold`}>{a.agent}</div>
                    <div>
                      <p className="font-display text-sm">{a.agent} Agent</p>
                      <p className="text-[10px] text-muted-foreground">{a.role}</p>
                    </div>
                  </div>
                  <p className="text-xs mt-3 leading-relaxed line-clamp-3">{a.recommendation}</p>
                  <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider">
                    <Badge variant="outline" className={a.support >= 75 ? "bg-success/15 text-success border-success/30" : a.support >= 60 ? "bg-warning/15 text-warning border-warning/30" : "bg-destructive/15 text-destructive border-destructive/30"}>
                      {a.support >= 75 ? "Support" : a.support >= 60 ? "Conditional" : "Oppose"}
                    </Badge>
                    <span className="text-muted-foreground">{a.confidence}% conf</span>
                  </div>
                  {align && (
                    <div className="mt-3 pt-3 border-t border-border/40">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] mb-1.5">
                        <span className="text-muted-foreground">Alignment Score</span>
                        <span className={align.score >= 70 ? "text-success" : align.score >= 50 ? "text-warning" : "text-destructive"}>{align.score}/100</span>
                      </div>
                      <Progress value={align.score} />
                      <div className="grid grid-cols-4 gap-1 mt-2 text-[10px] text-muted-foreground">
                        <div className="text-center"><div className="text-foreground">{align.strategic}</div>Strat</div>
                        <div className="text-center"><div className="text-foreground">{align.role}</div>Role</div>
                        <div className="text-center"><div className="text-foreground">{align.goal}</div>Goal</div>
                        <div className="text-center"><div className="text-foreground">{align.risk}</div>Risk</div>
                      </div>
                    </div>
                  )}
                  {a.referencedDecisions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/40">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-secondary mb-1.5">Referenced Decisions</p>
                      <ul className="space-y-1">
                        {a.referencedDecisions.map((d) => (
                          <li key={d.id} className="text-[11px] text-muted-foreground line-clamp-1">· {d.decision}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </Section>

          {/* SECTION 4, Debate */}
          <Section icon={<MessageSquareQuote className="h-4 w-4" />} label="04" title="Boardroom Debate" subtitle="Each agent contributes Observation → Insight → Recommendation → Rationale.">
            <div className="space-y-3">
              {liveResponses.map((a) => (
                <div key={a.agent} className="executive-card rounded-xl p-5 flex gap-4">
                  <div className={`h-12 w-12 flex-shrink-0 rounded-full bg-gradient-to-br ${AGENT_CHIPS[a.agent]} grid place-items-center text-primary-foreground text-xs font-bold shadow-elegant`}>{a.agent}</div>
                  <div className="flex-1 grid md:grid-cols-2 gap-3 text-sm">
                    <Line label="Observation" body={a.observation} />
                    <Line label="Insight" body={a.insight} />
                    <Line label="Recommendation" body={a.recommendation} accent />
                    <Line label="Rationale" body={a.rationale} />
                    {a.referencedDecisions.length > 0 && (
                      <div className="md:col-span-2 pt-2 border-t border-border/40">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-secondary mb-1">Referenced Decisions</p>
                        <div className="flex flex-wrap gap-1.5">
                          {a.referencedDecisions.map((d) => (
                            <Badge key={d.id} variant="outline" className="text-[10px] font-normal border-border/60 text-muted-foreground">{d.decision}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* SECTION 5, Consensus meter + Strategic Alignment */}
          <Section icon={<Gauge className="h-4 w-4" />} label="05" title="Consensus & Strategic Alignment" subtitle="Agent-by-agent support, overall consensus, and how this decision aligns with active initiatives and prior decisions.">
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center">
                <ScoreRing value={liveDecision.consensusScore} label="Consensus" size={140} tone={liveDecision.consensusScore >= 70 ? "success" : liveDecision.consensusScore >= 50 ? "warning" : "destructive"} />
                <p className="text-xs text-muted-foreground text-center mt-3">{liveDecision.consensusScore >= 70 ? "Strong consensus, execute." : liveDecision.consensusScore >= 50 ? "Conditional consensus, address gates." : "Low consensus, rework proposal."}</p>
              </div>
              <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center">
                <ScoreRing value={debate.strategicAlignment} label="Strategic Alignment" size={140} tone={debate.strategicAlignment >= 70 ? "success" : debate.strategicAlignment >= 50 ? "warning" : "destructive"} />
                <p className="text-xs text-muted-foreground text-center mt-3">
                  {debate.alignment.alignedInitiatives.length} aligned initiative{debate.alignment.alignedInitiatives.length === 1 ? "" : "s"} · {debate.alignment.supportingDecisions.length} prior decision{debate.alignment.supportingDecisions.length === 1 ? "" : "s"} · {debate.conflicts.length} conflict{debate.conflicts.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="space-y-2">
                {liveResponses.map((a) => (
                  <div key={a.agent} className="executive-card rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5 text-xs">
                      <span className="font-medium">{a.agent} Agent</span>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{a.confidence}% conf</span>
                        <span className={a.support >= 75 ? "text-success" : a.support >= 60 ? "text-warning" : "text-destructive"}>{a.support >= 75 ? "Agreed" : a.support >= 60 ? "Conditional" : "Dissent"}</span>
                      </div>
                    </div>
                    <Progress value={a.support} />
                  </div>
                ))}
              </div>
            </div>
            <ConsensusDistribution consensus={consensus} />
          </Section>

          {/* SECTION 7, Scenario simulator */}
          <Section icon={<FlaskConical className="h-4 w-4" />} label="07" title="Scenario Simulator" subtitle="Test a strategic move, every agent re-evaluates in real time.">
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="executive-card rounded-xl p-5 lg:col-span-1 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {SCENARIOS.map((s) => (
                    <button key={s.label} onClick={() => setScenario(s.scenario)} className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${scenario && scenario === s.scenario ? "bg-primary/20 border-primary text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
                  ))}
                  <button onClick={() => setScenario(null)} className="text-xs rounded-full px-3 py-1.5 border border-border/60 text-muted-foreground hover:text-foreground">Reset</button>
                </div>
                {scenario && (
                  <div className="space-y-3">
                    <SliderRow label="Price change" suffix="%" min={-30} max={30} value={scenario.priceChangePct} onChange={(v) => setScenario({ ...scenario, priceChangePct: v })} />
                    <SliderRow label="Marketing spend" suffix="%" min={-50} max={100} value={scenario.marketingSpendDeltaPct} onChange={(v) => setScenario({ ...scenario, marketingSpendDeltaPct: v })} />
                    <SliderRow label="Headcount" suffix="" min={-50} max={50} value={scenario.headcountDelta} onChange={(v) => setScenario({ ...scenario, headcountDelta: v })} />
                    <SliderRow label="Churn change" suffix="%" min={-20} max={20} value={scenario.churnDeltaPct} onChange={(v) => setScenario({ ...scenario, churnDeltaPct: v })} />
                  </div>
                )}
              </div>
              <div className="lg:col-span-2 space-y-2">
                {!scenario ? (
                  <div className="executive-card rounded-xl p-6 text-sm text-muted-foreground">Choose a scenario to see how each executive agent reacts.</div>
                ) : (
                  liveResponses.map((a) => (
                    <div key={a.agent} className="executive-card rounded-xl p-3 flex items-start gap-3">
                      <div className={`h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br ${AGENT_CHIPS[a.agent]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>{a.agent}</div>
                      <div className="flex-1">
                        <p className="text-xs">{a.recommendation}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{a.rationale}</p>
                      </div>
                      <span className={`text-[10px] whitespace-nowrap ${a.support >= 75 ? "text-success" : a.support >= 60 ? "text-warning" : "text-destructive"}`}>{a.support}% support</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Section>

          {/* SECTION 8, Meeting history */}
          <Section icon={<History className="h-4 w-4" />} label="08" title="Meeting History" subtitle="Revisit previous executive decisions for this dataset.">
            {meetings.length === 0 ? (
              <div className="executive-card rounded-xl p-6 text-sm text-muted-foreground">No prior meetings recorded yet. Start an executive meeting to capture one.</div>
            ) : (
              <div className="space-y-2">
                {meetings.map((m) => {
                  const lastMsg = m.messages[m.messages.length - 1]?.content ?? "";
                  return (
                    <button key={m.id} onClick={() => setActiveMeetingId((id) => (id === m.id ? null : m.id ?? null))} className="w-full text-left executive-card rounded-xl p-4 hover:border-primary/40 transition-colors">
                      <div className="flex justify-between gap-3 items-start">
                        <div>
                          <p className="font-medium text-sm">{m.topic}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{lastMsg}</p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{m.created_at ? new Date(m.created_at).toLocaleDateString() : ""}</span>
                      </div>
                      {activeMeeting?.id === m.id && (
                        <div className="mt-3 space-y-2 pt-3 border-t border-border/40">
                          {m.messages.map((msg) => (
                            <div key={msg.id} className="text-xs">
                              <span className="text-secondary font-medium">{msg.agent}:</span> <span className="text-muted-foreground">{msg.content}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function Section({ icon, label, title, subtitle, children }: { icon: React.ReactNode; label: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">{icon} Section {label}</p>
        <h2 className="font-display text-2xl tracking-tight mt-1">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground max-w-2xl mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Line({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-[0.18em] mb-1 ${accent ? "text-secondary" : "text-muted-foreground"}`}>{label}</p>
      <p className={`text-sm leading-relaxed ${accent ? "text-foreground" : "text-muted-foreground"}`}>{body}</p>
    </div>
  );
}

function DecisionStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" | "warning" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 p-4 bg-background/30">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`font-display text-lg mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function SummaryCard({ title, items, tone }: { title: string; items: string[]; tone: "success" | "warning" | "primary" | "secondary" }) {
  const accent = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "primary" ? "text-primary" : "text-secondary";
  return (
    <div className="executive-card rounded-xl p-5">
      <p className={`text-[10px] uppercase tracking-[0.22em] mb-3 ${accent}`}>{title}</p>
      <ul className="space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2"><span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${accent.replace("text-", "bg-")} flex-shrink-0`} /><span className="leading-relaxed">{it}</span></li>
        ))}
      </ul>
    </div>
  );
}

function SliderRow({ label, suffix, min, max, value, onChange }: { label: string; suffix: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value > 0 ? "+" : ""}{value}{suffix}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

function tokenize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3);
}
function similarity(a: string, b: string) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  ta.forEach((t) => { if (tb.has(t)) hits++; });
  return hits / Math.max(ta.size, tb.size);
}

function MemoryContext({ memory, topic }: { memory: ExecutiveDecision[]; topic: string }) {
  const relevant = useMemo(() => {
    if (!memory.length) return [];
    return memory
      .map((m) => ({ m, score: similarity(m.question + " " + m.decision, topic) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.m);
  }, [memory, topic]);

  const inFlight = memory.filter((m) => m.status === "In Progress");
  const completed = memory.filter((m) => m.status === "Completed").length;
  const avgConsensus = memory.length
    ? Math.round(memory.reduce((a, m) => a + m.consensus_score, 0) / memory.length)
    : 0;

  if (!memory.length) {
    return (
      <Section icon={<Brain className="h-4 w-4" />} label="01.5" title="Executive Memory" subtitle="No prior decisions on record. Agents will respond from data only.">
        <div className="executive-card rounded-xl p-5 text-sm text-muted-foreground">
          This is the first executive meeting for this dataset. After you record a decision it joins the memory and informs future debates.
        </div>
      </Section>
    );
  }

  return (
    <Section icon={<Brain className="h-4 w-4" />} label="01.5" title="Executive Memory" subtitle="Agents reference prior decisions, in-flight execution, and historical consensus before responding.">
      <div className="grid lg:grid-cols-3 gap-3 mb-3">
        <div className="executive-card rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Decisions on record</p>
          <p className="font-display text-2xl">{memory.length}</p>
          <p className="text-[11px] text-muted-foreground">{completed} completed · {inFlight.length} in-flight</p>
        </div>
        <div className="executive-card rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Avg Consensus</p>
          <p className="font-display text-2xl">{avgConsensus}<span className="text-base text-muted-foreground">/100</span></p>
        </div>
        <div className="executive-card rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Open initiatives</p>
          <p className="font-display text-2xl">{inFlight.length}</p>
          <p className="text-[11px] text-muted-foreground line-clamp-1">{inFlight[0]?.decision ?? "None active"}</p>
        </div>
      </div>
      {relevant.length > 0 && (
        <div className="executive-card-elevated rounded-xl p-5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary mb-3">Agents will reference these prior decisions</p>
          <div className="space-y-2">
            {relevant.map((m) => {
              const days = Math.max(0, Math.round((Date.now() - new Date(m.created_at).getTime()) / 86400000));
              return (
                <div key={m.id} className="rounded-lg border border-border/60 p-3 bg-background/30">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{m.decision}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Q: {m.question}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {days}d ago · Consensus {m.consensus_score}/100 · Progress {m.progress}% · Owner {m.owner ?? "-"}
                      </p>
                    </div>
                    <Badge variant="outline" className={
                      m.status === "Completed" ? "bg-success/15 text-success border-success/30" :
                      m.status === "Blocked" ? "bg-destructive/15 text-destructive border-destructive/30" :
                      m.status === "In Progress" ? "bg-warning/15 text-warning border-warning/30" :
                      "bg-muted/30 text-muted-foreground border-border/60"
                    }>{m.status}</Badge>
                  </div>
                  {m.status !== "Completed" && (
                    <p className="text-[11px] text-secondary mt-2">
                      Note to agents: complete execution of this decision before committing to a directly competing initiative.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────────────────────────────────────────────
// PHASE 7A, Executive Brain UI components
// ───────────────────────────────────────────────────────────────────

function ContextPreview({ context, scenario }: { context: ExecutiveContext; scenario: SimulationScenario | null }) {
  const [open, setOpen] = useState(false);
  const briefing = {
    question: context.question,
    timestamp: new Date().toISOString(),
    dataset: {
      hasIntel: !!context.intel,
      hasKpis: !!context.kpis,
      totalRevenue: context.intel?.totalRevenue ?? null,
      growthPct: context.intel?.growthPct ?? null,
      marginPct: context.intel?.marginPct ?? null,
      forecastConsistency: context.intel?.trendConsistency ?? null,
      categoryConcentrationPct: context.intel?.categoryConcentrationPct ?? null,
      customerConcentrationPct: context.intel?.customerConcentrationPct ?? null,
    },
    scenario: scenario ?? null,
    kpiSummary: context.kpis?.metrics.map((m) => ({ label: m.label, value: m.value, delta: m.delta })) ?? [],
    strategicObjectives: context.strategicObjectives.map((o) => ({
      title: o.title, priority: o.priority, progress: o.progress, owner: o.owner,
    })),
    activeInitiatives: context.initiatives.active.map((i) => ({
      title: i.title, status: i.status, priority: i.priority, owner: i.owner, progress: i.progress,
    })),
    missionPriorities: context.missionPriorities.map((i) => i.title),
    executionStatus: context.executionStatus,
    previousDecisions: context.boardroomHistory.length,
    relevantHistoricalDecisions: context.relatedDecisions.related.map((d) => ({
      decision: d.decision, status: d.status, consensus: d.consensus_score, owner: d.owner,
    })),
    openDecisions: context.relatedDecisions.open.length,
    consensusHistory: { avgConsensus: context.memoryStats.avgConsensus, successRate: context.memoryStats.successRate },
    memoryStats: context.memoryStats,
  };
  return (
    <Section icon={<Cpu className="h-4 w-4" />} label="01.6" title="Executive Context Preview" subtitle="The full briefing object the agents reason from, the same payload sent to Gemini on each live debate.">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="executive-card rounded-xl">
          <CollapsibleTrigger className="w-full flex items-center justify-between p-5 text-left">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-secondary" />
              <div>
                <p className="text-sm font-medium">Executive Briefing Object</p>
                <p className="text-[11px] text-muted-foreground">{briefing.strategicObjectives.length} objectives · {briefing.activeInitiatives.length} active initiatives · {briefing.relevantHistoricalDecisions.length} relevant prior decisions</p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/40 p-5">
              <pre className="text-[11px] leading-relaxed text-muted-foreground bg-background/40 rounded-lg p-4 max-h-[420px] overflow-auto whitespace-pre">{JSON.stringify(briefing, null, 2)}</pre>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </Section>
  );
}

function AgentReasoningInputs({ context, debate }: { context: ExecutiveContext; debate: ReturnType<typeof orchestrate> }) {
  const initiativesPool = [...context.initiatives.active, ...context.initiatives.planned, ...context.missionPriorities];
  function relevantInitiatives(p: AgentPersona) {
    const domain = p.domain.join(" ");
    return initiativesPool
      .map((i) => ({ i, score: tokenSimilarity(`${i.title} ${i.why}`, `${domain} ${context.question}`) }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((x) => x.i);
  }
  return (
    <Section icon={<Layers className="h-4 w-4" />} label="03.5" title="Agent Reasoning Inputs" subtitle="What each agent would see as context before generating a response. This is the exact reasoning surface an LLM call will receive.">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {AGENT_ORDER.map((id) => {
          const p = AGENT_PERSONAS[id];
          const refs = debate.responses.find((r) => r.agent === id)?.referencedDecisions ?? [];
          const inits = relevantInitiatives(p);
          return (
            <div key={id} className="executive-card rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${AGENT_CHIPS[id]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>{id}</div>
                <div>
                  <p className="font-display text-sm">{p.title}</p>
                  <p className="text-[10px] text-muted-foreground">{p.decisionStyle}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Goals</p>
                <div className="flex flex-wrap gap-1">
                  {p.goals.map((g) => <Badge key={g} variant="outline" className="text-[10px] font-normal border-border/60">{g}</Badge>)}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Metrics Considered</p>
                <ul className="space-y-0.5">
                  {p.metrics.map((m) => <li key={m} className="text-[11px] text-muted-foreground">· {m}</li>)}
                </ul>
              </div>
              <div className="pt-2 border-t border-border/40">
                <p className="text-[10px] uppercase tracking-[0.18em] text-secondary mb-1">Relevant Historical Decisions</p>
                {refs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No prior decisions match this agent's lens.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {refs.map((d) => <li key={d.id} className="text-[11px] text-muted-foreground line-clamp-1">· {d.decision}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-secondary mb-1">Current Initiative Impact</p>
                {inits.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No active initiatives intersect this agent's domain.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {inits.map((i) => <li key={i.id} className="text-[11px] text-muted-foreground line-clamp-1">· {i.title} <span className="text-[10px]">({i.status})</span></li>)}
                  </ul>
                )}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11px]">
                <span className="text-muted-foreground">Strategic Alignment Impact</span>
                <span className="font-medium">{debate.strategicAlignment}/100</span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const PIPELINE_STAGES: Array<{ id: AgentId | "Question" | "Consensus" | "Decision"; label: string }> = [
  { id: "Question", label: "Question" },
  { id: "CEO", label: "CEO Review" },
  { id: "CFO", label: "CFO Review" },
  { id: "Risk", label: "Risk Review" },
  { id: "Forecast", label: "Forecast Review" },
  { id: "Consultant", label: "Consultant Synthesis" },
  { id: "Consensus", label: "Consensus" },
  { id: "Decision", label: "Board Decision" },
];

function DebatePipeline({ topic, consensus }: { topic: string; consensus: ConsensusBreakdown }) {
  return (
    <Section icon={<Workflow className="h-4 w-4" />} label="04.5" title="Executive Debate Flow" subtitle="How the boardroom reasons from question to decision. Each stage is a hand-off the orchestrator executes.">
      <div className="executive-card rounded-xl p-5 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          {PIPELINE_STAGES.map((stage, idx) => {
            const isAgent = AGENT_ORDER.includes(stage.id as AgentId);
            const agentStance = isAgent ? consensus.agents.find((a) => a.agent === (stage.id as AgentId)) : null;
            const sub = stage.id === "Question"
              ? topic.length > 32 ? topic.slice(0, 32) + "…" : topic
              : stage.id === "Consensus"
                ? `${consensus.consensusScore}/100`
                : stage.id === "Decision"
                  ? "Synthesized"
                  : agentStance ? `${agentStance.stance} · ${agentStance.rawSupport}%` : "";
            return (
              <div key={stage.id} className="flex items-center gap-2">
                <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 min-w-[140px]">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{idx === 0 ? "Input" : idx === PIPELINE_STAGES.length - 1 ? "Output" : `Stage ${idx}`}</p>
                  <p className="text-xs font-medium mt-0.5">{stage.label}</p>
                  {sub && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{sub}</p>}
                </div>
                {idx < PIPELINE_STAGES.length - 1 && (
                  <span className="text-muted-foreground text-xs">→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

const STANCE_TONE: Record<Stance, string> = {
  Support: "bg-success/15 text-success border-success/30",
  Conditional: "bg-warning/15 text-warning border-warning/30",
  Neutral: "bg-muted/30 text-muted-foreground border-border/60",
  Oppose: "bg-destructive/15 text-destructive border-destructive/30",
};
const STANCE_BAR: Record<Stance, string> = {
  Support: "bg-success",
  Conditional: "bg-warning",
  Neutral: "bg-muted-foreground/60",
  Oppose: "bg-destructive",
};

function ConsensusDistribution({ consensus }: { consensus: ConsensusBreakdown }) {
  return (
    <div className="mt-4 executive-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Consensus Distribution</p>
          <p className="text-xs text-muted-foreground mt-0.5">Dynamically calculated from each agent's stance.</p>
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-[11px] underline decoration-dotted text-muted-foreground hover:text-foreground">How is this calculated?</button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs bg-popover text-popover-foreground border border-border/60 text-[11px] leading-relaxed">
              Support = 100 · Conditional = 60 · Neutral = 50 · Oppose = 0. Consensus = average across all {consensus.agents.length} agents = {consensus.consensusScore}/100. Raw-support average is {consensus.averageRawSupport}/100.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="grid sm:grid-cols-4 gap-2 mb-4">
        {consensus.distribution.map((d) => (
          <div key={d.stance} className="rounded-lg border border-border/60 p-3 bg-background/30">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{d.stance}</p>
            <p className="font-display text-xl mt-0.5">{d.count}</p>
            <div className="mt-2 h-1.5 rounded-full bg-background overflow-hidden">
              <div className={`h-full ${STANCE_BAR[d.stance]}`} style={{ width: `${d.pct}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{d.pct}% of board</p>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {consensus.agents.map((a) => (
          <div key={a.agent} className="flex items-center justify-between rounded-lg border border-border/60 p-2 bg-background/30 text-[11px]">
            <span className="font-medium">{a.agent}</span>
            <Badge variant="outline" className={STANCE_TONE[a.stance]}>{a.stance} · {a.score}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionFramework({ record }: { record: BoardDecisionRecord }) {
  return (
    <Section icon={<ShieldCheck className="h-4 w-4" />} label="06.5" title="Board Decision Framework" subtitle="The canonical decision schema each Gemini agent response is validated against.">
      <div className="executive-card-elevated rounded-xl p-6 space-y-5">
        <div className="grid md:grid-cols-2 gap-3">
          <DecisionStat label="Strategic Objective" value={record.strategicObjective} />
          <DecisionStat label="Owner" value={record.owner} />
          <DecisionStat label="Timeline" value={record.timeline} />
          <DecisionStat label="Risk Level" value={record.riskLevel} tone={record.riskLevel === "High" ? "destructive" : record.riskLevel === "Medium" ? "warning" : "success"} />
          <DecisionStat label="Confidence" value={`${record.confidence}%`} />
          <DecisionStat label="Strategic Alignment" value={`${record.strategicAlignmentScore}/100`} tone={record.strategicAlignmentScore >= 70 ? "success" : record.strategicAlignmentScore >= 50 ? "warning" : "destructive"} />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <AgentSplit label="Supporting" agents={record.supportingAgents} tone="success" />
          <AgentSplit label="Conditional" agents={record.conditionalAgents} tone="warning" />
          <AgentSplit label="Opposing" agents={record.opposingAgents} tone="destructive" />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/60 p-4 bg-background/30">
            <p className="text-[10px] uppercase tracking-[0.22em] text-secondary mb-2">Success Metrics</p>
            <ul className="space-y-1.5">
              {record.successMetrics.map((m, i) => <li key={i} className="text-xs flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-secondary flex-shrink-0" /><span>{m}</span></li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-border/60 p-4 bg-background/30">
            <p className="text-[10px] uppercase tracking-[0.22em] text-warning mb-2">Required Guardrails</p>
            <ul className="space-y-1.5">
              {record.requiredGuardrails.map((g, i) => <li key={i} className="text-xs flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-warning flex-shrink-0" /><span>{g}</span></li>)}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}

function AgentSplit({ label, agents, tone }: { label: string; agents: AgentId[]; tone: "success" | "warning" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <div className="rounded-lg border border-border/60 p-4 bg-background/30">
      <p className={`text-[10px] uppercase tracking-[0.22em] mb-2 ${cls}`}>{label} ({agents.length})</p>
      {agents.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {agents.map((a) => <Badge key={a} variant="outline" className="text-[10px] font-normal border-border/60">{a}</Badge>)}
        </div>
      )}
    </div>
  );
}

const LEVEL_TONE: Record<ReadinessLevel, string> = {
  Ready: "bg-success/15 text-success border-success/30",
  Partial: "bg-warning/15 text-warning border-warning/30",
  Missing: "bg-destructive/15 text-destructive border-destructive/30",
};

function BrainStatus({ readiness }: { readiness: BrainReadiness }) {
  const tone = readiness.score >= 80 ? "success" : readiness.score >= 50 ? "warning" : "destructive";
  return (
    <Section icon={<Brain className="h-4 w-4" />} label="17" title="Executive Brain Status" subtitle="Reasoning stack powering the live Gemini agents. Each component is wired, inspectable, and in use during a live debate.">
      <div className="grid lg:grid-cols-[260px_1fr] gap-4">
        <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center">
          <ScoreRing value={readiness.score} label="AI Readiness" size={140} tone={tone} />
          <p className="text-[11px] text-muted-foreground text-center mt-3">
            {readiness.score >= 80 ? "Reasoning stack fully wired and running live against Gemini." : readiness.score >= 50 ? "Most components wired, finish the partials to unlock full reasoning." : "Foundation in place, load a dataset and seed memory to advance."}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {readiness.components.map((c) => (
            <div key={c.key} className="executive-card rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{c.label}</p>
                <Badge variant="outline" className={LEVEL_TONE[c.level]}>{c.level}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────────────────────────────────────────────────
// PHASE 7B.1, LLM Orchestration architecture (inspection only)
// ───────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<"READY" | "PENDING" | "MISSING", string> = {
  READY: "bg-success/15 text-success border-success/30",
  PENDING: "bg-warning/15 text-warning border-warning/30",
  MISSING: "bg-destructive/15 text-destructive border-destructive/30",
};

function OrchestrationCenter({ status }: { status: ReturnType<typeof orchestrationStatus> }) {
  return (
    <Section icon={<Workflow className="h-4 w-4" />} label="11" title="LLM Orchestration Center" subtitle="The pipeline ExecutiveOS uses to talk to Gemini. Every stage is wired, inspectable, and runs on each live debate.">
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {status.map((s) => (
          <div key={s.key} className="executive-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">{s.label}</p>
              <Badge variant="outline" className={STATUS_TONE[s.status]}>{s.status}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{s.detail}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CollapsibleCard({ title, subtitle, body, icon }: { title: string; subtitle?: string; body: string; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="executive-card rounded-xl">
        <CollapsibleTrigger className="w-full flex items-center justify-between p-4 text-left">
          <div className="flex items-center gap-3">
            {icon ?? <Code2 className="h-4 w-4 text-secondary" />}
            <div>
              <p className="text-sm font-medium">{title}</p>
              {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/40 p-4">
            <pre className="text-[11px] leading-relaxed text-muted-foreground bg-background/40 rounded-lg p-4 max-h-[380px] overflow-auto whitespace-pre-wrap">{body}</pre>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PromptBuilderInspector({ bundle }: { bundle: ExecutivePromptBundle }) {
  return (
    <Section icon={<Terminal className="h-4 w-4" />} label="12" title="Executive Prompt Builder" subtitle="The exact prompt and context payload sent to Gemini on each live debate. Shown here for inspection.">
      <div className="grid lg:grid-cols-3 gap-3">
        <CollapsibleCard title="SYSTEM PROMPT" subtitle={`${bundle.systemPrompt.length} chars`} body={bundle.systemPrompt} />
        <CollapsibleCard title="USER PROMPT" subtitle={`${bundle.userPrompt.split("\n").length} lines`} body={bundle.userPrompt} />
        <CollapsibleCard title="CONTEXT PAYLOAD" subtitle="Structured briefing object" body={JSON.stringify(bundle.contextPayload, null, 2)} />
      </div>
    </Section>
  );
}

function AgentPromptGeneration({ prompts }: { prompts: AgentPromptObject[] }) {
  return (
    <Section icon={<Layers className="h-4 w-4" />} label="13" title="Agent Prompt Generation" subtitle="Per-agent prompt objects produced for every persona and sent to Gemini during a live debate.">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {prompts.map((p) => (
          <div key={p.role} className="executive-card rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 p-4 border-b border-border/40">
              <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${AGENT_CHIPS[p.role]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>{p.role}</div>
              <div>
                <p className="font-display text-sm">{p.title}</p>
                <p className="text-[10px] text-muted-foreground">{p.decisionStyle} · {p.historicalContext.length} prior refs</p>
              </div>
            </div>
            <pre className="text-[10px] leading-relaxed text-muted-foreground bg-background/40 p-4 max-h-[280px] overflow-auto whitespace-pre-wrap">{JSON.stringify(p, null, 2)}</pre>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AgentContractsPanel() {
  const contracts = useMemo(() => listAgentContracts(), []);
  const validations = useMemo(() => validateAllContracts(), []);
  return (
    <Section icon={<ShieldCheck className="h-4 w-4" />} label="13.5" title="Agent Contracts" subtitle="Production-grade reasoning contracts. Each persona binds decision rules, must-consider fields, allowed stances, and a strict response schema enforced on every Gemini response.">
      <div className="grid lg:grid-cols-3 gap-2 mb-4">
        <div className="executive-card-elevated rounded-xl p-4 lg:col-span-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Contract Completeness</p>
          <div className="space-y-1.5">
            {validations.map((v) => (
              <div key={v.agent} className="flex items-center justify-between text-xs">
                <span className="font-medium">{v.agent}</span>
                <Badge variant="outline" className={v.complete ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}>
                  {v.complete ? "✓ Complete" : "Incomplete"}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Validates: role · goals · metrics · decisionRules · mustConsider · allowedStances · outputInstructions · expectedSchema.
          </p>
        </div>
        <div className="executive-card rounded-xl p-4 lg:col-span-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Stance Framework</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(["Support", "Conditional", "Neutral", "Oppose"] as const).map((s) => (
              <div key={s} className="rounded-lg border border-border/40 p-2">
                <p className="text-xs font-semibold">{s}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {s === "Support" && "High conviction and recommendation to proceed."}
                  {s === "Conditional" && "Proceed only if specified guardrails exist."}
                  {s === "Neutral" && "Insufficient evidence or balanced tradeoffs."}
                  {s === "Oppose" && "Material concerns outweigh expected upside."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {contracts.map((c) => (
          <AgentContractCard key={c.agent} contract={c} />
        ))}
      </div>
    </Section>
  );
}

function AgentContractCard({ contract }: { contract: AgentContract }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="executive-card rounded-xl overflow-hidden">
      <CollapsibleTrigger className="w-full flex items-center gap-3 p-4 text-left">
        <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${AGENT_CHIPS[contract.agent]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>{contract.agent}</div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm">{contract.persona.title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{contract.role}</p>
        </div>
        <Badge variant="outline" className="bg-success/15 text-success border-success/30">READY</Badge>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/40 p-4 space-y-3 text-xs">
          <ContractField label="Role">{contract.role}</ContractField>
          <ContractField label="Decision Style">{contract.decisionStyle}</ContractField>
          <ContractList label="Goals" items={contract.goals} />
          <ContractList label="Metrics" items={contract.metrics} />
          <ContractList label="Decision Rules" items={contract.decisionRules} />
          <ContractList label="Must Consider" items={contract.mustConsider} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Allowed Stances</p>
            <div className="flex flex-wrap gap-1.5">
              {contract.allowedStances.map((s) => (
                <Badge key={s} variant="outline" className="bg-muted/30 text-foreground border-border/60">{s}</Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Stance Rules</p>
            <div className="space-y-1">
              {contract.allowedStances.map((s) => (
                <p key={s} className="text-[11px] leading-relaxed"><span className="font-semibold">{s}:</span> <span className="text-muted-foreground">{contract.stanceRules[s]}</span></p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Output Instructions</p>
            <pre className="text-[10px] leading-relaxed bg-background/40 rounded-md p-2 overflow-auto">{JSON.stringify(contract.outputInstructions, null, 2)}</pre>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Expected Schema</p>
            <pre className="text-[10px] leading-relaxed bg-background/40 rounded-md p-2 max-h-[220px] overflow-auto">{JSON.stringify(contract.expectedSchema, null, 2)}</pre>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ContractField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-xs">{children}</p>
    </div>
  );
}

function ContractList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">{label}</p>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it} className="text-[11px] leading-relaxed flex gap-1.5"><span className="text-muted-foreground">•</span>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function statusBadgeClass(status: string) {
  if (status === "Completed") return "bg-success/15 text-success border-success/30";
  if (status === "Running") return "bg-primary/15 text-primary border-primary/30";
  if (status === "Failed") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted/30 text-muted-foreground border-border/60";
}

type CeoExecutionState = {
  state: "idle" | "running" | "completed" | "failed";
  result?: ExecuteCEOResult;
  startedAt?: number;
  durationMs?: number;
};

function AgentExecutionPanel({
  results,
  pipeline,
  ceoExecution,
  geminiStatus,
}: {
  results: AgentExecutionResult[];
  pipeline: PipelineResult | null;
  ceoExecution: CeoExecutionState;
  geminiStatus: { connected: boolean; model: string } | null;
}) {
  const ceoLive = ceoExecution.result && ceoExecution.result.ok ? ceoExecution.result : null;
  const ceoError = ceoExecution.result && !ceoExecution.result.ok ? ceoExecution.result.error : null;
  return (
    <Section
      icon={<Bot className="h-4 w-4" />}
      label="14"
      title="Agent Execution Layer"
      subtitle="Phase 10 · CEO agent executes against Gemini 2.5 Flash. Remaining agents run on the local heuristic engine until they are upgraded."
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge variant="outline" className="bg-success/15 text-success border-success/30">EXECUTION READY</Badge>
        <Badge
          variant="outline"
          className={
            geminiStatus?.connected
              ? "bg-success/15 text-success border-success/30"
              : "bg-destructive/15 text-destructive border-destructive/30"
          }
        >
          CEO · Gemini {geminiStatus?.connected ? "Connected" : "Not Connected"}
        </Badge>
        {ceoExecution.state === "running" && (
          <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30">CEO Executing…</Badge>
        )}
        {ceoLive && (
          <Badge variant="outline" className="bg-muted/30 text-muted-foreground border-border/60">
            CEO {ceoLive.meta.durationMs}ms · {ceoLive.meta.totalTokens || ceoLive.meta.promptTokens + ceoLive.meta.responseTokens} tok
          </Badge>
        )}
        {pipeline?.providerUsage.map((p) => (
          <Badge key={p.provider} variant="outline" className="bg-muted/30 text-muted-foreground border-border/60">
            {p.provider} × {p.count}
          </Badge>
        ))}
        {pipeline && (
          <Badge variant="outline" className="bg-muted/30 text-muted-foreground border-border/60">
            Total {pipeline.totalDurationMs}ms
          </Badge>
        )}
      </div>
      {ceoError && (
        <div className="executive-card rounded-xl p-3 mb-3 border border-destructive/40">
          <p className="text-[10px] uppercase tracking-[0.18em] text-destructive">CEO Execution Failed · {ceoError.code}</p>
          <p className="text-xs text-foreground mt-1">{ceoError.message}</p>
          {ceoError.issues && ceoError.issues.length > 0 && (
            <ul className="mt-1 text-[11px] text-destructive list-disc list-inside">
              {ceoError.issues.map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
          )}
        </div>
      )}
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">Pipeline initializing…</p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {results.map((r) => {
            const e = r.envelope;
            const agent = r.status.agent as keyof typeof AGENT_CHIPS;
            const isCeo = r.status.agent === "CEO";
            const isRealCeo = isCeo && !!ceoLive;
            return (
              <div key={r.status.agent} className={`executive-card rounded-xl p-4 space-y-2 ${isRealCeo ? "ring-1 ring-success/40" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${AGENT_CHIPS[agent]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>
                      {r.status.agent}
                    </div>
                    <p className="font-display text-sm">{r.status.agent}</p>
                    {isRealCeo && (
                      <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[9px]">LIVE · Gemini</Badge>
                    )}
                  </div>
                  <Badge variant="outline" className={statusBadgeClass(r.status.status)}>{r.status.status}</Badge>
                </div>
                {e ? (
                  <>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Observation</p>
                      <p className="text-xs leading-relaxed line-clamp-3">{e.observation}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Insight</p>
                      <p className="text-xs leading-relaxed line-clamp-3">{e.insight}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Recommendation</p>
                      <p className="text-xs leading-relaxed line-clamp-3">{e.recommendation}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Rationale</p>
                      <p className="text-xs leading-relaxed line-clamp-3">{e.rationale}</p>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/40">
                      <span>{e.stance} · {e.support}% support · {e.confidence}% conf</span>
                      <span>{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
                    </div>
                    {isRealCeo && ceoLive.response.referencedData.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        <span className="text-foreground">Cited:</span> {ceoLive.response.referencedData.join(", ")}
                      </p>
                    )}
                    {isRealCeo && ceoLive.response.referencedDecisions.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        <span className="text-foreground">Prior decisions:</span> {ceoLive.response.referencedDecisions.join(", ")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-destructive">{r.status.error ?? "No validated envelope"}</p>
                )}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{r.status.provider}</span>
                  <span>{r.status.durationMs}ms · ~{r.promptTokens + r.responseTokens} tok</span>
                </div>
                {r.status.fellBackToHeuristic && (
                  <p className="text-[10px] text-warning">Primary provider unavailable, fell back to local heuristic adapter.</p>
                )}
                {r.validationErrors.length > 0 && (
                  <p className="text-[10px] text-destructive">Schema errors: {r.validationErrors.join("; ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ExecutionTimelinePanel({
  stages,
  pipeline,
  ceoExecution,
}: {
  stages: ExecutionStage[];
  pipeline: PipelineResult | null;
  ceoExecution: CeoExecutionState;
}) {
  const ceoStages: ExecutionStage[] = [
    {
      key: "ceo-executed",
      label: "CEO Executed (Gemini)",
      status:
        ceoExecution.state === "running" ? "Running" :
        ceoExecution.state === "completed" ? "Completed" :
        ceoExecution.state === "failed" ? "Failed" : "Queued",
      detail:
        ceoExecution.result && ceoExecution.result.ok
          ? `Model ${ceoExecution.result.meta.model} · ${ceoExecution.result.meta.totalTokens || ceoExecution.result.meta.promptTokens + ceoExecution.result.meta.responseTokens} tokens`
          : ceoExecution.result && !ceoExecution.result.ok
            ? `Failed · ${ceoExecution.result.error.code}: ${ceoExecution.result.error.message}`
            : ceoExecution.state === "running"
              ? "Dispatching CEO prompt to Gemini 2.5 Flash…"
              : "Waiting for context + prompts.",
      durationMs: ceoExecution.durationMs ?? null,
      startedAt: ceoExecution.startedAt ? new Date(ceoExecution.startedAt).toISOString() : null,
      completedAt: ceoExecution.state === "completed" || ceoExecution.state === "failed" ? new Date().toISOString() : null,
      error: ceoExecution.result && !ceoExecution.result.ok ? ceoExecution.result.error.message : undefined,
    },
    {
      key: "ceo-validated",
      label: "CEO Response Validated",
      status:
        ceoExecution.result && ceoExecution.result.ok ? "Completed" :
        ceoExecution.result && !ceoExecution.result.ok ? "Failed" :
        ceoExecution.state === "running" ? "Queued" : "Queued",
      detail:
        ceoExecution.result && ceoExecution.result.ok
          ? `Schema OK · stance ${ceoExecution.result.response.stance} · confidence ${ceoExecution.result.response.confidence}%`
          : ceoExecution.result && !ceoExecution.result.ok
            ? `Validation blocked · ${ceoExecution.result.error.code}`
            : "Awaiting Gemini response.",
      durationMs: null,
      startedAt: null,
      completedAt: ceoExecution.result ? new Date().toISOString() : null,
      error: undefined,
    },
  ];
  const allStages = [...stages, ...ceoStages];
  return (
    <Section
      icon={<Workflow className="h-4 w-4" />}
      label="14.5"
      title="Execution Timeline"
      subtitle="Phase 10 · Live trace including the real Gemini-powered CEO execution stage."
    >
      {allStages.length === 0 ? (
        <p className="text-xs text-muted-foreground">Awaiting first run…</p>
      ) : (
        <ol className="space-y-2">
          {allStages.map((s, idx) => (
            <li key={s.key} className="executive-card rounded-xl p-3 flex items-center gap-3">
              <div className="h-7 w-7 rounded-full bg-background border border-border/60 grid place-items-center text-[11px] font-display text-muted-foreground">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{s.label}</p>
                  <Badge variant="outline" className={statusBadgeClass(s.status)}>{s.status}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{s.detail}</p>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                {s.durationMs !== null ? `${s.durationMs}ms` : "-"}
              </span>
            </li>
          ))}
        </ol>
      )}
      {pipeline && (
        <p className="text-[10px] text-muted-foreground mt-3">
          Completed at {new Date(pipeline.completedAt).toLocaleTimeString()} · total {pipeline.totalDurationMs}ms
        </p>
      )}
    </Section>
  );
}

function BoardSynthesisPanel({ results, decision }: { results: AgentExecutionResult[]; decision: FinalBoardDecision | null }) {
  return (
    <Section
      icon={<GitMerge className="h-4 w-4" />}
      label="15"
      title="Board Synthesis"
      subtitle="Phase 9 · BoardSynthesizer combines validated agent envelopes into a single Board Decision with stance distribution, conflicts, and risk override."
    >
      {!decision ? (
        <p className="text-xs text-muted-foreground">Synthesis pending, awaiting agent execution.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="executive-card rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-3">Inputs · Validated agent envelopes</p>
            <ul className="space-y-2">
              {results.map((r) => {
                const e = r.envelope;
                if (!e) return null;
                return (
                  <li key={r.status.agent} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                      e.stance === "Support" ? "bg-success" :
                      e.stance === "Conditional" ? "bg-warning" :
                      e.stance === "Oppose" ? "bg-destructive" : "bg-muted-foreground/60"
                    }`} />
                    <div>
                      <span className="font-medium">{e.role}</span>
                      <span className="text-muted-foreground"> · {e.stance} · {e.support}% support</span>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{e.recommendation}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="executive-card-elevated rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Final Board Decision</p>
              <Badge variant="outline" className="bg-success/15 text-success border-success/30">{decision.source}</Badge>
            </div>
            <p className="font-display text-base leading-snug">{decision.recommendedAction}</p>
            <p className="text-[11px] text-muted-foreground mt-2">{decision.synthesisSummary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Risk</p>
                <p className="text-foreground">{decision.riskLevel}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Weighted Consensus</p>
                <p className="text-foreground">{decision.weightedConsensus}/100</p>
              </div>
              <div className="rounded-lg border border-border/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Strategic Alignment</p>
                <p className="text-foreground">{decision.strategicAlignment}/100</p>
              </div>
              <div className="rounded-lg border border-border/60 p-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Conflicts</p>
                <p className="text-foreground">{decision.conflicts.length}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {decision.stanceDistribution.filter((s) => s.agents.length).map((s) => (
                <div key={s.stance} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{s.stance}</span> · {s.agents.join(", ")} · {s.weight}% weight
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function ProviderReadinessPanel({
  readiness,
  geminiStatus,
}: {
  readiness: ReturnType<typeof providerReadiness>;
  geminiStatus: { connected: boolean; model: string } | null;
}) {
  const flags: Array<{ label: string; on: boolean }> = [
    { label: "Provider Interface Ready", on: readiness.providerInterfaceReady },
    { label: "Model Routing Ready", on: readiness.modelRoutingReady },
    { label: "Prompt Architecture Ready", on: readiness.promptArchitectureReady },
    { label: "Gemini Connected", on: !!geminiStatus?.connected },
  ];
  return (
    <Section icon={<Plug className="h-4 w-4" />} label="16" title="Provider Readiness" subtitle="The LLM provider ExecutiveOS runs against. The board agents execute against Gemini in real time via the server-side GEMINI_API_KEY.">
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        {PROVIDERS.map((p) => {
          const isGemini = p.id === "gemini";
          const connected = isGemini ? !!geminiStatus?.connected : p.connected;
          const model = isGemini && geminiStatus ? geminiStatus.model : p.defaultModel;
          const notes = isGemini
            ? connected
              ? "Live · executing real CEO agent via server-side GEMINI_API_KEY."
              : "GEMINI_API_KEY not configured on the server. CEO falls back to local heuristic engine."
            : p.notes;
          return (
            <div key={p.id} className="executive-card rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="font-display text-sm">{p.label}</p>
                <Badge variant="outline" className={connected ? "bg-success/15 text-success border-success/30" : "bg-destructive/15 text-destructive border-destructive/30"}>
                  {connected ? "Connected" : "Not Connected"}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{p.vendor} · {model}</p>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{notes}</p>
            </div>
          );
        })}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {flags.map((f) => {
          const positive = f.label === "API Keys Required" ? !f.on : f.on;
          const valueLabel = f.label === "API Keys Required" ? (f.on ? "YES" : "NO") : (f.on ? "YES" : "NO");
          return (
            <div key={f.label} className="executive-card rounded-xl p-3 flex items-center justify-between">
              <p className="text-xs">{f.label}</p>
              <Badge variant="outline" className={positive ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}>
                {valueLabel}
              </Badge>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ───────────────────────────────────────────────────────────────────
// PHASE 8, Executive Intelligence Engine (Section 18)
// ───────────────────────────────────────────────────────────────────

function IntelligenceEngine({
  briefings, alignments, tensions, weighted, quality, influence,
}: {
  briefings: AgentBriefing[];
  alignments: AgentAlignment[];
  tensions: StrategicTension[];
  weighted: WeightedConsensus;
  quality: DecisionQuality;
  influence: AgentInfluence[];
}) {
  return (
    <Section icon={<Zap className="h-4 w-4" />} label="18" title="Executive Intelligence Engine" subtitle="Phase 8 · Strategic tensions, weighted consensus, decision quality, agent influence, and role-filtered briefings.">
      {/* Decision Quality headline */}
      <div className="executive-card-elevated rounded-xl p-6 mb-4">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="flex flex-col items-center">
            <ScoreRing
              value={quality.score}
              label="Decision Quality"
              size={150}
              tone={quality.score >= 75 ? "success" : quality.score >= 55 ? "warning" : "destructive"}
            />
            <Badge variant="outline" className={`mt-3 ${
              quality.band === "Strong" ? "bg-success/15 text-success border-success/30" :
              quality.band === "Acceptable" ? "bg-warning/15 text-warning border-warning/30" :
              "bg-destructive/15 text-destructive border-destructive/30"
            }`}>{quality.band}</Badge>
          </div>
          <div className="lg:col-span-2 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.22em] text-secondary mb-2">Composite Inputs</p>
            {([
              { k: "Consensus (weighted)", v: quality.inputs.consensus, w: "30%" },
              { k: "Strategic Alignment", v: quality.inputs.strategicAlignment, w: "25%" },
              { k: "Execution Readiness", v: quality.inputs.executionReadiness, w: "20%" },
              { k: "Risk Exposure (inv.)", v: quality.inputs.riskExposure, w: "15%" },
              { k: "Forecast Confidence", v: quality.inputs.forecastConfidence, w: "10%" },
            ]).map((row) => (
              <div key={row.k}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{row.k} <span className="text-[10px]">· {row.w}</span></span>
                  <span className="font-medium">{row.v}/100</span>
                </div>
                <Progress value={row.v} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Strategic Tensions + Weighted Consensus */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="executive-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="h-4 w-4 text-secondary" />
            <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Strategic Tensions</p>
          </div>
          {tensions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Board is aligned, no significant disagreements between roles.</p>
          ) : (
            <div className="space-y-2">
              {tensions.map((t) => (
                <div key={t.id} className="rounded-lg border border-border/60 p-3 bg-background/30">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t.label}</p>
                    <Badge variant="outline" className={t.severity >= 60 ? "bg-destructive/15 text-destructive border-destructive/30" : t.severity >= 35 ? "bg-warning/15 text-warning border-warning/30" : "bg-muted/30 text-muted-foreground border-border/60"}>
                      Severity {t.severity}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{t.detail}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-background overflow-hidden">
                    <div className="h-full bg-destructive" style={{ width: `${t.severity}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="executive-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="h-4 w-4 text-secondary" />
            <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Weighted Consensus</p>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="font-display text-3xl">{weighted.score}<span className="text-base text-muted-foreground">/100</span></span>
            <span className="text-[11px] text-muted-foreground">CEO 25% · CFO 20% · COO/CMO 15% · Risk/Forecast 10% · Consultant 5%</span>
          </div>
          <div className="space-y-1.5">
            {weighted.contributions.map((c) => (
              <div key={c.agent} className="grid grid-cols-[60px_1fr_auto] items-center gap-2 text-[11px]">
                <span className="font-medium">{c.agent}</span>
                <div className="h-1.5 rounded-full bg-background overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${c.support}%` }} />
                </div>
                <span className="text-muted-foreground tabular-nums">{c.support}% × {(c.weight * 100).toFixed(0)}% = {c.contribution.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Σ(support × weight) ÷ Σ(weights) = {weighted.score}. Replaces equal voting so executive seniority shapes the headline number.
          </p>
        </div>
      </div>

      {/* Role Alignment Scores */}
      <div className="executive-card rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-secondary" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Role Alignment Scores</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
          {alignments.map((a) => (
            <div key={a.agent} className="rounded-lg border border-border/60 p-3 bg-background/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">{a.agent}</span>
                <span className={`text-sm font-display ${a.score >= 70 ? "text-success" : a.score >= 50 ? "text-warning" : "text-destructive"}`}>{a.score}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                <div className="text-center"><div className="text-foreground">{a.strategic}</div>Strat</div>
                <div className="text-center"><div className="text-foreground">{a.role}</div>Role</div>
                <div className="text-center"><div className="text-foreground">{a.goal}</div>Goal</div>
                <div className="text-center"><div className="text-foreground">{a.risk}</div>Risk</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Influence */}
      <div className="executive-card rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Award className="h-4 w-4 text-secondary" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Agent Influence · Historical Accuracy</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
          {influence.map((inf) => (
            <div key={inf.agent} className="rounded-lg border border-border/60 p-3 bg-background/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">{inf.agent} Accuracy</span>
                <span className={`text-sm font-display ${inf.accuracy >= 70 ? "text-success" : inf.accuracy >= 55 ? "text-warning" : "text-destructive"}`}>{inf.accuracy}%</span>
              </div>
              <Progress value={inf.accuracy} />
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{inf.notes}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{inf.decisionsConsidered} matched · {inf.completedShare}% completed</p>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Context Preview · role-specific briefings */}
      <div className="executive-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-secondary" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-secondary">Agent Context Preview · Role-Specific Briefings</p>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">Each agent receives only the slice of context its role needs. Consultant alone receives the full briefing.</p>
        <div className="space-y-2">
          {briefings.map((b) => (
            <BriefingRow key={b.agent} briefing={b} />
          ))}
        </div>
      </div>
    </Section>
  );
}

function BriefingRow({ briefing }: { briefing: AgentBriefing }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/60 bg-background/30">
      <CollapsibleTrigger className="w-full flex items-center gap-3 p-3 text-left">
        <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${AGENT_CHIPS[briefing.agent]} grid place-items-center text-primary-foreground text-[10px] font-bold`}>{briefing.agent}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">{briefing.agent} · {briefing.focus}</p>
          <p className="text-[10px] text-muted-foreground truncate">{briefing.sections.join(" · ")}</p>
        </div>
        <Badge variant="outline" className="bg-muted/30 text-muted-foreground border-border/60">{briefing.sections.length} sections</Badge>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/40 p-3">
          <pre className="text-[10px] leading-relaxed text-muted-foreground bg-background/40 rounded-md p-3 max-h-[280px] overflow-auto whitespace-pre">{JSON.stringify(briefing.data, null, 2)}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
