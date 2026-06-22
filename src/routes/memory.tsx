import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  Activity,
  TrendingUp,
  History,
  CheckCircle2,
  Trash2,
  Users,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/score-ring";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useActiveDataset } from "@/lib/dataset-context";
import {
  listExecutiveDecisions,
  listBoardroom,
  updateDecisionStatus,
  deleteExecutiveDecision,
  recordDecisionOutcome,
  computeDecisionHitRate,
} from "@/lib/api/persistence";
import type { DecisionStatus, DecisionOutcome, ExecutiveDecision } from "@/lib/api/types";

export const Route = createFileRoute("/memory")({
  head: () => ({ meta: [{ title: "Executive Memory, ExecutiveOS" }] }),
  component: ExecutiveMemoryPage,
});

const STATUSES: DecisionStatus[] = ["Not Started", "In Progress", "Completed", "Blocked"];

function statusBadge(s: DecisionStatus) {
  switch (s) {
    case "Completed": return "bg-success/15 text-success border-success/30";
    case "In Progress": return "bg-warning/15 text-warning border-warning/30";
    case "Blocked": return "bg-destructive/15 text-destructive border-destructive/30";
    default: return "bg-muted/30 text-muted-foreground border-border/60";
  }
}
function riskBadge(r: string) {
  return r === "High" ? "bg-destructive/15 text-destructive border-destructive/30"
    : r === "Medium" ? "bg-warning/15 text-warning border-warning/30"
    : "bg-success/15 text-success border-success/30";
}

function ExecutiveMemoryPage() {
  const qc = useQueryClient();
  const { activeDatasetId } = useActiveDataset();

  const { data: memory = [], isLoading } = useQuery({
    queryKey: ["executive-decisions", activeDatasetId],
    queryFn: () => listExecutiveDecisions(activeDatasetId),
  });
  const { data: meetings = [] } = useQuery({
    queryKey: ["boardroom", activeDatasetId],
    queryFn: () => listBoardroom(activeDatasetId),
  });

  const sorted = useMemo(
    () => [...memory].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [memory]
  );

  const stats = useMemo(() => {
    const open = memory.filter((m) => m.status === "Not Started" || m.status === "In Progress" || m.status === "Blocked");
    const completed = memory.filter((m) => m.status === "Completed");
    const blocked = memory.filter((m) => m.status === "Blocked");
    const overdue = open.filter((m) => {
      const days = (Date.now() - new Date(m.created_at).getTime()) / 86400000;
      const target = parseTimelineDays(m.timeline) ?? 30;
      return days > target;
    });
    const avgConsensus = memory.length
      ? Math.round(memory.reduce((a, m) => a + m.consensus_score, 0) / memory.length)
      : 0;
    const avgConfidence = memory.length
      ? Math.round(memory.reduce((a, m) => a + m.confidence_score, 0) / memory.length)
      : 0;
    const successRate = memory.length
      ? Math.round((completed.length / memory.length) * 100)
      : 0;
    const avgProgress = memory.length
      ? Math.round(memory.reduce((a, m) => a + m.progress, 0) / memory.length)
      : 0;
    const hit = computeDecisionHitRate(memory);
    return { open, completed, blocked, overdue, avgConsensus, avgConfidence, successRate, avgProgress, hit };
  }, [memory]);

  const consensusTrend = useMemo(
    () =>
      sorted.map((m, i) => ({
        idx: i + 1,
        label: new Date(m.created_at).toLocaleDateString(),
        consensus: m.consensus_score,
        confidence: m.confidence_score,
      })),
    [sorted]
  );

  async function setStatus(id: string, s: DecisionStatus) {
    try {
      await updateDecisionStatus(id, s);
      await qc.invalidateQueries({ queryKey: ["executive-decisions"] });
      toast.success(`Decision moved to ${s}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }
  async function remove(id: string) {
    try {
      await deleteExecutiveDecision(id);
      await qc.invalidateQueries({ queryKey: ["executive-decisions"] });
      toast.success("Decision removed from memory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }
  async function setOutcome(id: string, outcome: DecisionOutcome) {
    try {
      await recordDecisionOutcome(id, { outcome });
      await qc.invalidateQueries({ queryKey: ["executive-decisions"] });
      toast.success(`Outcome recorded: ${outcome}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record outcome (is the migration applied?)");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="09, Executive Memory"
        title="The institutional memory of ExecutiveOS"
        description="Every boardroom decision is captured, tracked through execution, and made available to future agent debates. This is the source of truth across Mission Control, Execution Center, Reports, and the Boardroom."
      />

      {!activeDatasetId ? (
        <EmptyState title="Select a dataset" description="Choose a dataset in the sidebar to view its executive memory." />
      ) : isLoading ? (
        <EmptyState title="Loading memory" description="Reading the executive decision archive…" />
      ) : memory.length === 0 ? (
        <EmptyState
          title="No decisions on record yet"
          description="Convene the AI Boardroom and record a meeting to commit your first executive decision to memory."
        />
      ) : (
        <>
          {/* Stats */}
          <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <StatCard label="Decisions captured" value={String(memory.length)} sub={`${stats.completed.length} completed · ${stats.open.length} open`} />
            <StatCard
              label="Decision hit-rate"
              value={stats.hit ? `${stats.hit.hitRate}%` : "—"}
              sub={stats.hit ? `${stats.hit.wins}/${stats.hit.graded} wins, graded by real outcomes` : "Record outcomes below to measure"}
            />
            <StatCard label="Avg consensus" value={`${stats.avgConsensus}/100`} sub={`Avg confidence ${stats.avgConfidence}%`} />
            <StatCard label="Overdue decisions" value={String(stats.overdue.length)} sub={`${stats.blocked.length} blocked`} tone={stats.overdue.length > 0 ? "warn" : "ok"} />
          </section>

          {/* Section 1, Decision Timeline */}
          <Section icon={<History className="h-4 w-4" />} label="01" title="Decision Timeline" subtitle="Chronological log of every executive decision in this dataset.">
            <div className="space-y-2">
              {sorted.slice().reverse().map((m) => (
                <DecisionRow key={m.id} m={m} onStatus={setStatus} onRemove={remove} onOutcome={setOutcome} />
              ))}
            </div>
          </Section>

          {/* Section 2, Consensus Trend */}
          <Section icon={<TrendingUp className="h-4 w-4" />} label="02" title="Consensus Trend" subtitle="How boardroom agreement and confidence have evolved over time.">
            <div className="executive-card rounded-xl p-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consensusTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="idx" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
                  />
                  <Line type="monotone" dataKey="consensus" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Consensus" />
                  <Line type="monotone" dataKey="confidence" stroke="hsl(var(--secondary))" strokeWidth={2} dot={{ r: 3 }} name="Confidence" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {/* Section 3, Execution Progress */}
          <Section icon={<Activity className="h-4 w-4" />} label="03" title="Execution Progress" subtitle="Live status across every decision committed to execution.">
            <div className="grid lg:grid-cols-3 gap-3">
              <div className="executive-card-elevated rounded-xl p-6 flex flex-col items-center">
                <ScoreRing
                  value={stats.avgProgress}
                  label="Avg Progress"
                  size={150}
                  tone={stats.avgProgress >= 70 ? "success" : stats.avgProgress >= 40 ? "warning" : "destructive"}
                />
                <p className="text-xs text-muted-foreground text-center mt-3">
                  {stats.completed.length} of {memory.length} decisions completed
                </p>
              </div>
              <div className="lg:col-span-2 space-y-2">
                {memory
                  .filter((m) => m.status !== "Completed")
                  .slice(0, 8)
                  .map((m) => (
                    <div key={m.id} className="executive-card rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="font-medium line-clamp-1">{m.decision}</span>
                        <span className="text-muted-foreground whitespace-nowrap ml-2">{m.progress}%</span>
                      </div>
                      <Progress value={m.progress} />
                    </div>
                  ))}
                {memory.filter((m) => m.status !== "Completed").length === 0 && (
                  <div className="executive-card rounded-xl p-6 text-sm text-muted-foreground">All decisions completed.</div>
                )}
              </div>
            </div>
          </Section>

          {/* Section 4, Decision Outcomes */}
          <Section icon={<CheckCircle2 className="h-4 w-4" />} label="04" title="Decision Outcomes" subtitle="By status distribution.">
            <div className="grid md:grid-cols-4 gap-3">
              {STATUSES.map((s) => {
                const items = memory.filter((m) => m.status === s);
                return (
                  <div key={s} className="executive-card rounded-xl p-4">
                    <Badge variant="outline" className={statusBadge(s)}>{s}</Badge>
                    <p className="font-display text-2xl mt-2">{items.length}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                      {items[0]?.decision ?? "-"}
                    </p>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Section 5, Historical Boardroom Archive */}
          <Section icon={<Users className="h-4 w-4" />} label="05" title="Historical Boardroom Archive" subtitle="Recorded executive meetings for this dataset.">
            {meetings.length === 0 ? (
              <div className="executive-card rounded-xl p-6 text-sm text-muted-foreground">No meetings archived yet.</div>
            ) : (
              <div className="space-y-2">
                {meetings.slice(0, 10).map((m) => (
                  <div key={m.id} className="executive-card rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{m.topic}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {m.created_at ? new Date(m.created_at).toLocaleString() : ""} · {m.messages.length} messages
                        </p>
                      </div>
                      <Link to="/boardroom" className="text-xs text-secondary hover:underline whitespace-nowrap">Open Boardroom →</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

const OUTCOME_BADGE: Record<DecisionOutcome, string> = {
  win: "bg-success/15 text-success border-success/30",
  mixed: "bg-warning/15 text-warning border-warning/30",
  loss: "bg-destructive/15 text-destructive border-destructive/30",
};

function DecisionRow({
  m,
  onStatus,
  onRemove,
  onOutcome,
}: {
  m: ExecutiveDecision;
  onStatus: (id: string, s: DecisionStatus) => void;
  onRemove: (id: string) => void;
  onOutcome: (id: string, o: DecisionOutcome) => void;
}) {
  const days = Math.round((Date.now() - new Date(m.created_at).getTime()) / 86400000);
  const target = parseTimelineDays(m.timeline) ?? 30;
  const overdue = m.status !== "Completed" && days > target;
  return (
    <div className="executive-card rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{m.decision}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Q: {m.question}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="outline" className={statusBadge(m.status)}>{m.status}</Badge>
          <Badge variant="outline" className={riskBadge(m.risk_level)}>Risk {m.risk_level}</Badge>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
        <Field label="Revenue" value={m.revenue_impact ?? "-"} />
        <Field label="Profit" value={m.profit_impact ?? "-"} />
        <Field label="Owner" value={m.owner ?? "-"} />
        <Field label="Timeline" value={`${m.timeline ?? "-"}${overdue ? " · overdue" : ""}`} accent={overdue ? "destructive" : undefined} />
      </div>
      {m.next_actions.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-2"><span className="text-secondary">Next:</span> {m.next_actions.join(" · ")}</p>
      )}
      <div className="flex items-center justify-between mt-3 gap-3">
        <div className="flex-1">
          <Progress value={m.progress} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Select value={m.status} onValueChange={(v) => onStatus(m.id, v as DecisionStatus)}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemove(m.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Consensus {m.consensus_score}/100 · Confidence {m.confidence_score}% · {days}d ago
      </p>

      {/* Outcome loop: grade the decision by what actually happened */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Actual outcome</span>
          {m.outcome ? (
            <Badge variant="outline" className={OUTCOME_BADGE[m.outcome]}>{m.outcome}</Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">not recorded</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["win", "mixed", "loss"] as DecisionOutcome[]).map((o) => (
            <button
              key={o}
              onClick={() => onOutcome(m.id, o)}
              className={`text-[11px] capitalize px-2 py-1 rounded-md border transition-colors ${
                m.outcome === o ? OUTCOME_BADGE[o] : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: "destructive" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={accent === "destructive" ? "text-destructive" : "text-foreground"}>{value}</p>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className="executive-card rounded-xl p-5">
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`font-display text-3xl mt-1 ${tone === "warn" ? "text-warning" : "text-foreground"}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function Section({ icon, label, title, subtitle, children }: { icon: React.ReactNode; label: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-2">
          {icon} Section {label}
        </p>
        <h2 className="font-display text-2xl tracking-tight mt-1 flex items-center gap-2">
          <Brain className="h-5 w-5 text-secondary" /> {title}
        </h2>
        {subtitle && <p className="text-xs text-muted-foreground max-w-2xl mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function parseTimelineDays(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/(\d+)\s*day/i);
  if (m) return parseInt(m[1], 10);
  const w = t.match(/(\d+)\s*week/i);
  if (w) return parseInt(w[1], 10) * 7;
  const mo = t.match(/(\d+)\s*month/i);
  if (mo) return parseInt(mo[1], 10) * 30;
  if (/q[1-4]/i.test(t)) return 90;
  return null;
}
