import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Target,
  Sparkles,
  Trophy,
  CircleGauge,
  Map as MapIcon,
  Users,
  ShieldCheck,
  TrendingUp,
  Activity,
  Layers,
  Crosshair,
  CalendarClock,
  ArrowRight,
  Brain,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/score-ring";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import { computeBusinessIntelligence, formatMoney as fmtMoney } from "@/lib/api/intelligence";
import { listExecutiveDecisions, updateDecisionStatus } from "@/lib/api/persistence";
import type { DecisionStatus } from "@/lib/api/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deriveObjectives,
  deriveInitiatives,
  deriveKpiTargets,
  buildRoadmap,
  buildAgentConsensus,
  strategyHealth,
  strategyScore,
  type MissionInitiative,
  type InitiativeStatus,
  type Priority,
  type RiskLevel,
} from "@/lib/api/mission";

export const Route = createFileRoute("/simulator")({
  head: () => ({ meta: [{ title: "Mission Control, ExecutiveOS" }] }),
  component: MissionControlPage,
});

const COLUMNS: InitiativeStatus[] = ["Backlog", "Planned", "In Progress", "Completed"];

const priorityTone: Record<Priority, string> = {
  Critical: "bg-destructive/15 text-destructive border-destructive/30",
  High: "bg-warning/15 text-warning border-warning/30",
  Medium: "bg-secondary/20 text-secondary border-secondary/30",
  Low: "bg-muted text-muted-foreground border-border/60",
};

const statusTone: Record<InitiativeStatus, string> = {
  Backlog: "bg-muted text-muted-foreground",
  Planned: "bg-secondary/20 text-secondary",
  "In Progress": "bg-warning/20 text-warning",
  Completed: "bg-success/20 text-success",
};

const riskTone: Record<RiskLevel, string> = {
  Low: "bg-success/15 text-success border-success/30",
  Moderate: "bg-secondary/20 text-secondary border-secondary/30",
  Elevated: "bg-warning/15 text-warning border-warning/30",
  High: "bg-destructive/15 text-destructive border-destructive/30",
};

function MissionControlPage() {
  const { activeDatasetId } = useActiveDataset();
  const qc = useQueryClient();

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
  const { data: decisions = [] } = useQuery({
    queryKey: ["executive-decisions", activeDatasetId],
    queryFn: () => listExecutiveDecisions(activeDatasetId),
  });

  async function setDecisionStatus(id: string, s: DecisionStatus) {
    try {
      await updateDecisionStatus(id, s);
      await qc.invalidateQueries({ queryKey: ["executive-decisions"] });
      toast.success(`Decision moved to ${s}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const intel = useMemo(() => {
    if (!dataset || !rows.length) return null;
    const kpis = computeKpis(rows, dataset.schema);
    return { kpis, bi: computeBusinessIntelligence(rows, dataset.schema, kpis) };
  }, [dataset, rows]);

  const objectives = useMemo(() => deriveObjectives(intel?.bi ?? null, intel?.kpis ?? null), [intel]);
  const initialInitiatives = useMemo(() => deriveInitiatives(intel?.bi ?? null, intel?.kpis ?? null), [intel]);
  const kpiTargets = useMemo(() => deriveKpiTargets(intel?.bi ?? null, intel?.kpis ?? null), [intel]);
  const consensus = useMemo(() => buildAgentConsensus(intel?.bi ?? null), [intel]);
  const health = useMemo(() => strategyHealth(intel?.bi ?? null, intel?.kpis ?? null), [intel]);

  const [initiatives, setInitiatives] = useState<MissionInitiative[]>([]);
  useEffect(() => setInitiatives(initialInitiatives), [initialInitiatives]);

  const strategy = useMemo(
    () => strategyScore(intel?.bi ?? null, intel?.kpis ?? null, initiatives),
    [intel, initiatives],
  );

  const roadmap = useMemo(() => buildRoadmap(initiatives), [initiatives]);

  function moveInitiative(id: string, dir: -1 | 1) {
    setInitiatives((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const idx = COLUMNS.indexOf(i.status);
        const nextIdx = Math.max(0, Math.min(COLUMNS.length - 1, idx + dir));
        const status = COLUMNS[nextIdx];
        toast.success(`${i.title} → ${status}`);
        return { ...i, status };
      }),
    );
  }

  if (!activeDatasetId) {
    return (
      <>
        <PageHeader eyebrow="05, Mission Control" title="Strategic Execution Hub" />
        <EmptyState title="Select a dataset" description="Choose a dataset in the sidebar to assemble executive objectives, initiatives, and the strategic roadmap." />
      </>
    );
  }

  if (!intel) {
    return (
      <>
        <PageHeader eyebrow="05, Mission Control" title="Strategic Execution Hub" />
        <EmptyState title="Loading intelligence" description="Computing executive intelligence from your dataset…" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="05, Mission Control"
        title="Strategic Execution Hub"
        description="We know the insights. This is what we do next. Mission Control connects Dashboard, CEO Brief, Consultant Report and Execution into a single executive operating surface."
      />

      {/* SECTION 0, Executive Memory */}
      <DecisionsPanel decisions={decisions} onStatus={setDecisionStatus} />

      {/* SECTION 1, Strategic Objectives */}
      <Section icon={<Target className="h-4 w-4" />} label="01" title="Strategic Objectives" subtitle="Executive objectives derived from your dataset, CEO Brief, and Consultant Report.">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {objectives.map((o) => (
            <div key={o.id} className="executive-card rounded-xl p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-lg leading-snug">{o.title}</h3>
                <Badge variant="outline" className={priorityTone[o.priority]}>{o.priority}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{o.rationale}</p>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Owner · {o.owner}</span>
                  <span>{o.progress}%</span>
                </div>
                <Progress value={o.progress} />
                <div className="flex justify-between text-xs pt-1">
                  <span className={`px-2 py-0.5 rounded ${statusTone[o.status]}`}>{o.status}</span>
                  <span className="font-display text-secondary">{o.impact}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* SECTION 2, AI Recommended Initiatives */}
      <Section icon={<Sparkles className="h-4 w-4" />} label="02" title="AI Recommended Initiatives" subtitle="Dynamically generated from KPI performance, risks, forecast trends, regions, categories, customer concentration, growth and margin. Re-ranks live as the dataset changes.">
        <div className="grid md:grid-cols-2 gap-4">
          {initiatives.map((i) => (
            <div key={i.id} className="executive-card-elevated rounded-xl p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{i.driver} signal</p>
                  <h3 className="font-display text-lg leading-snug">{i.title}</h3>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="outline" className={priorityTone[i.priority]}>{i.priority}</Badge>
                  <Badge variant="outline" className={riskTone[i.riskLevel]}>{i.riskLevel} risk</Badge>
                </div>
              </div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-2">Why</p>
              <p className="text-xs leading-relaxed mt-0.5">{i.why}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-3">Strategic rationale</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{i.rationale}</p>
              <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <Stat label="Revenue" value={fmtMoney(i.revenueImpact)} tone={i.revenueImpact >= 0 ? "success" : "destructive"} />
                <Stat label="Profit" value={fmtMoney(i.profitImpact)} tone={i.profitImpact >= 0 ? "success" : "destructive"} />
                <Stat label="Confidence" value={`${Math.round(i.confidence)}%`} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Owner · <span className="text-foreground">{i.owner}</span></span>
                <div className="flex flex-wrap gap-1">
                  {i.agents.map((a) => (
                    <span key={a} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 normal-case tracking-normal">{a}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* SECTION 2b, Strategy Score (composite, source-of-truth for Boardroom / Execution / Reports) */}
      <Section icon={<Trophy className="h-4 w-4" />} label="02b" title="Strategy Score" subtitle="Composite of Growth Opportunity, Execution Feasibility, Risk Exposure and Forecast Support. Consumed by AI Boardroom, Execution Center and Reports.">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center justify-center">
            <ScoreRing
              value={strategy.overall}
              label="Strategy Score"
              size={160}
              tone={strategy.overall >= 70 ? "success" : strategy.overall >= 50 ? "warning" : "destructive"}
            />
            <p className="font-display text-sm mt-3">{strategy.verdict}</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Board verdict</p>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 gap-3">
            <HealthBar icon={<TrendingUp className="h-3.5 w-3.5" />} label="Growth Opportunity" value={strategy.growthOpportunity} />
            <HealthBar icon={<Activity className="h-3.5 w-3.5" />} label="Execution Feasibility" value={strategy.executionFeasibility} />
            <HealthBar icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Risk Exposure" value={strategy.riskExposure} invert />
            <HealthBar icon={<MapIcon className="h-3.5 w-3.5" />} label="Forecast Support" value={strategy.forecastSupport} />
          </div>
        </div>
      </Section>


      {/* SECTION 3, Execution Board (Kanban) */}
      <Section icon={<Layers className="h-4 w-4" />} label="03" title="Execution Board" subtitle="Portfolio-style Kanban for executive initiatives. Click arrows to advance status.">
        <div className="grid md:grid-cols-4 gap-3">
          {COLUMNS.map((col) => {
            const items = initiatives.filter((i) => i.status === col);
            return (
              <div key={col} className="executive-card rounded-xl p-3">
                <div className="flex items-center justify-between mb-3 px-1">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{col}</p>
                  <span className="text-[10px] text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 && <p className="text-xs text-muted-foreground/60 px-1 py-2">-</p>}
                  {items.map((i) => (
                    <div key={i.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium leading-snug">{i.title}</p>
                        <Badge variant="outline" className={`${priorityTone[i.priority]} text-[9px] px-1.5 py-0`}>{i.priority}</Badge>
                      </div>
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground flex justify-between">
                        <span>{i.owner}</span>
                        <span>{i.timelineDays}d</span>
                      </div>
                      <div className="text-[11px] text-secondary mt-1">{fmtMoney(i.profitImpact)} profit</div>
                      <div className="mt-2 flex justify-between">
                        <button onClick={() => moveInitiative(i.id, -1)} className="text-[10px] text-muted-foreground hover:text-foreground" disabled={COLUMNS.indexOf(i.status) === 0}>← back</button>
                        <button onClick={() => moveInitiative(i.id, 1)} className="text-[10px] text-secondary hover:text-foreground" disabled={COLUMNS.indexOf(i.status) === COLUMNS.length - 1}>advance →</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* SECTION 4, Executive Priority Matrix */}
      <Section icon={<Crosshair className="h-4 w-4" />} label="04" title="Executive Priority Matrix" subtitle="Impact × Effort. Quick Wins to the top-left, Major Projects to the top-right.">
        <PriorityMatrix initiatives={initiatives} />
      </Section>

      {/* SECTION 5, KPI Progress Center */}
      <Section icon={<CircleGauge className="h-4 w-4" />} label="05" title="KPI Progress Center" subtitle="Strategic KPIs tracked against executive targets.">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {kpiTargets.map((k) => {
            const tone = k.status === "Achieved" ? "text-success" : k.status === "On Track" ? "text-secondary" : k.status === "At Risk" ? "text-warning" : "text-destructive";
            return (
              <div key={k.key} className="executive-card rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{k.label}</p>
                    <p className="font-display text-2xl mt-1">{k.current}</p>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider ${tone}`}>{k.status}</span>
                </div>
                <div className="mt-3 flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Target {k.target}</span>
                  <span>{k.progress}%</span>
                </div>
                <Progress value={k.progress} />
              </div>
            );
          })}
        </div>
      </Section>

      {/* SECTION 6, Executive Roadmap */}
      <Section icon={<CalendarClock className="h-4 w-4" />} label="06" title="Executive Roadmap" subtitle="Initiatives placed across 30 / 45 / 60 / 90-day execution windows.">
        <div className="grid md:grid-cols-4 gap-3">
          {(["30", "45", "60", "90"] as const).map((d) => {
            const bucket = roadmap[Number(d) as 30 | 45 | 60 | 90];
            return (
              <div key={d} className="executive-card rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{d} days</p>
                  <span className="text-[10px] text-muted-foreground">{bucket.length}</span>
                </div>
                <div className="space-y-2">
                  {bucket.length === 0 && <p className="text-xs text-muted-foreground/60">-</p>}
                  {bucket.map((i) => (
                    <div key={i.id} className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs">
                      <p className="font-medium leading-snug">{i.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{i.owner} · <span className="text-secondary">{fmtMoney(i.revenueImpact)}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* SECTION 7, Agent Consensus */}
      <Section icon={<Users className="h-4 w-4" />} label="07" title="Agent Consensus Panel" subtitle="Cross-agent strategic recommendations and consensus score.">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="executive-card-elevated rounded-xl p-6 lg:col-span-1 flex flex-col items-center justify-center text-center">
            <ScoreRing value={consensus.consensusScore} label="Consensus" size={140} tone="success" />
            <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{consensus.consensusRecommendation}</p>
            <p className="text-xs text-secondary mt-3 font-medium">{consensus.expectedOutcome}</p>
            <p className="text-[10px] text-muted-foreground mt-2">Illustrative estimate, revenue-scaled, not a modeled prediction.</p>
          </div>
          <div className="lg:col-span-2 space-y-3">
            {consensus.recs.map((r) => (
              <div key={r.agent} className="executive-card rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-display text-base">{r.agent}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={r.stance === "Support" ? "bg-success/15 text-success border-success/30" : r.stance === "Conditional" ? "bg-warning/15 text-warning border-warning/30" : "bg-destructive/15 text-destructive border-destructive/30"}>{r.stance}</Badge>
                    <span className="text-xs text-muted-foreground">{r.confidence}%</span>
                  </div>
                </div>
                <p className="text-sm">{r.recommendation}</p>
                <p className="text-xs text-muted-foreground mt-1">{r.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SECTION 8, Strategy Health */}
      <Section icon={<ShieldCheck className="h-4 w-4" />} label="08" title="Executive Health of Strategy" subtitle="Composite strategy score across readiness, growth, risk, forecast, and alignment.">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center justify-center">
            <ScoreRing value={health.overall} label="Strategy Score" size={160} tone={health.overall >= 70 ? "success" : health.overall >= 50 ? "warning" : "destructive"} />
            <p className="text-xs text-muted-foreground text-center mt-3 max-w-[240px]">Composite of execution readiness, growth potential, inverse risk, forecast strength and operational alignment.</p>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 gap-3">
            <HealthBar icon={<TrendingUp className="h-3.5 w-3.5" />} label="Execution Readiness" value={health.executionReadiness} />
            <HealthBar icon={<Trophy className="h-3.5 w-3.5" />} label="Growth Potential" value={health.growthPotential} />
            <HealthBar icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Risk Exposure" value={health.riskExposure} invert />
            <HealthBar icon={<Activity className="h-3.5 w-3.5" />} label="Forecast Strength" value={health.forecastStrength} />
            <HealthBar icon={<MapIcon className="h-3.5 w-3.5" />} label="Operational Alignment" value={health.operationalAlignment} />
          </div>
        </div>
      </Section>
    </>
  );
}

function Section({ icon, label, title, subtitle, children }: { icon: React.ReactNode; label: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">{icon} Section {label}</p>
          <h2 className="font-display text-2xl tracking-tight mt-1">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground max-w-2xl mt-1">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-display text-sm mt-0.5 ${cls}`}>{value}</p>
    </div>
  );
}

function HealthBar({ icon, label, value, invert }: { icon: React.ReactNode; label: string; value: number; invert?: boolean }) {
  const eff = invert ? 100 - value : value;
  const tone = eff >= 70 ? "text-success" : eff >= 50 ? "text-warning" : "text-destructive";
  return (
    <div className="executive-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">{icon} {label}</p>
        <span className={`font-display text-base ${tone}`}>{value}</span>
      </div>
      <Progress value={eff} />
    </div>
  );
}

function PriorityMatrix({ initiatives }: { initiatives: MissionInitiative[] }) {
  const quadrant = (i: MissionInitiative) => {
    if (i.impactScore >= 60 && i.effort < 50) return "qw";
    if (i.impactScore >= 60 && i.effort >= 50) return "mp";
    if (i.impactScore < 60 && i.effort < 50) return "fi";
    return "av";
  };
  const labels: Record<string, { label: string; tone: string }> = {
    qw: { label: "Quick Wins", tone: "border-success/40 bg-success/5" },
    mp: { label: "Major Projects", tone: "border-primary/40 bg-primary/5" },
    fi: { label: "Fill Ins", tone: "border-secondary/40 bg-secondary/5" },
    av: { label: "Avoid", tone: "border-destructive/40 bg-destructive/5" },
  };
  return (
    <div className="executive-card rounded-xl p-6">
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateRows: "1fr 1fr", minHeight: 380 }}>
        {(["qw", "mp", "fi", "av"] as const).map((q) => {
          const items = initiatives.filter((i) => quadrant(i) === q);
          return (
            <div key={q} className={`rounded-lg border p-3 ${labels[q].tone}`}>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" /> {labels[q].label}
              </p>
              <div className="space-y-1.5">
                {items.length === 0 && <p className="text-xs text-muted-foreground/60">-</p>}
                {items.map((i) => (
                  <div key={i.id} className="text-xs flex justify-between gap-2 border-b border-border/30 pb-1.5">
                    <span className="leading-snug">{i.title}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{Math.round(i.confidence)}%</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-3">
        <span>← Low Effort</span>
        <span>Impact ↑</span>
        <span>High Effort →</span>
      </div>
    </div>
  );
}

function DecisionsPanel({
  decisions,
  onStatus,
}: {
  decisions: import("@/lib/api/types").ExecutiveDecision[];
  onStatus: (id: string, s: DecisionStatus) => void;
}) {
  if (!decisions.length) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">
            <Brain className="h-4 w-4" /> Section 00 · Executive Memory
          </p>
          <h2 className="font-display text-2xl tracking-tight mt-1">Boardroom decisions on record</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Convene the <Link to="/boardroom" className="text-secondary hover:underline">AI Boardroom</Link> to commit your first executive decision to Mission Control.
          </p>
        </div>
      </section>
    );
  }
  const open = decisions.filter((d) => d.status === "Not Started" || d.status === "In Progress");
  const completed = decisions.filter((d) => d.status === "Completed");
  const blocked = decisions.filter((d) => d.status === "Blocked");
  const overdue = open.filter((d) => {
    const days = (Date.now() - new Date(d.created_at).getTime()) / 86400000;
    return days > 30;
  });

  const statuses: DecisionStatus[] = ["Not Started", "In Progress", "Completed", "Blocked"];

  return (
    <section className="mb-10">
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">
          <Brain className="h-4 w-4" /> Section 00 · Executive Memory
        </p>
        <h2 className="font-display text-2xl tracking-tight mt-1">Boardroom decisions</h2>
        <p className="text-xs text-muted-foreground mt-1">Open, completed, blocked and overdue executive decisions from the AI Boardroom, track and re-rank execution here.</p>
      </div>
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <MiniStat label="Open" value={open.length} />
        <MiniStat label="Completed" value={completed.length} />
        <MiniStat label="Blocked" value={blocked.length} />
        <MiniStat label="Overdue" value={overdue.length} tone={overdue.length ? "warn" : undefined} />
      </div>
      <div className="space-y-2">
        {decisions.slice(0, 6).map((d) => {
          const days = Math.round((Date.now() - new Date(d.created_at).getTime()) / 86400000);
          return (
            <div key={d.id} className="executive-card rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{d.decision}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">Q: {d.question}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {days}d ago · Owner {d.owner ?? "-"} · Timeline {d.timeline ?? "-"} · Consensus {d.consensus_score}/100
                  </p>
                </div>
                <Select value={d.status} onValueChange={(v) => onStatus(d.id, v as DecisionStatus)}>
                  <SelectTrigger className="h-8 text-xs w-36 flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2"><Progress value={d.progress} /></div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-right">
        <Link to="/memory" className="text-xs text-secondary hover:underline">Open full Executive Memory →</Link>
      </div>
    </section>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="executive-card rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl mt-1 ${tone === "warn" ? "text-warning" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
