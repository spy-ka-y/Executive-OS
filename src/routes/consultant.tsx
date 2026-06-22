import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
} from "recharts";
import { Sparkles, AlertTriangle, ShieldAlert, ShieldCheck, TrendingUp, Target, Briefcase } from "lucide-react";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/score-ring";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import { generateConsultantReport } from "@/lib/api/ai";
import { latestConsultantReport, saveConsultantReport } from "@/lib/api/persistence";
import { GenerationSourceBadge, GenerationSourceNotice } from "@/components/generation-source";
import { useIndustry } from "@/lib/industry-context";
import type { ConsultantProblem, GenerationMeta } from "@/lib/api/types";

export const Route = createFileRoute("/consultant")({
  head: () => ({ meta: [{ title: "Consultant Report, ExecutiveOS" }] }),
  component: ConsultantPage,
});

const SEVERITY_STYLES: Record<ConsultantProblem["severity"], { label: string; cls: string; tone: string }> = {
  high: { label: "High Severity", cls: "bg-destructive/15 text-destructive border-destructive/30", tone: "var(--color-destructive)" },
  med: { label: "Medium Severity", cls: "bg-warning/15 text-warning border-warning/30", tone: "var(--color-warning)" },
  low: { label: "Low Severity", cls: "bg-secondary/15 text-secondary border-secondary/30", tone: "var(--color-chart-3)" },
};

function ConsultantPage() {
  const qc = useQueryClient();
  const { activeDatasetId } = useActiveDataset();
  const { industryId } = useIndustry();
  const [busy, setBusy] = useState(false);
  const [sessionMeta, setSessionMeta] = useState<GenerationMeta | undefined>(undefined);

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
  const { data: report } = useQuery({
    queryKey: ["consultant", activeDatasetId],
    queryFn: () => (activeDatasetId ? latestConsultantReport(activeDatasetId) : null),
    enabled: !!activeDatasetId,
  });

  async function regenerate() {
    if (!activeDatasetId || !dataset || !rows.length) return;
    setBusy(true);
    try {
      const kpis = computeKpis(rows, dataset.schema);
      const next = await generateConsultantReport({
        dataset_id: activeDatasetId,
        kpis,
        rows,
        schema: dataset.schema,
        industry: industryId,
      });
      setSessionMeta(next.meta);
      await saveConsultantReport(next);
      await qc.invalidateQueries({ queryKey: ["consultant", activeDatasetId] });
      toast.success("Strategic findings regenerated for this dataset");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!activeDatasetId) {
    return (
      <>
        <PageHeader eyebrow="04, Consultant Report" title="AI Strategy Consulting" />
        <EmptyState title="Select a dataset" description="Choose a dataset in the sidebar to run a consultant-grade analysis." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="04, Consultant Report"
        title="AI Strategy Consulting"
        description="Dataset-specific strategic findings, opportunity matrix, and an executive investment thesis."
        actions={
          <Button onClick={regenerate} disabled={busy}>
            <Sparkles className={`h-4 w-4 mr-2 ${busy ? "animate-pulse" : ""}`} />
            {busy ? "Analyzing…" : report ? "Regenerate Analysis" : "Generate Analysis"}
          </Button>
        }
      />

      {!report ? (
        <EmptyState
          title="No analysis yet"
          description="Generate the first consultant-grade analysis for this dataset."
          action={
            <Button onClick={regenerate} disabled={busy}>
              <Sparkles className={`h-4 w-4 mr-2 ${busy ? "animate-pulse" : ""}`} /> {busy ? "Analyzing…" : "Generate Analysis"}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <GenerationSourceNotice meta={sessionMeta ?? report.meta} />
          {/* Agent banner */}
          <div className="executive-card rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center h-7 w-7 rounded-md bg-secondary/15 border border-secondary/30 text-secondary font-display text-[10px]">
                CNS
              </span>
              <div>
                <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Generated By</p>
                <p className="text-xs font-medium leading-tight">Strategy Consulting Agent</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <GenerationSourceBadge meta={sessionMeta ?? report.meta} />
              <span className="hidden sm:inline text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {dataset?.name ?? ""}
              </span>
            </div>
          </div>

          {/* Strategic Scores */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="executive-card rounded-xl p-6 flex flex-col items-center">
              <ScoreRing value={report.impact_score} label="Growth Potential" tone="success" />
              <p className="text-[11px] text-muted-foreground mt-3 text-center max-w-[18ch]">
                Upside available if the recommended initiatives execute.
              </p>
            </div>
            <div className="executive-card rounded-xl p-6 flex flex-col items-center">
              <ScoreRing value={report.roi_score} label="Execution Difficulty" tone="warning" />
              <p className="text-[11px] text-muted-foreground mt-3 text-center max-w-[22ch]">
                Operational complexity of capturing that upside.
              </p>
            </div>
            <div className="executive-card rounded-xl p-6 flex flex-col items-center">
              <ScoreRing
                value={report.risk_score}
                label="Strategic Risk"
                tone={report.risk_score > 60 ? "destructive" : "warning"}
              />
              <p className="text-[11px] text-muted-foreground mt-3 text-center max-w-[22ch]">
                Concentration, margin, and forecast exposure today.
              </p>
            </div>
          </div>

          {/* Strategic Findings */}
          <div className="executive-card rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h2 className="font-display text-2xl">Strategic Findings</h2>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              {report.problems.map((p, i) => {
                const sev = SEVERITY_STYLES[p.severity ?? "low"];
                return (
                  <div key={i} className="rounded-lg border border-border/60 p-4 space-y-3 bg-card/40">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-sm leading-snug">{p.title}</p>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${sev.cls}`}>{sev.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                    <div className="grid grid-cols-1 gap-2 pt-2 border-t border-border/40">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Evidence</p>
                        <p className="text-[11px] text-foreground/90">{p.evidence}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Financial Exposure</p>
                        <p className="text-[11px] text-foreground/90">{p.financial_exposure ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-secondary">Strategic Recommendation</p>
                        <p className="text-[11px] text-foreground/90">{p.strategic_recommendation ?? "-"}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Opportunity Matrix */}
          <div className="executive-card rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-4 w-4 text-primary" />
              <h2 className="font-display text-2xl">Executive Opportunity Matrix</h2>
            </div>
            <div className="h-80">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="effort"
                    name="Execution Difficulty"
                    domain={[0, 100]}
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    label={{
                      value: "Execution Difficulty →",
                      fill: "var(--color-muted-foreground)",
                      fontSize: 10,
                      position: "insideBottom",
                      offset: -8,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="impact"
                    name="Growth Potential"
                    domain={[0, 100]}
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    label={{
                      value: "Growth Potential →",
                      fill: "var(--color-muted-foreground)",
                      fontSize: 10,
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <ZAxis type="number" dataKey="confidence" range={[100, 380]} name="Confidence" />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as (typeof report.recommendations)[number];
                      return (
                        <div className="rounded-md border border-border bg-card/95 px-3 py-2 shadow-lg text-xs space-y-1">
                          <p className="font-medium text-sm">{d.title}</p>
                          <p className="text-muted-foreground">Growth Potential: {d.impact}/100</p>
                          <p className="text-muted-foreground">Execution Difficulty: {d.effort}/100</p>
                          <p className="text-muted-foreground">Confidence: {Math.round(d.confidence ?? 0)}/100</p>
                          <p className="text-secondary">{d.expected_revenue_impact}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={report.recommendations} fill="var(--color-chart-3)">
                    {report.recommendations.map((r, i) => (
                      <Cell
                        key={i}
                        fill={
                          (r.strategic_risk ?? 0) > 50
                            ? "var(--color-destructive)"
                            : r.impact >= 75
                            ? "var(--color-success)"
                            : "var(--color-chart-1)"
                        }
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Top-left = highest-conviction quick wins. Bubble size = confidence; color = strategic risk.
            </p>
          </div>

          {/* Recommendations */}
          <div className="executive-card rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="h-4 w-4 text-secondary" />
              <h2 className="font-display text-2xl">Business Initiatives</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60">
                    <th className="py-2 pr-4">Initiative</th>
                    <th className="py-2 pr-4">Expected Revenue Impact</th>
                    <th className="py-2 pr-4">Confidence</th>
                    <th className="py-2 pr-4">Timeline</th>
                    <th className="py-2">Recommended Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recommendations.map((r, i) => (
                    <tr key={i} className="border-b border-border/40 align-top">
                      <td className="py-3 pr-4 max-w-[28rem]">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                      </td>
                      <td className="py-3 pr-4 font-display text-base text-success whitespace-nowrap">
                        {r.expected_revenue_impact ?? "-"}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-border/60 overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, Math.max(0, r.confidence ?? 0))}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium tabular-nums">{Math.round(r.confidence ?? 0)}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">{r.timeframe}</td>
                      <td className="py-3 text-foreground/90 whitespace-nowrap">{r.owner ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Investment Thesis */}
          {report.investment_thesis && (
            <div className="executive-card rounded-xl p-6 border border-secondary/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-secondary" />
                  <h2 className="font-display text-2xl">Executive Investment Thesis</h2>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-secondary/10 text-secondary border-secondary/30">
                  Posture: {report.investment_thesis.posture}
                </Badge>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="rounded-lg border border-border/60 p-4 bg-card/40">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Revenue Upside</p>
                  </div>
                  <p className="text-sm font-medium text-foreground/95 leading-snug">
                    {report.investment_thesis.revenue_upside}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4 bg-card/40">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Margin Improvement</p>
                  </div>
                  <p className="text-sm font-medium text-foreground/95 leading-snug">
                    {report.investment_thesis.margin_improvement}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4 bg-card/40">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Risk Reduction</p>
                  </div>
                  <p className="text-sm font-medium text-foreground/95 leading-snug">
                    {report.investment_thesis.risk_reduction}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/5 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-secondary mb-1.5">Consultant Verdict</p>
                <p className="text-sm leading-relaxed text-foreground/95">{report.investment_thesis.verdict}</p>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">Upside/margin figures are illustrative estimates scaled from your revenue and margin, contingent on execution, not modeled forecasts.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
