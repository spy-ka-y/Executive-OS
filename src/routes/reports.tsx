import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Presentation,
  Download,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Briefcase,
  Target,
  TrendingUp,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from "recharts";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { callBrain, buildReportBriefPrompt, brainErrorMessage } from "@/lib/ai/brain";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import {
  computeBusinessIntelligence,
  formatMoney as fmtMoney,
  formatPct as fmtPct,
} from "@/lib/api/intelligence";
import {
  buildAgentConsensus,
  deriveInitiatives,
  deriveKpiTargets,
  strategyHealth,
} from "@/lib/api/mission";
import {
  latestCeoBrief,
  latestConsultantReport,
  listActionPlans,
  listBoardroom,
  listExecutiveDecisions,
  listReports,
  saveReport,
} from "@/lib/api/persistence";
import {
  exportPdf,
  exportPptx,
  downloadBlob,
  type ReportContent,
} from "@/lib/api/reports";
import type { BoardroomConversation } from "@/lib/api/types";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports, ExecutiveOS" }] }),
  component: ReportsPage,
});

// ---------- Local types reflecting Execution Center extended initiative shape
type ExecStatus = "Planned" | "In Progress" | "Blocked" | "Completed";
type ExecPriority = "Critical" | "High" | "Medium" | "Low";

interface ExecInitiative {
  id: string;
  title: string;
  description?: string;
  owner: string;
  status: ExecStatus | string;
  priority?: ExecPriority | string;
  progress: number;
  dueDays?: number;
  dueDate?: string;
  revenueImpact?: number;
  profitImpact?: number;
  confidence?: number;
  source?: string;
}

interface AggRisk {
  title: string;
  severity: "low" | "med" | "high";
  source: string;
  owner: string;
  mitigation: string;
  status: string;
}

interface RecItem {
  title: string;
  detail: string;
  source: string;
  priority: ExecPriority;
  impact: string;
  confidence: number;
  owner: string;
  timeline: string;
}

const sevTone: Record<"low" | "med" | "high", string> = {
  low: "bg-secondary/20 text-secondary border-secondary/30",
  med: "bg-warning/15 text-warning border-warning/30",
  high: "bg-destructive/15 text-destructive border-destructive/30",
};

const statusTone: Record<string, string> = {
  Planned: "bg-secondary/20 text-secondary border-secondary/30",
  "In Progress": "bg-warning/15 text-warning border-warning/30",
  Blocked: "bg-destructive/15 text-destructive border-destructive/30",
  Completed: "bg-success/15 text-success border-success/30",
  not_started: "bg-secondary/20 text-secondary border-secondary/30",
  in_progress: "bg-warning/15 text-warning border-warning/30",
  done: "bg-success/15 text-success border-success/30",
};

const priorityTone: Record<string, string> = {
  Critical: "bg-destructive/15 text-destructive border-destructive/30",
  High: "bg-warning/15 text-warning border-warning/30",
  Medium: "bg-secondary/20 text-secondary border-secondary/30",
  Low: "bg-muted text-muted-foreground border-border/60",
};

// Trends snapshot storage (per dataset)
type Snapshot = {
  t: string;
  health: number;
  strategy: number;
  execution: number;
  consensus: number;
};
const trendsKey = (id: string) => `executiveos.trends.${id}`;
function readTrends(id: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(trendsKey(id));
    return raw ? (JSON.parse(raw) as Snapshot[]) : [];
  } catch {
    return [];
  }
}
function pushTrend(id: string, snap: Snapshot) {
  const arr = readTrends(id);
  const last = arr[arr.length - 1];
  // Dedupe: skip if same day & same scores
  const sameDay = last && new Date(last.t).toDateString() === new Date(snap.t).toDateString();
  if (sameDay) arr[arr.length - 1] = snap;
  else arr.push(snap);
  try {
    localStorage.setItem(trendsKey(id), JSON.stringify(arr.slice(-60)));
  } catch {
    // ignore
  }
}

// Local generated brief storage
const briefsKey = "executiveos.localBriefs";
interface LocalBrief {
  id: string;
  title: string;
  created_at: string;
  body: string;
  source?: "ai" | "builtin";
}
function readLocalBriefs(): LocalBrief[] {
  try {
    return JSON.parse(localStorage.getItem(briefsKey) || "[]") as LocalBrief[];
  } catch {
    return [];
  }
}
function saveLocalBrief(b: LocalBrief) {
  const arr = readLocalBriefs();
  arr.unshift(b);
  try {
    localStorage.setItem(briefsKey, JSON.stringify(arr.slice(0, 25)));
  } catch {
    // ignore
  }
}

function ReportsPage() {
  const qc = useQueryClient();
  const { activeDatasetId } = useActiveDataset();
  const [busy, setBusy] = useState<"pdf" | "pptx" | "brief" | null>(null);
  const [initStatusFilter, setInitStatusFilter] = useState<string>("All");
  const [openMeeting, setOpenMeeting] = useState<BoardroomConversation | null>(null);

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
  const { data: brief = null } = useQuery({
    queryKey: ["ceo-brief", activeDatasetId],
    queryFn: () => (activeDatasetId ? latestCeoBrief(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });
  const { data: consultant = null } = useQuery({
    queryKey: ["consultant", activeDatasetId],
    queryFn: () => (activeDatasetId ? latestConsultantReport(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["action-plans", activeDatasetId],
    queryFn: () => listActionPlans(activeDatasetId ?? null),
    enabled: !!activeDatasetId,
  });
  const { data: meetings = [] } = useQuery({
    queryKey: ["boardroom", activeDatasetId],
    queryFn: () => listBoardroom(activeDatasetId ?? null),
    enabled: !!activeDatasetId,
  });
  const { data: decisions = [] } = useQuery({
    queryKey: ["executive-decisions", activeDatasetId],
    queryFn: () => listExecutiveDecisions(activeDatasetId ?? null),
    enabled: !!activeDatasetId,
  });
  const decisionStats = useMemo(() => {
    const quarterAgo = Date.now() - 92 * 86400000;
    const thisQuarter = decisions.filter((d) => new Date(d.created_at).getTime() >= quarterAgo);
    const completed = decisions.filter((d) => d.status === "Completed");
    const successRate = decisions.length ? Math.round((completed.length / decisions.length) * 100) : 0;
    const avgConsensus = decisions.length ? Math.round(decisions.reduce((a, d) => a + d.consensus_score, 0) / decisions.length) : 0;
    const avgConfidence = decisions.length ? Math.round(decisions.reduce((a, d) => a + d.confidence_score, 0) / decisions.length) : 0;
    return { total: decisions.length, thisQuarter: thisQuarter.length, completed: completed.length, successRate, avgConsensus, avgConfidence };
  }, [decisions]);
  const { data: reports = [] } = useQuery({ queryKey: ["reports"], queryFn: listReports });

  const kpis = useMemo(
    () => (dataset && rows.length ? computeKpis(rows, dataset.schema) : null),
    [dataset, rows],
  );
  const intel = useMemo(
    () => (dataset && rows.length ? computeBusinessIntelligence(rows, dataset.schema, kpis) : null),
    [dataset, rows, kpis],
  );
  const health = useMemo(() => strategyHealth(intel, kpis), [intel, kpis]);
  const consensus = useMemo(() => buildAgentConsensus(intel), [intel]);
  const missionInitiatives = useMemo(() => deriveInitiatives(intel), [intel]);
  const kpiTargets = useMemo(() => deriveKpiTargets(intel, kpis), [intel, kpis]);

  // Flatten initiatives from all plans
  const initiatives = useMemo<ExecInitiative[]>(() => {
    const out: ExecInitiative[] = [];
    for (const p of plans) {
      for (const i of p.initiatives as unknown as ExecInitiative[]) {
        out.push(i);
      }
    }
    return out;
  }, [plans]);

  const execStats = useMemo(() => {
    if (!initiatives.length) return { completed: 0, inProgress: 0, blocked: 0, planned: 0, total: 0, avgProgress: 0 };
    let completed = 0, inProgress = 0, blocked = 0, planned = 0;
    let sumProgress = 0;
    for (const i of initiatives) {
      sumProgress += i.progress ?? 0;
      const s = String(i.status);
      if (s === "Completed" || s === "done") completed++;
      else if (s === "In Progress" || s === "in_progress") inProgress++;
      else if (s === "Blocked") blocked++;
      else planned++;
    }
    return {
      completed,
      inProgress,
      blocked,
      planned,
      total: initiatives.length,
      avgProgress: Math.round(sumProgress / initiatives.length),
    };
  }, [initiatives]);

  const executionScore = useMemo(() => {
    if (!initiatives.length && !kpiTargets.length) return 0;
    const completionRate = initiatives.length ? execStats.completed / initiatives.length : 0;
    const progressRate = (execStats.avgProgress || 0) / 100;
    const blockedPenalty = initiatives.length ? execStats.blocked / initiatives.length : 0;
    const kpiAch = kpiTargets.length
      ? kpiTargets.reduce((a, k) => a + (k.status === "Achieved" ? 1 : k.status === "On Track" ? 0.7 : k.status === "At Risk" ? 0.4 : 0), 0) / kpiTargets.length
      : 0.5;
    const raw = (completionRate * 30 + progressRate * 25 + kpiAch * 35 + (1 - blockedPenalty) * 10);
    return Math.round(Math.max(0, Math.min(100, raw)));
  }, [initiatives.length, execStats, kpiTargets]);

  const healthScore = health.overall || brief?.health_score || 0;
  const growthScore = health.growthPotential;
  const riskScore = health.riskExposure;

  // Snapshot trends
  useEffect(() => {
    if (!activeDatasetId || !intel) return;
    pushTrend(activeDatasetId, {
      t: new Date().toISOString(),
      health: healthScore,
      strategy: health.growthPotential,
      execution: executionScore,
      consensus: consensus.consensusScore,
    });
  }, [activeDatasetId, intel, healthScore, health.growthPotential, executionScore, consensus.consensusScore]);

  const trends = activeDatasetId ? readTrends(activeDatasetId) : [];
  const trendData = trends.map((s) => ({
    date: new Date(s.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    Health: s.health,
    Strategy: s.strategy,
    Execution: s.execution,
    Consensus: s.consensus,
  }));

  // Strategy alignment: compare top recommendation theme across sources
  const alignment = useMemo(() => {
    const focus = intel?.bestCategory?.name?.toLowerCase() ?? "";
    if (!focus) return { score: 0, aligned: [] as string[], conflicts: [] as string[] };
    const aligned: string[] = [];
    const conflicts: string[] = [];
    const matches = (s: string) => s.toLowerCase().includes(focus);
    if (brief?.priorities?.some((p) => matches(p.title))) aligned.push("CEO Brief");
    else if (brief) conflicts.push("CEO Brief");
    if (consultant?.recommendations?.some((r) => matches(r.title))) aligned.push("Consultant");
    else if (consultant) conflicts.push("Consultant");
    if (missionInitiatives.some((m) => matches(m.title))) aligned.push("Mission Control");
    if (meetings.some((m) => matches(m.topic))) aligned.push("Boardroom");
    const score = aligned.length / Math.max(1, aligned.length + conflicts.length);
    return { score: Math.round(score * 100), aligned, conflicts };
  }, [intel, brief, consultant, missionInitiatives, meetings]);

  // Aggregated risks
  const risks = useMemo<AggRisk[]>(() => {
    const out: AggRisk[] = [];
    if (consultant) {
      for (const p of consultant.problems || []) {
        out.push({
          title: p.title,
          severity: p.severity,
          source: "Consultant",
          owner: "Strategy",
          mitigation: p.strategic_recommendation || "-",
          status: "Open",
        });
      }
    }
    if (brief) {
      for (const r of brief.risks || []) {
        out.push({
          title: r.title,
          severity: r.severity,
          source: "CEO Brief",
          owner: "CEO",
          mitigation: r.description,
          status: "Monitoring",
        });
      }
    }
    if (intel) {
      if (intel.customerConcentrationPct >= 35) {
        out.push({
          title: `Customer concentration ${fmtPct(intel.customerConcentrationPct)}`,
          severity: intel.customerConcentrationPct >= 50 ? "high" : "med",
          source: "Mission Control",
          owner: "CRO",
          mitigation: "Launch top-10 diversification track; cap top-customer share <30%.",
          status: "Open",
        });
      }
      if (intel.categoryConcentrationPct >= 45) {
        out.push({
          title: `Category concentration ${fmtPct(intel.categoryConcentrationPct)}`,
          severity: intel.categoryConcentrationPct >= 60 ? "high" : "med",
          source: "Mission Control",
          owner: "CMO",
          mitigation: "Open second category vertical; 60-day discovery sprint.",
          status: "Open",
        });
      }
      if (intel.growthPct < 0) {
        out.push({
          title: `Negative growth ${fmtPct(intel.growthPct)}`,
          severity: "high",
          source: "Mission Control",
          owner: "CEO",
          mitigation: "Convene weekly revenue war-room; reforecast in 14 days.",
          status: "Open",
        });
      }
    }
    if (execStats.blocked > 0) {
      out.push({
        title: `${execStats.blocked} blocked initiative${execStats.blocked > 1 ? "s" : ""}`,
        severity: execStats.blocked >= 3 ? "high" : "med",
        source: "Execution Center",
        owner: "COO",
        mitigation: "Unblock owners via standup; escalate ≥7-day blocks.",
        status: "Active",
      });
    }
    return out;
  }, [consultant, brief, intel, execStats.blocked]);

  // Executive recommendations (merged & prioritized)
  const recommendations = useMemo<RecItem[]>(() => {
    const out: RecItem[] = [];
    if (consultant) {
      for (const r of consultant.recommendations || []) {
        const score = (r.impact ?? 0) - (r.effort ?? 0) * 0.4 - (r.strategic_risk ?? 0) * 0.2;
        const priority: ExecPriority = score >= 50 ? "Critical" : score >= 30 ? "High" : score >= 10 ? "Medium" : "Low";
        out.push({
          title: r.title,
          detail: r.description,
          source: "Consultant",
          priority,
          impact: r.expected_revenue_impact || "-",
          confidence: r.confidence ?? 70,
          owner: r.owner || "Strategy",
          timeline: r.timeframe || "60–90d",
        });
      }
    }
    if (brief) {
      for (const p of brief.priorities || []) {
        out.push({
          title: p.title,
          detail: "Executive priority from CEO Brief.",
          source: "CEO Brief",
          priority: "High",
          impact: "Strategic",
          confidence: 78,
          owner: p.owner || "CEO",
          timeline: p.due || "30d",
        });
      }
    }
    for (const m of missionInitiatives.slice(0, 4)) {
      out.push({
        title: m.title,
        detail: m.rationale,
        source: "Mission Control",
        priority: (m.priority as ExecPriority) || "Medium",
        impact: m.revenueImpact ? fmtMoney(m.revenueImpact) : "-",
        confidence: m.confidence ?? 70,
        owner: m.owner || "Exec",
        timeline: `${m.timelineDays ?? 60}d`,
      });
    }
    const order: Record<ExecPriority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    out.sort((a, b) => order[a.priority] - order[b.priority]);
    return out;
  }, [consultant, brief, missionInitiatives]);

  const filteredInitiatives = useMemo(() => {
    if (initStatusFilter === "All") return initiatives;
    return initiatives.filter((i) => {
      const s = String(i.status);
      if (initStatusFilter === "In Progress") return s === "In Progress" || s === "in_progress";
      if (initStatusFilter === "Completed") return s === "Completed" || s === "done";
      if (initStatusFilter === "Planned") return s === "Planned" || s === "not_started";
      if (initStatusFilter === "Blocked") return s === "Blocked";
      return true;
    });
  }, [initiatives, initStatusFilter]);

  async function assemble(): Promise<ReportContent | null> {
    if (!dataset) return null;
    return {
      title: `${dataset.name}, Executive Report`,
      datasetName: dataset.name,
      kpis,
      brief,
      consultant,
      plans,
    };
  }

  async function generate(kind: "pdf" | "pptx") {
    if (!dataset) {
      toast.error("Select a dataset first");
      return;
    }
    setBusy(kind);
    try {
      const content = await assemble();
      if (!content) return;
      const blob = kind === "pdf" ? exportPdf(content) : await exportPptx(content);
      const filename = `${dataset.name.replace(/\s+/g, "_")}_executive.${kind}`;
      downloadBlob(blob, filename);
      await saveReport({ dataset_id: dataset.id, kind, title: content.title, storage_path: null });
      await qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(`${kind.toUpperCase()} report generated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function generateBrief() {
    if (!dataset || !intel) {
      toast.error("Select a dataset first");
      return;
    }
    setBusy("brief");
    try {
      const lines: string[] = [];
      lines.push(`EXECUTIVE BRIEF, ${dataset.name}`);
      lines.push(new Date().toLocaleString());
      lines.push("");
      lines.push("HEALTH");
      lines.push(`  Business Health: ${healthScore}/100`);
      lines.push(`  Growth Potential: ${growthScore}/100`);
      lines.push(`  Risk Exposure: ${riskScore}/100`);
      lines.push(`  Execution Score: ${executionScore}/100`);
      lines.push("");
      lines.push("PERFORMANCE");
      lines.push(`  Revenue: ${fmtMoney(intel.totalRevenue)}`);
      lines.push(`  Profit: ${fmtMoney(intel.totalProfit)}`);
      lines.push(`  Margin: ${fmtPct(intel.marginPct)}`);
      lines.push(`  Growth: ${fmtPct(intel.growthPct)}`);
      lines.push("");
      lines.push("TOP RECOMMENDATIONS");
      for (const r of recommendations.slice(0, 5)) {
        lines.push(`  [${r.priority}] ${r.title}, ${r.owner} · ${r.timeline} · impact ${r.impact}`);
      }
      lines.push("");
      lines.push("OPEN RISKS");
      for (const r of risks.slice(0, 6)) {
        lines.push(`  [${r.severity.toUpperCase()}] ${r.title} (${r.source}) → ${r.mitigation}`);
      }
      const facts = lines.join("\n");
      // AI brain writes the narrative from the assembled facts; fall back to the
      // raw facts if the brain is unavailable.
      const { system, user } = buildReportBriefPrompt(facts);
      const res = await callBrain({ section: "report-brief", system, user });
      const narrative = res.ok && res.text.trim() ? res.text.trim() : null;
      // Stamp provenance onto the artifact itself so the document is honest
      // wherever it travels, not just via a transient toast.
      const provenance = narrative
        ? "SOURCE: Live AI narrative (AWS Bedrock), grounded in the figures below."
        : `SOURCE: Built-in analysis (${res.ok ? "live AI returned no text" : brainErrorMessage(res.error)}). Figures derived deterministically from your data.`;
      const body = narrative
        ? `EXECUTIVE BRIEF, ${dataset.name}\n${new Date().toLocaleString()}\n${provenance}\n\n${narrative}\n\n- SUPPORTING DETAIL -\n${facts}`
        : `${provenance}\n\n${facts}`;
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      const filename = `${dataset.name.replace(/\s+/g, "_")}_brief.txt`;
      downloadBlob(blob, filename);
      saveLocalBrief({
        id: crypto.randomUUID(),
        title: `${dataset.name}, Executive Brief`,
        created_at: new Date().toISOString(),
        body,
        source: narrative ? "ai" : "builtin",
      });
      toast.success(narrative ? "AI executive brief generated" : "Executive brief generated (built-in)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const localBriefs = readLocalBriefs();

  if (!dataset) {
    return (
      <>
        <PageHeader
          eyebrow="08, Reports"
          title="Executive Reports"
          description="Board-ready outputs synthesized from Dashboard, CEO Brief, Consultant, Mission Control, AI Boardroom and Execution Center."
        />
        <EmptyState
          title="Select a dataset"
          description="Reports compile every analysis run on a dataset. Pick one in the sidebar."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="08, Reports"
        title="Executive Reports"
        description="Board-ready outputs synthesized from every ExecutiveOS module. Sections refresh automatically as source modules change."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => generate("pdf")} disabled={busy !== null}>
              <FileText className="h-4 w-4 mr-2" /> {busy === "pdf" ? "Generating…" : "PDF"}
            </Button>
            <Button onClick={() => generate("pptx")} disabled={busy !== null}>
              <Presentation className="h-4 w-4 mr-2" /> {busy === "pptx" ? "Generating…" : "Board Deck"}
            </Button>
          </div>
        }
      />

      {/* SECTION 01, Executive Summary */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<Sparkles className="h-4 w-4" />} eyebrow="Section 01" title="Executive Summary" />
        <div className="grid lg:grid-cols-[auto_1fr] gap-8 items-start">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <ScoreRing value={healthScore} label="Business Health" tone={healthScore >= 70 ? "success" : healthScore >= 50 ? "warning" : "destructive"} />
            <ScoreRing value={growthScore} label="Growth" tone={growthScore >= 65 ? "success" : "warning"} />
            <ScoreRing value={100 - riskScore} label="Risk Posture" tone={riskScore <= 40 ? "success" : riskScore <= 65 ? "warning" : "destructive"} />
            <ScoreRing value={executionScore} label="Execution" tone={executionScore >= 65 ? "success" : executionScore >= 40 ? "warning" : "destructive"} />
          </div>
          <div className="space-y-3 text-sm leading-relaxed">
            {intel && (
              <>
                <p>
                  <strong className="text-foreground">Performance.</strong>{" "}
                  Revenue {fmtMoney(intel.totalRevenue)} on {fmtPct(intel.marginPct)} margin, trending {intel.trendDirection} at {fmtPct(intel.growthPct)} with {intel.trendConsistency}/100 consistency.
                </p>
                <p>
                  <strong className="text-foreground">Outlook.</strong>{" "}
                  Forecast upside +{fmtPct(intel.forecastUpsidePct)} if focus on{" "}
                  {intel.bestCategory?.name ?? "lead category"}{intel.bestRegion ? ` in ${intel.bestRegion.name}` : ""} holds.
                </p>
                <p>
                  <strong className="text-foreground">Key risks.</strong>{" "}
                  Category concentration {fmtPct(intel.categoryConcentrationPct)} · Customer concentration {fmtPct(intel.customerConcentrationPct)} · {risks.filter((r) => r.severity === "high").length} high-severity open.
                </p>
                <p>
                  <strong className="text-foreground">Priorities.</strong>{" "}
                  {recommendations.slice(0, 3).map((r) => r.title).join(" · ") || "-"}.
                </p>
                <p>
                  <strong className="text-foreground">Execution.</strong>{" "}
                  {execStats.total} initiatives · {execStats.completed} completed · {execStats.inProgress} in progress · {execStats.blocked} blocked · avg progress {execStats.avgProgress}%.
                </p>
                <p>
                  <strong className="text-foreground">Executive Memory.</strong>{" "}
                  {decisionStats.total} decisions on record · {decisionStats.thisQuarter} this quarter · {decisionStats.completed} completed · execution success {decisionStats.successRate}% · avg consensus {decisionStats.avgConsensus}/100 · avg confidence {decisionStats.avgConfidence}%.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 02, Strategy Report */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<Target className="h-4 w-4" />} eyebrow="Section 02" title="Strategy Report"
          right={
            <Badge variant="outline" className={alignment.score >= 70 ? "border-success/30 text-success" : alignment.score >= 40 ? "border-warning/30 text-warning" : "border-destructive/30 text-destructive"}>
              Alignment {alignment.score}%
            </Badge>
          }
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StrategyCol title="CEO Recommendations" items={(brief?.priorities ?? []).map((p) => `${p.title} · ${p.owner}`)} />
          <StrategyCol title="Consultant Recommendations" items={(consultant?.recommendations ?? []).slice(0, 5).map((r) => `${r.title} (${r.timeframe})`)} />
          <StrategyCol title="Mission Priorities" items={missionInitiatives.slice(0, 5).map((m) => `[${m.priority}] ${m.title}`)} />
          <StrategyCol title="Boardroom Decisions" items={meetings.slice(0, 5).map((m) => m.topic)} />
        </div>
        {(alignment.aligned.length || alignment.conflicts.length) > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {alignment.aligned.map((s) => (
              <Badge key={s} variant="outline" className="border-success/30 text-success">Aligned · {s}</Badge>
            ))}
            {alignment.conflicts.map((s) => (
              <Badge key={s} variant="outline" className="border-warning/30 text-warning">Drift · {s}</Badge>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 03, Initiative Performance */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<Briefcase className="h-4 w-4" />} eyebrow="Section 03" title="Initiative Performance"
          right={
            <Select value={initStatusFilter} onValueChange={setInitStatusFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["All", "Planned", "In Progress", "Completed", "Blocked"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {filteredInitiatives.length === 0 ? (
          <p className="text-sm text-muted-foreground">No initiatives recorded in Execution Center for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left">Initiative</th>
                  <th className="text-left">Owner</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Progress</th>
                  <th className="text-left">Due</th>
                  <th className="text-right">Rev Impact</th>
                  <th className="text-right">Profit Impact</th>
                </tr>
              </thead>
              <tbody>
                {filteredInitiatives.map((i) => (
                  <tr key={i.id} className="border-b border-border/40">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{i.title}</div>
                      {i.description && <div className="text-xs text-muted-foreground line-clamp-1">{i.description}</div>}
                    </td>
                    <td className="pr-3 text-xs">{i.owner}</td>
                    <td className="pr-3">
                      <Badge variant="outline" className={statusTone[String(i.status)] ?? ""}>{String(i.status)}</Badge>
                    </td>
                    <td className="pr-3 w-32"><Progress value={i.progress ?? 0} className="h-1.5" /></td>
                    <td className="pr-3 text-xs">{i.dueDate ? new Date(i.dueDate).toLocaleDateString() : i.dueDays ? `${i.dueDays}d` : "-"}</td>
                    <td className="text-right tabular-nums">{i.revenueImpact ? fmtMoney(i.revenueImpact) : "-"}</td>
                    <td className="text-right tabular-nums">{i.profitImpact ? fmtMoney(i.profitImpact) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 04, KPI Report */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<TrendingUp className="h-4 w-4" />} eyebrow="Section 04" title="KPI Report" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-2 text-left">KPI</th>
                <th className="text-left">Current</th>
                <th className="text-left">Target</th>
                <th className="text-left">Progress</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {kpiTargets.map((k) => (
                <tr key={k.key} className="border-b border-border/40">
                  <td className="py-2 pr-3 font-medium">{k.label}</td>
                  <td className="pr-3 tabular-nums">{k.current}</td>
                  <td className="pr-3 tabular-nums text-muted-foreground">{k.target}</td>
                  <td className="pr-3 w-40"><Progress value={k.progress} className="h-1.5" /></td>
                  <td>
                    <Badge variant="outline" className={
                      k.status === "Achieved" ? "border-success/30 text-success"
                      : k.status === "On Track" ? "border-secondary/30 text-secondary"
                      : k.status === "At Risk" ? "border-warning/30 text-warning"
                      : "border-destructive/30 text-destructive"
                    }>{k.status}</Badge>
                  </td>
                </tr>
              ))}
              {intel && (
                <>
                  <KpiRow label="Customer Concentration" current={fmtPct(intel.customerConcentrationPct)} target="≤ 30%" progress={Math.max(0, 100 - intel.customerConcentrationPct)} good={intel.customerConcentrationPct <= 30} risk={intel.customerConcentrationPct >= 50} />
                  <KpiRow label="Category Diversification" current={fmtPct(100 - intel.categoryConcentrationPct)} target="≥ 60%" progress={100 - intel.categoryConcentrationPct} good={intel.categoryConcentrationPct <= 40} risk={intel.categoryConcentrationPct >= 65} />
                  <KpiRow label="Regional Expansion" current={`${intel.regions.length} regions`} target="≥ 5" progress={Math.min(100, (intel.regions.length / 5) * 100)} good={intel.regions.length >= 5} risk={intel.regions.length <= 2} />
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 05, Risk Report */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<ShieldAlert className="h-4 w-4" />} eyebrow="Section 05" title="Risk Report" />
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active risks identified across modules.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left">Risk</th>
                  <th className="text-left">Severity</th>
                  <th className="text-left">Source</th>
                  <th className="text-left">Owner</th>
                  <th className="text-left">Mitigation</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {risks.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{r.title}</td>
                    <td className="pr-3"><Badge variant="outline" className={sevTone[r.severity]}>{r.severity.toUpperCase()}</Badge></td>
                    <td className="pr-3 text-xs">{r.source}</td>
                    <td className="pr-3 text-xs">{r.owner}</td>
                    <td className="pr-3 text-xs text-muted-foreground max-w-md">{r.mitigation}</td>
                    <td className="text-xs">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 06, Boardroom History */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<Activity className="h-4 w-4" />} eyebrow="Section 06" title="Boardroom History" />
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded boardroom meetings yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {meetings.map((m) => {
              const meta = parseMeetingMeta(m);
              return (
                <button key={m.id} onClick={() => setOpenMeeting(m)} className="w-full text-left py-3 grid grid-cols-[1fr_auto] gap-4 hover:bg-muted/30 px-2 -mx-2 rounded">
                  <div>
                    <p className="text-sm font-medium">{m.topic}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{meta.decision || "Open transcript →"}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {meta.consensus !== null && <Badge variant="outline">Consensus {meta.consensus}%</Badge>}
                    {meta.revenueImpact && <Badge variant="outline" className="border-success/30 text-success">{meta.revenueImpact}</Badge>}
                    {meta.risk && <Badge variant="outline" className={sevTone[meta.risk]}>{meta.risk.toUpperCase()}</Badge>}
                    <span className="text-muted-foreground">{new Date(m.created_at || "").toLocaleDateString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 07, Executive Recommendations */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<CheckCircle2 className="h-4 w-4" />} eyebrow="Section 07" title="Executive Recommendations" />
        {recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendations available.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-4 bg-background/40">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <Badge variant="outline" className={priorityTone[r.priority]}>{r.priority}</Badge>
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">{r.source}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">Confidence {r.confidence}%</Badge>
                </div>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.detail}</p>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div><span className="text-muted-foreground">Impact</span><div className="font-medium">{r.impact}</div></div>
                  <div><span className="text-muted-foreground">Owner</span><div className="font-medium">{r.owner}</div></div>
                  <div><span className="text-muted-foreground">Timeline</span><div className="font-medium">{r.timeline}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 08, Export Center */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<Download className="h-4 w-4" />} eyebrow="Section 08" title="Export Center" />
        <div className="grid sm:grid-cols-3 gap-3 mb-5">
          <Button variant="outline" onClick={() => generate("pdf")} disabled={busy !== null} className="justify-start">
            <FileText className="h-4 w-4 mr-2" /> {busy === "pdf" ? "Generating…" : "Generate PDF Report"}
          </Button>
          <Button variant="outline" onClick={() => generate("pptx")} disabled={busy !== null} className="justify-start">
            <Presentation className="h-4 w-4 mr-2" /> {busy === "pptx" ? "Generating…" : "Generate Board Deck"}
          </Button>
          <Button variant="outline" onClick={generateBrief} disabled={busy !== null} className="justify-start">
            <Sparkles className="h-4 w-4 mr-2" /> {busy === "brief" ? "Generating…" : "Generate Executive Brief"}
          </Button>
        </div>
        <Tabs defaultValue="cloud">
          <TabsList>
            <TabsTrigger value="cloud">Generated Reports</TabsTrigger>
            <TabsTrigger value="local">Local Briefs</TabsTrigger>
          </TabsList>
          <TabsContent value="cloud" className="mt-3">
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reports generated yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {reports.slice(0, 12).map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      {r.kind === "pdf" ? <FileText className="h-4 w-4 text-secondary" /> : <Presentation className="h-4 w-4 text-secondary" />}
                      <div>
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">{r.kind.toUpperCase()} · {new Date(r.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <Clock className="h-3 w-3 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="local" className="mt-3">
            {localBriefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No local briefs yet. Generate one above.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {localBriefs.map((b) => (
                  <button key={b.id}
                    onClick={() => downloadBlob(new Blob([b.body], { type: "text/plain" }), `${b.title.replace(/\s+/g, "_")}.txt`)}
                    className="w-full text-left flex items-center justify-between py-2 hover:bg-muted/30 px-2 -mx-2 rounded">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        {b.title}
                        {b.source && (
                          <span className={`text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded border ${b.source === "ai" ? "bg-secondary/15 text-secondary border-secondary/30" : "bg-warning/15 text-warning border-warning/30"}`}>
                            {b.source === "ai" ? "Live AI" : "Built-in"}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()}</p>
                    </div>
                    <Download className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* SECTION 09, Historical Trends */}
      <section className="executive-card rounded-xl p-6 mb-6">
        <SectionHeader icon={<TrendingUp className="h-4 w-4" />} eyebrow="Section 09" title="Historical Trends" />
        {trendData.length < 2 ? (
          <p className="text-sm text-muted-foreground">Trend chart appears after multiple visits. Current snapshot captured.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <RTooltip contentStyle={{ background: "var(--color-background)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Health" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Strategy" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Execution" stroke="var(--color-chart-3)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Consensus" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Meeting transcript */}
      <Dialog open={!!openMeeting} onOpenChange={(o) => !o && setOpenMeeting(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openMeeting?.topic}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {openMeeting?.messages?.map((m) => (
              <div key={m.id} className="rounded-lg border border-border/50 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{m.agent}</p>
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SectionHeader({ icon, eyebrow, title, right }: { icon: React.ReactNode; eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1 flex items-center gap-2">{icon}{eyebrow}</p>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function StrategyCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 bg-background/40">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No items.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((s, i) => (
            <li key={i} className="leading-snug">• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiRow({ label, current, target, progress, good, risk }: { label: string; current: string; target: string; progress: number; good: boolean; risk: boolean }) {
  const status = good ? "On Track" : risk ? "Off Track" : "At Risk";
  const tone = good ? "border-success/30 text-success" : risk ? "border-destructive/30 text-destructive" : "border-warning/30 text-warning";
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-3 font-medium">{label}</td>
      <td className="pr-3 tabular-nums">{current}</td>
      <td className="pr-3 tabular-nums text-muted-foreground">{target}</td>
      <td className="pr-3 w-40"><Progress value={Math.max(0, Math.min(100, progress))} className="h-1.5" /></td>
      <td><Badge variant="outline" className={tone}>{status}</Badge></td>
    </tr>
  );
}

function parseMeetingMeta(m: BoardroomConversation): { decision: string | null; consensus: number | null; revenueImpact: string | null; risk: "low" | "med" | "high" | null } {
  let decision: string | null = null;
  let consensus: number | null = null;
  let revenueImpact: string | null = null;
  let risk: "low" | "med" | "high" | null = null;
  for (const msg of m.messages || []) {
    const c = msg.content || "";
    if (!decision && /decision/i.test(c)) decision = c.split("\n")[0].slice(0, 160);
    const cm = c.match(/consensus[^0-9]*(\d{1,3})/i);
    if (cm && consensus === null) consensus = Math.min(100, parseInt(cm[1], 10));
    const rm = c.match(/\$[\d,.]+[MK]?/);
    if (rm && !revenueImpact) revenueImpact = rm[0];
    if (!risk) {
      if (/high risk/i.test(c)) risk = "high";
      else if (/medium risk|moderate risk/i.test(c)) risk = "med";
      else if (/low risk/i.test(c)) risk = "low";
    }
  }
  return { decision, consensus, revenueImpact, risk };
}

// Lint stub: silence unused warning if AlertTriangle isn't referenced.
void AlertTriangle;
