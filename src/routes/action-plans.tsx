import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Check,
  Plus,
  AlertTriangle,
  Gauge,
  Trash2,
  ArrowRight,
} from "lucide-react";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScoreRing } from "@/components/score-ring";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { z } from "zod";
import { callBrain, buildAdvisorPrompt } from "@/lib/ai/brain";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import {
  computeBusinessIntelligence,
  formatMoney as fmtMoney,
  formatPct as fmtPct,
} from "@/lib/api/intelligence";
import {
  deriveInitiatives,
  deriveKpiTargets,
  strategyHealth,
  buildAgentConsensus,
  type MissionKpiTarget,
} from "@/lib/api/mission";
import {
  latestCeoBrief,
  latestConsultantReport,
  listActionPlans,
  listBoardroom,
  upsertActionPlan,
} from "@/lib/api/persistence";
import type { ActionPlan } from "@/lib/api/types";

export const Route = createFileRoute("/action-plans")({
  head: () => ({ meta: [{ title: "Execution Center, ExecutiveOS" }] }),
  component: ExecutionCenterPage,
});

// ----- Extended initiative shape (persisted inside ActionPlan.initiatives JSONB)
type ExecStatus = "Planned" | "In Progress" | "Blocked" | "Completed";
type ExecPriority = "Critical" | "High" | "Medium" | "Low";
type ExecRisk = "Low" | "Medium" | "High";
type ExecSource = "CEO Brief" | "Consultant" | "Mission" | "Boardroom" | "Manual";

interface Milestone {
  id: string;
  title: string;
  done: boolean;
}

interface ExecInitiative {
  id: string;
  title: string;
  description: string;
  objective: string;
  owner: string;
  source: ExecSource;
  status: ExecStatus;
  priority: ExecPriority;
  progress: number; // 0-100
  dueDays: number; // 30/45/60/90
  dueDate: string; // ISO
  revenueImpact: number;
  profitImpact: number;
  confidence: number;
  risk: ExecRisk;
  milestones: Milestone[];
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const statusTone: Record<ExecStatus, string> = {
  Planned: "bg-secondary/20 text-secondary border-secondary/30",
  "In Progress": "bg-warning/15 text-warning border-warning/30",
  Blocked: "bg-destructive/15 text-destructive border-destructive/30",
  Completed: "bg-success/15 text-success border-success/30",
};

const priorityTone: Record<ExecPriority, string> = {
  Critical: "bg-destructive/15 text-destructive border-destructive/30",
  High: "bg-warning/15 text-warning border-warning/30",
  Medium: "bg-secondary/20 text-secondary border-secondary/30",
  Low: "bg-muted text-muted-foreground border-border/60",
};

const riskTone: Record<ExecRisk, string> = {
  Low: "bg-success/15 text-success",
  Medium: "bg-warning/15 text-warning",
  High: "bg-destructive/15 text-destructive",
};

const DEFAULT_MILESTONES = (): Milestone[] => [
  { id: uid(), title: "Budget Approved", done: false },
  { id: uid(), title: "Hiring Complete", done: false },
  { id: uid(), title: "Launch Complete", done: false },
  { id: uid(), title: "KPI Target Reached", done: false },
];

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "-";
  }
}

function progressFromMilestones(m: Milestone[]) {
  if (!m.length) return 0;
  return Math.round((m.filter((x) => x.done).length / m.length) * 100);
}

function ExecutionCenterPage() {
  const qc = useQueryClient();
  const { activeDatasetId } = useActiveDataset();

  // --- Dataset intelligence
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
  const intel = useMemo(() => {
    if (!dataset || !rows.length) return null;
    const kpis = computeKpis(rows, dataset.schema);
    return { kpis, bi: computeBusinessIntelligence(rows, dataset.schema, kpis) };
  }, [dataset, rows]);

  // --- Upstream outputs
  const { data: brief } = useQuery({
    queryKey: ["ceo-brief", activeDatasetId],
    queryFn: () => (activeDatasetId ? latestCeoBrief(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });
  const { data: report } = useQuery({
    queryKey: ["consultant", activeDatasetId],
    queryFn: () => (activeDatasetId ? latestConsultantReport(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });
  const { data: boardroom = [] } = useQuery({
    queryKey: ["boardroom", activeDatasetId],
    queryFn: () => listBoardroom(activeDatasetId ?? null),
    enabled: !!activeDatasetId,
  });

  // --- Persisted plan (single canonical record, horizon = 90)
  const { data: plans = [] } = useQuery({
    queryKey: ["exec-plans", activeDatasetId],
    queryFn: () => listActionPlans(activeDatasetId),
    enabled: !!activeDatasetId,
  });
  const plan = plans.find((p) => p.horizon_days === 90) ?? plans[0];

  const [initiatives, setInitiatives] = useState<ExecInitiative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!plan) {
      setInitiatives([]);
      return;
    }
    const list = (plan.initiatives as unknown as ExecInitiative[]) ?? [];
    // legacy fallback: hydrate missing fields if a previous plan format exists
    setInitiatives(
      list.map((i) => ({
        ...i,
        milestones: i.milestones?.length ? i.milestones : DEFAULT_MILESTONES(),
        objective: i.objective ?? i.description ?? "",
        priority: i.priority ?? "Medium",
        risk: i.risk ?? "Medium",
        status: i.status ?? "Planned",
        source: i.source ?? "Manual",
        revenueImpact: i.revenueImpact ?? 0,
        profitImpact: i.profitImpact ?? 0,
        confidence: i.confidence ?? 60,
        dueDays: i.dueDays ?? 60,
        dueDate: i.dueDate ?? daysFromNow(i.dueDays ?? 60),
      })),
    );
  }, [plan]);

  const selected = initiatives.find((i) => i.id === selectedId) ?? null;

  // --- Persistence
  async function persist(next: ExecInitiative[], toastMsg?: string) {
    setInitiatives(next);
    const progress = next.length
      ? Math.round(next.reduce((s, i) => s + i.progress, 0) / next.length)
      : 0;
    await upsertActionPlan({
      id: plan?.id,
      dataset_id: activeDatasetId,
      horizon_days: 90,
      initiatives: next as unknown as never,
      progress,
    } as Omit<ActionPlan, "id" | "created_at" | "updated_at"> & { id?: string });
    await qc.invalidateQueries({ queryKey: ["exec-plans", activeDatasetId] });
    if (toastMsg) toast.success(toastMsg);
  }

  function updateOne(id: string, patch: Partial<ExecInitiative>, msg?: string) {
    const next = initiatives.map((i) => (i.id === id ? { ...i, ...patch } : i));
    persist(next, msg);
  }
  function removeOne(id: string) {
    persist(initiatives.filter((i) => i.id !== id), "Initiative removed");
    setSelectedId(null);
  }
  function addInitiative(init: ExecInitiative) {
    persist([init, ...initiatives], "Initiative added");
  }

  // --- Generate initiatives from upstream outputs
  async function generateFromOutputs() {
    if (!activeDatasetId) {
      toast.error("Select a dataset first");
      return;
    }
    const bi = intel?.bi ?? null;
    const generated: ExecInitiative[] = [];

    // From Mission Control
    deriveInitiatives(bi).forEach((m) => {
      generated.push({
        id: uid(),
        title: m.title,
        description: m.rationale,
        objective: m.rationale,
        owner: m.owner,
        source: "Mission",
        status: "Planned",
        priority: m.priority,
        progress: 0,
        dueDays: m.timelineDays,
        dueDate: daysFromNow(m.timelineDays),
        revenueImpact: m.revenueImpact,
        profitImpact: m.profitImpact,
        confidence: m.confidence,
        risk: m.effort >= 70 ? "High" : m.effort >= 40 ? "Medium" : "Low",
        milestones: DEFAULT_MILESTONES(),
      });
    });

    // From CEO Brief priorities
    (brief?.priorities ?? []).forEach((p) => {
      generated.push({
        id: uid(),
        title: p.title,
        description: `Priority surfaced by CEO Brief, owner ${p.owner}.`,
        objective: p.title,
        owner: p.owner || "CEO",
        source: "CEO Brief",
        status: "Planned",
        priority: "High",
        progress: 0,
        dueDays: 30,
        dueDate: p.due ?? daysFromNow(30),
        revenueImpact: bi?.upsideBandPct ? bi.totalRevenue * (bi.upsideBandPct.low / 100) : 0,
        profitImpact: bi?.upsideBandPct ? bi.totalProfit * (bi.upsideBandPct.low / 100) : 0,
        confidence: 72,
        risk: "Medium",
        milestones: DEFAULT_MILESTONES(),
      });
    });

    // From Consultant Report recommendations
    (report?.recommendations ?? []).forEach((r) => {
      const rev = parseFirstNumber(r.expected_revenue_impact) ?? (bi?.upsideBandPct ? bi.totalRevenue * (bi.upsideBandPct.low / 100) : 0);
      generated.push({
        id: uid(),
        title: r.title,
        description: r.description,
        objective: r.description,
        owner: r.owner || "Consultant",
        source: "Consultant",
        status: "Planned",
        priority: r.impact >= 75 ? "Critical" : r.impact >= 55 ? "High" : "Medium",
        progress: 0,
        dueDays: r.timeframe?.toLowerCase().includes("30") ? 30 : r.timeframe?.toLowerCase().includes("60") ? 60 : 90,
        dueDate: daysFromNow(r.timeframe?.toLowerCase().includes("30") ? 30 : r.timeframe?.toLowerCase().includes("60") ? 60 : 90),
        revenueImpact: rev,
        profitImpact: rev * ((bi?.marginPct ?? 15) / 100),
        confidence: r.confidence,
        risk: (r.strategic_risk ?? 0) >= 60 ? "High" : (r.strategic_risk ?? 0) >= 30 ? "Medium" : "Low",
        milestones: DEFAULT_MILESTONES(),
      });
    });

    // From Boardroom, latest decision becomes an initiative
    if (boardroom.length) {
      const latest = boardroom[0];
      generated.push({
        id: uid(),
        title: `Boardroom: ${latest.topic}`,
        description: latest.messages[latest.messages.length - 1]?.content ?? "Board decision execution",
        objective: latest.topic,
        owner: "Executive Team",
        source: "Boardroom",
        status: "Planned",
        priority: "High",
        progress: 0,
        dueDays: 45,
        dueDate: daysFromNow(45),
        revenueImpact: bi?.upsideBandPct ? bi.totalRevenue * (bi.upsideBandPct.high / 100) : 0,
        profitImpact: bi?.upsideBandPct ? bi.totalProfit * (bi.upsideBandPct.high / 100) : 0,
        confidence: 70,
        risk: "Medium",
        milestones: DEFAULT_MILESTONES(),
      });
    }

    // Dedupe by lowercased title, preserve existing manual edits
    const existingTitles = new Set(initiatives.map((i) => i.title.toLowerCase()));
    const fresh = generated.filter((g) => !existingTitles.has(g.title.toLowerCase()));
    if (!fresh.length && !initiatives.length) {
      toast.message("No upstream initiatives found, generate CEO Brief / Consultant Report first.");
      return;
    }
    await persist([...fresh, ...initiatives], `${fresh.length} initiatives synced from strategy layer`);
  }

  // --- Aggregates
  const counts = useMemo(() => {
    const c = { active: 0, completed: 0, blocked: 0, planned: 0 };
    for (const i of initiatives) {
      if (i.status === "Completed") c.completed++;
      else if (i.status === "Blocked") c.blocked++;
      else if (i.status === "In Progress") c.active++;
      else c.planned++;
    }
    return c;
  }, [initiatives]);

  const kpiTargets = useMemo(
    () => deriveKpiTargets(intel?.bi ?? null, intel?.kpis ?? null),
    [intel],
  );
  const health = useMemo(
    () => strategyHealth(intel?.bi ?? null, intel?.kpis ?? null),
    [intel],
  );
  const consensus = useMemo(() => buildAgentConsensus(intel?.bi ?? null), [intel]);

  // Execution Score blends completion / kpi achievement / milestone / risk
  const executionScore = useMemo(() => {
    const completion = initiatives.length
      ? (initiatives.filter((i) => i.status === "Completed").length / initiatives.length) * 100
      : 0;
    const milestoneRate = initiatives.length
      ? (initiatives.reduce((s, i) => s + progressFromMilestones(i.milestones), 0) /
          initiatives.length)
      : 0;
    const kpiAch = kpiTargets.length
      ? (kpiTargets.reduce((s, k) => s + k.progress, 0) / kpiTargets.length)
      : 0;
    const blockedPenalty = initiatives.length
      ? (initiatives.filter((i) => i.status === "Blocked").length / initiatives.length) * 100
      : 0;
    const raw = completion * 0.3 + milestoneRate * 0.25 + kpiAch * 0.3 + (100 - blockedPenalty) * 0.15;
    return Math.round(Math.max(0, Math.min(100, raw)));
  }, [initiatives, kpiTargets]);

  const blockers = useMemo(() => buildBlockers(initiatives, intel?.bi ?? null), [initiatives, intel]);

  const aiAdvice = useMemo(
    () => buildAdvisor(initiatives, kpiTargets, intel?.bi ?? null, consensus.consensusRecommendation),
    [initiatives, kpiTargets, intel, consensus],
  );

  // AI Execution Advisor, real AWS Bedrock recommendations over live execution
  // state, falling back to the heuristic advisor above when unavailable.
  type AdvisorItem = { title: string; reasoning: string; confidence: number; revenueImpact?: number; profitImpact?: number };
  const [aiAdvisor, setAiAdvisor] = useState<AdvisorItem[] | null>(null);
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const advisorItems: AdvisorItem[] = aiAdvisor ?? aiAdvice;

  async function runAdvisor() {
    if (advisorBusy) return;
    setAdvisorBusy(true);
    setAdvisorError(null);
    const bi = intel?.bi ?? null;
    const summary = [
      bi ? `Business: revenue ${fmtMoney(bi.totalRevenue)}, margin ${fmtPct(bi.marginPct)}, growth ${fmtPct(bi.growthPct)}.` : "No dataset intelligence available.",
      `Initiatives (${initiatives.length}): ${initiatives.map((i) => `${i.title} [${i.status}, ${i.progress}%, owner ${i.owner}, ${i.risk} risk]`).join("; ") || "none"}`,
      `KPI targets: ${kpiTargets.map((k) => `${k.label} ${k.current}/${k.target} (${k.status})`).join("; ") || "none"}`,
      `Blockers: ${blockers.map((b) => `${b.title} [${b.severity}]`).join("; ") || "none"}`,
      `Boardroom consensus: ${consensus.consensusRecommendation}`,
    ].join("\n");
    const AdvisorAiSchema = z.object({
      advice: z.array(z.object({ title: z.string().min(1), reasoning: z.string().min(1), confidence: z.number() })).min(1),
    });
    const { system, user } = buildAdvisorPrompt(summary);
    const res = await callBrain({ section: "execution-advisor", system, user, json: true });
    if (res.ok && res.parsed) {
      const parsed = AdvisorAiSchema.safeParse(res.parsed);
      if (parsed.success) {
        setAiAdvisor(parsed.data.advice.slice(0, 4).map((a) => ({
          title: a.title,
          reasoning: a.reasoning,
          confidence: Math.max(0, Math.min(100, Math.round(a.confidence))),
        })));
        setAdvisorBusy(false);
        return;
      }
    }
    setAdvisorError(res.ok ? "AI advisor returned a malformed answer, showing built-in recommendations." : "AI advisor unavailable, showing built-in recommendations.");
    setAdvisorBusy(false);
  }

  const roadmap = useMemo(() => {
    const map: Record<30 | 45 | 60 | 90, ExecInitiative[]> = { 30: [], 45: [], 60: [], 90: [] };
    for (const i of initiatives) {
      const bucket = i.dueDays === 30 ? 30 : i.dueDays === 45 ? 45 : i.dueDays === 60 ? 60 : 90;
      map[bucket].push(i);
    }
    return map;
  }, [initiatives]);

  if (!activeDatasetId) {
    return (
      <>
        <PageHeader
          eyebrow="07, Execution Center"
          title="Execution Center"
          description="Convert strategy from CEO Brief, Consultant Report, Mission Control and AI Boardroom into tracked execution."
        />
        <EmptyState
          title="Select a dataset to begin"
          description="Upload a dataset on the Dashboard to activate execution tracking across the strategy layer."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="07, Execution Center"
        title="Execution Center"
        description="Where strategy becomes execution. Initiatives, milestones, KPIs and risk, synced from CEO Brief, Consultant, Mission Control and Boardroom."
        actions={
          <>
            <Button variant="outline" onClick={generateFromOutputs}>
              <Sparkles className="h-4 w-4 mr-2" />
              Sync from strategy
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New initiative
            </Button>
          </>
        }
      />

      {/* SECTION 01, Execution Overview */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <OverviewTile label="Active Initiatives" value={counts.active} icon={Gauge} tone="warning" />
        <OverviewTile label="Completed" value={counts.completed} icon={Check} tone="success" />
        <OverviewTile label="Blocked" value={counts.blocked} icon={AlertTriangle} tone="destructive" />
        <div className="executive-card rounded-xl p-5 flex items-center gap-5">
          <ScoreRing value={executionScore} label="Execution" tone={executionScore >= 70 ? "success" : executionScore >= 45 ? "warning" : "destructive"} size={100} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Execution Score</p>
            <p className="font-display text-2xl">{executionScore}/100</p>
            <p className="text-xs text-muted-foreground mt-1">Completion · KPIs · Milestones · Risk</p>
          </div>
        </div>
      </section>

      {initiatives.length === 0 ? (
        <EmptyState
          title="No initiatives yet"
          description="Click 'Sync from strategy' to pull initiatives from CEO Brief, Consultant Report, Mission Control and Boardroom."
        />
      ) : (
        <>
          {/* SECTION 02, Initiative Command Center */}
          <section className="executive-card-elevated rounded-xl p-6 mb-8">
            <SectionHeader eyebrow="02" title="Initiative Command Center" subtitle={`${initiatives.length} initiative${initiatives.length === 1 ? "" : "s"} under execution`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60">
                    <th className="py-2 pr-4">Initiative</th>
                    <th className="py-2 pr-4">Owner</th>
                    <th className="py-2 pr-4">Priority</th>
                    <th className="py-2 pr-4 w-40">Progress</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Due</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {initiatives.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-border/40 cursor-pointer hover:bg-card/40"
                      onClick={() => setSelectedId(i.id)}
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium">{i.title}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          {i.source}
                        </p>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{i.owner}</td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className={priorityTone[i.priority]}>{i.priority}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Progress value={i.progress} className="h-1.5" />
                          <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{i.progress}%</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Select
                          value={i.status}
                          onValueChange={(v) =>
                            updateOne(i.id, {
                              status: v as ExecStatus,
                              progress: v === "Completed" ? 100 : i.progress,
                            })
                          }
                        >
                          <SelectTrigger
                            className={`h-7 text-[10px] uppercase tracking-wider w-32 border ${statusTone[i.status]}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(["Planned", "In Progress", "Blocked", "Completed"] as ExecStatus[]).map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatDate(i.dueDate)}</td>
                      <td className="py-3 text-right">
                        <ArrowRight className="h-4 w-4 text-muted-foreground inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* SECTION 05, KPI Monitoring */}
          {kpiTargets.length > 0 && (
            <section className="mb-8">
              <SectionHeader eyebrow="05" title="KPI Monitoring Center" subtitle="Target tracking from the analytics layer" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {kpiTargets.map((k) => <KpiTrackCard key={k.key} k={k} />)}
              </div>
            </section>
          )}

          {/* SECTION 06, Execution Risk Center */}
          <section className="mb-8">
            <SectionHeader eyebrow="06" title="Execution Risk Center" subtitle="Active blockers ordered by severity" />
            {blockers.length === 0 ? (
              <div className="executive-card rounded-xl p-6 text-sm text-muted-foreground">
                No blockers detected. Mark an initiative as Blocked or raise a risk to populate this view.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {blockers.map((b, idx) => (
                  <div key={idx} className="executive-card rounded-xl p-5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{b.title}</p>
                      <Badge variant="outline" className={riskTone[b.severity]}>{b.severity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{b.mitigation}</p>
                    <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>Owner: <span className="text-foreground">{b.owner}</span></span>
                      <span>{b.impact}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 07, Executive Timeline */}
          <section className="executive-card-elevated rounded-xl p-6 mb-8">
            <SectionHeader eyebrow="07" title="Executive Timeline" subtitle="30 / 45 / 60 / 90 day execution windows" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {([30, 45, 60, 90] as const).map((d) => (
                <div key={d} className="bg-card/40 border border-border/60 rounded-lg p-4 min-h-32">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{d} Days</p>
                    <span className="text-xs text-muted-foreground">{roadmap[d].length}</span>
                  </div>
                  <div className="space-y-2">
                    {roadmap[d].length === 0 && (
                      <p className="text-xs text-muted-foreground">No initiatives in window.</p>
                    )}
                    {roadmap[d].map((i) => (
                      <button
                        key={i.id}
                        onClick={() => setSelectedId(i.id)}
                        className="w-full text-left rounded-md border border-border/60 bg-background/60 p-2.5 hover:border-primary/40 transition-colors"
                      >
                        <p className="text-sm font-medium leading-snug">{i.title}</p>
                        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                          <span>{i.owner}</span>
                          <span className="text-foreground">{fmtMoney(i.revenueImpact)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 08, AI Execution Advisor */}
          <section className="mb-8">
            <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
              <SectionHeader eyebrow="08" title="AI Execution Advisor" subtitle="Recommendations from active execution + KPI + risk signals" />
              <div className="flex items-center gap-3">
                {advisorBusy ? (
                  <span className="text-xs text-muted-foreground animate-pulse">Advisor reasoning…</span>
                ) : advisorError ? (
                  <span className="text-xs text-warning max-w-xs text-right">{advisorError}</span>
                ) : aiAdvisor ? (
                  <span className="text-xs text-success flex items-center gap-1"><Sparkles className="h-3 w-3" /> Live AI advice</span>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => void runAdvisor()} disabled={advisorBusy}>
                  <Sparkles className={`h-4 w-4 mr-2 ${advisorBusy ? "animate-pulse" : ""}`} />
                  {advisorBusy ? "Thinking…" : aiAdvisor ? "Refresh AI advice" : "Get AI advice"}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {advisorItems.map((a, idx) => (
                <div key={idx} className="executive-card rounded-xl p-5 transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium leading-snug">{a.title}</p>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                      {a.confidence}% conf
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.reasoning}</p>
                  {a.revenueImpact !== undefined && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <div>
                        <p>Revenue</p>
                        <p className="text-foreground font-display text-sm normal-case tracking-normal">{fmtMoney(a.revenueImpact)}</p>
                      </div>
                      <div>
                        <p>Profit</p>
                        <p className="text-foreground font-display text-sm normal-case tracking-normal">{fmtMoney(a.profitImpact ?? 0)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 09, Execution Health */}
          <section className="executive-card-elevated rounded-xl p-6 mb-8">
            <SectionHeader eyebrow="09" title="Executive Execution Health" subtitle="Composite readiness across execution, KPIs, risk and forecast" />
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
              <div className="md:col-span-1 flex justify-center">
                <ScoreRing
                  value={Math.round((executionScore + health.overall) / 2)}
                  label="Overall"
                  size={140}
                  tone="primary"
                />
              </div>
              <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <HealthTile label="Execution Readiness" value={health.executionReadiness} />
                <HealthTile label="Risk Exposure" value={100 - health.riskExposure} note={`${health.riskExposure}/100 risk`} />
                <HealthTile label="Forecast Strength" value={health.forecastStrength} />
                <HealthTile label="Operational Alignment" value={health.operationalAlignment} />
              </div>
            </div>
          </section>
        </>
      )}

      {/* SECTION 03+04, Detail Panel */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {selected.source} · {selected.priority}
                </p>
                <SheetTitle className="font-display text-2xl leading-tight">{selected.title}</SheetTitle>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Objective</p>
                  <p className="text-sm leading-relaxed">{selected.objective || selected.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <DetailStat label="Revenue Impact" value={fmtMoney(selected.revenueImpact)} />
                  <DetailStat label="Profit Impact" value={fmtMoney(selected.profitImpact)} />
                  <DetailStat label="Confidence" value={`${selected.confidence}/100`} />
                  <DetailStat label="Strategic Risk" value={selected.risk} tone={riskTone[selected.risk]} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Owner</p>
                    <Input
                      value={selected.owner}
                      onChange={(e) => updateOne(selected.id, { owner: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Due window</p>
                    <Select
                      value={String(selected.dueDays)}
                      onValueChange={(v) => {
                        const d = Number(v) as 30 | 45 | 60 | 90;
                        updateOne(selected.id, { dueDays: d, dueDate: daysFromNow(d) });
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[30, 45, 60, 90].map((d) => (
                          <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Milestones */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Milestones</p>
                    <button
                      onClick={() => {
                        const next = [...selected.milestones, { id: uid(), title: "New milestone", done: false }];
                        updateOne(selected.id, { milestones: next, progress: progressFromMilestones(next) });
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add milestone
                    </button>
                  </div>
                  <div className="space-y-2">
                    {selected.milestones.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2">
                        <button
                          aria-label="Toggle"
                          onClick={() => {
                            const next = selected.milestones.map((x) => x.id === m.id ? { ...x, done: !x.done } : x);
                            const prog = progressFromMilestones(next);
                            updateOne(selected.id, {
                              milestones: next,
                              progress: prog,
                              status: prog === 100 ? "Completed" : selected.status === "Planned" ? "In Progress" : selected.status,
                            });
                          }}
                          className={`h-5 w-5 rounded-full grid place-items-center border ${m.done ? "bg-success/20 border-success" : "border-border/60"}`}
                        >
                          {m.done && <Check className="h-3 w-3 text-success" />}
                        </button>
                        <Input
                          value={m.title}
                          onChange={(e) => {
                            const next = selected.milestones.map((x) => x.id === m.id ? { ...x, title: e.target.value } : x);
                            updateOne(selected.id, { milestones: next });
                          }}
                          className="border-none bg-transparent shadow-none h-7 px-1 focus-visible:ring-0"
                        />
                        <button
                          onClick={() => {
                            const next = selected.milestones.filter((x) => x.id !== m.id);
                            updateOne(selected.id, { milestones: next, progress: progressFromMilestones(next) });
                          }}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove milestone"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Progress value={selected.progress} />
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{selected.progress}% milestone completion</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  <Select
                    value={selected.status}
                    onValueChange={(v) => updateOne(selected.id, { status: v as ExecStatus, progress: v === "Completed" ? 100 : selected.progress })}
                  >
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["Planned", "In Progress", "Blocked", "Completed"] as ExecStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeOne(selected.id)}>
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <CreateInitiativeDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(init) => {
          addInitiative(init);
          setCreating(false);
        }}
      />
    </>
  );
}

// ----- Small helpers --------------------------------------------------------

function parseFirstNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,$]/g, "");
  const m = cleaned.match(/(\d+(\.\d+)?)\s*([kKmMbB]?)/);
  if (!m) return null;
  let n = Number(m[1]);
  const suf = m[3]?.toLowerCase();
  if (suf === "k") n *= 1e3;
  else if (suf === "m") n *= 1e6;
  else if (suf === "b") n *= 1e9;
  return n;
}

function buildBlockers(
  initiatives: ExecInitiative[],
  bi: ReturnType<typeof computeBusinessIntelligence> | null,
) {
  const blockers: { title: string; severity: ExecRisk; owner: string; impact: string; mitigation: string }[] = [];
  for (const i of initiatives) {
    if (i.status === "Blocked") {
      blockers.push({
        title: i.title,
        severity: "High",
        owner: i.owner,
        impact: fmtMoney(i.revenueImpact) + " at risk",
        mitigation: "Unblock owner; escalate to executive sponsor within 48h.",
      });
    } else if (i.risk === "High" && i.status !== "Completed") {
      blockers.push({
        title: `${i.title}, high-risk execution`,
        severity: "Medium",
        owner: i.owner,
        impact: fmtMoney(i.revenueImpact * 0.4) + " exposure",
        mitigation: "Add gating milestone; weekly executive review.",
      });
    }
  }
  if (bi && bi.categoryConcentrationPct >= 45) {
    blockers.push({
      title: `Category concentration ${fmtPct(bi.categoryConcentrationPct)}`,
      severity: "High",
      owner: "CEO",
      impact: fmtMoney(bi.totalRevenue * 0.12) + " single-line exposure",
      mitigation: "Launch diversification initiative within 60 days.",
    });
  }
  if (bi && bi.customerConcentrationPct >= 35) {
    blockers.push({
      title: `Customer concentration ${fmtPct(bi.customerConcentrationPct)}`,
      severity: "Medium",
      owner: "CRO",
      impact: fmtMoney(bi.totalRevenue * 0.08) + " churn exposure",
      mitigation: "Activate enterprise retention program for top accounts.",
    });
  }
  if (bi && bi.marginPct < 12) {
    blockers.push({
      title: `Margin compression at ${fmtPct(bi.marginPct)}`,
      severity: "High",
      owner: "CFO",
      impact: "Profit ceiling capped",
      mitigation: "Run pricing + cost-of-serve review; defend gross margin.",
    });
  }
  return blockers.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
}
function sevRank(s: ExecRisk) {
  return s === "High" ? 3 : s === "Medium" ? 2 : 1;
}

function buildAdvisor(
  initiatives: ExecInitiative[],
  kpis: MissionKpiTarget[],
  bi: ReturnType<typeof computeBusinessIntelligence> | null,
  consensusRec: string,
) {
  const recs: { title: string; reasoning: string; revenueImpact: number; profitImpact: number; confidence: number }[] = [];
  const blocked = initiatives.filter((i) => i.status === "Blocked");
  if (blocked.length) {
    const exposure = blocked.reduce((s, i) => s + i.revenueImpact, 0);
    recs.push({
      title: `Unblock ${blocked.length} initiative${blocked.length === 1 ? "" : "s"} this week`,
      reasoning: `${blocked.length} initiatives are blocked, exposing ${fmtMoney(exposure)} in revenue and stalling execution velocity. Owners need clearance now.`,
      revenueImpact: exposure,
      profitImpact: exposure * ((bi?.marginPct ?? 15) / 100),
      confidence: 88,
    });
  }
  const offTrack = kpis.filter((k) => k.status === "Off Track" || k.status === "At Risk");
  if (offTrack.length) {
    recs.push({
      title: `Reinforce ${offTrack.length} off-target KPI${offTrack.length === 1 ? "" : "s"}`,
      reasoning: `${offTrack.map((k) => k.label).join(", ")} ${offTrack.length === 1 ? "is" : "are"} trailing target. Re-allocate execution capacity toward closing the gap.`,
      revenueImpact: bi ? bi.totalRevenue * 0.05 : 0,
      profitImpact: bi ? bi.totalProfit * 0.05 : 0,
      confidence: 76,
    });
  }
  const highImpact = [...initiatives]
    .filter((i) => i.status !== "Completed")
    .sort((a, b) => b.revenueImpact - a.revenueImpact)[0];
  if (highImpact) {
    recs.push({
      title: `Accelerate "${highImpact.title}"`,
      reasoning: `Highest-impact open initiative, ${fmtMoney(highImpact.revenueImpact)} expected. Promote to Critical priority and add weekly review cadence.`,
      revenueImpact: highImpact.revenueImpact,
      profitImpact: highImpact.profitImpact,
      confidence: highImpact.confidence,
    });
  }
  recs.push({
    title: "Boardroom consensus action",
    reasoning: consensusRec,
    revenueImpact: bi ? bi.totalRevenue * 0.08 : 0,
    profitImpact: bi ? bi.totalProfit * 0.08 : 0,
    confidence: 72,
  });
  return recs;
}

// ----- Sub components -------------------------------------------------------

function OverviewTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Gauge;
  tone: "success" | "warning" | "destructive";
}) {
  const toneCls =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <div className="executive-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${toneCls}`} />
      </div>
      <p className="font-display text-4xl tracking-tight mt-2">{value}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

function DetailStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      {tone ? (
        <Badge variant="outline" className={`mt-1 ${tone}`}>{value}</Badge>
      ) : (
        <p className="font-display text-lg mt-0.5">{value}</p>
      )}
    </div>
  );
}

function KpiTrackCard({ k }: { k: MissionKpiTarget }) {
  const tone =
    k.status === "Achieved" ? "bg-success/15 text-success" :
    k.status === "On Track" ? "bg-primary/15 text-primary" :
    k.status === "At Risk" ? "bg-warning/15 text-warning" :
    "bg-destructive/15 text-destructive";
  return (
    <div className="executive-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{k.label}</p>
        <Badge variant="outline" className={tone}>{k.status}</Badge>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-2xl">{k.current}</span>
        <span className="text-xs text-muted-foreground">/ target {k.target}</span>
      </div>
      <div className="mt-3">
        <Progress value={k.progress} />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{k.progress}% to target</p>
      </div>
    </div>
  );
}

function HealthTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="font-display text-2xl mt-1">{value}</p>
      <Progress value={value} className="mt-2 h-1.5" />
      {note && <p className="text-[10px] text-muted-foreground mt-1.5">{note}</p>}
    </div>
  );
}

function CreateInitiativeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (i: ExecInitiative) => void;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState<ExecPriority>("Medium");
  const [dueDays, setDueDays] = useState<30 | 45 | 60 | 90>(60);
  const [objective, setObjective] = useState("");

  useEffect(() => {
    if (!open) { setTitle(""); setOwner(""); setObjective(""); setPriority("Medium"); setDueDays(60); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New Initiative</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Initiative title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Executive owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <Input placeholder="Strategic objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={priority} onValueChange={(v) => setPriority(v as ExecPriority)}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                {(["Critical","High","Medium","Low"] as ExecPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(dueDays)} onValueChange={(v) => setDueDays(Number(v) as 30 | 45 | 60 | 90)}>
              <SelectTrigger><SelectValue placeholder="Due window" /></SelectTrigger>
              <SelectContent>
                {[30,45,60,90].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              onCreate({
                id: uid(),
                title: title.trim(),
                description: objective || title,
                objective: objective || title,
                owner: owner || "Unassigned",
                source: "Manual",
                status: "Planned",
                priority,
                progress: 0,
                dueDays,
                dueDate: daysFromNow(dueDays),
                revenueImpact: 0,
                profitImpact: 0,
                confidence: 60,
                risk: "Medium",
                milestones: DEFAULT_MILESTONES(),
              });
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
