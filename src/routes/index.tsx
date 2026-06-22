import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  Upload, Trash2, TrendingUp, AlertTriangle, Sparkles, Database,
  LineChart as LineIcon, Brain, Activity, Crown, ArrowRight, ArrowUpRight, CheckCircle2,
  Tag, Calendar, MapPin, Target, Lightbulb, ShieldAlert, Compass, Trophy, ChevronDown,
  Search, Gauge, Clock, Users, Briefcase, ListChecks, FileBarChart, ScrollText,
  MessageSquareText, SlidersHorizontal, Signal, GitBranch,
} from "lucide-react";
import { ScoreRing } from "@/components/score-ring";
import { cn } from "@/lib/utils";

import { EmptyState } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataQualityPanel } from "@/components/data-quality-panel";
import { Button } from "@/components/ui/button";
import { useActiveDataset } from "@/lib/dataset-context";
import {
  createDataset,
  deleteDataset,
  getDataset,
  getDatasetRows,
  listDatasets,
} from "@/lib/api/datasets";
import { computeKpis, forecastRevenue } from "@/lib/api/analysis";
import { saveForecast, saveKpiSummary } from "@/lib/api/persistence";
import type { DatasetRow, DatasetColumn } from "@/lib/api/types";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard, ExecutiveOS" },
      { name: "description", content: "Your private AI-powered executive headquarters, what to focus on right now, across signals, decisions and your executive team." },
    ],
  }),
  component: DashboardPage,
});

function parseFile(file: File): Promise<DatasetRow[]> {
  return new Promise((resolve, reject) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || file.type === "text/csv") {
      Papa.parse<DatasetRow>(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (res) => resolve((res.data ?? []).filter((r) => r && Object.keys(r).length > 0)),
        error: reject,
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<DatasetRow>(sheet, { defval: null });
        resolve(rows);
      } catch (e) { reject(e); }
    };
    reader.readAsBinaryString(file);
  });
}

// Shared dashboard data, consumed by the dashboard hero and the section routes.
export function useDashboardData() {
  const { activeDatasetId } = useActiveDataset();
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
  const kpis = useMemo(() => {
    if (!dataset || rows.length === 0) return null;
    return computeKpis(rows, dataset.schema);
  }, [dataset, rows]);
  const forecast = useMemo(() => (kpis ? forecastRevenue(kpis.series, 6) : null), [kpis]);
  const intel = useMemo(
    () => (dataset && rows.length ? computeIntelligence(rows, dataset.schema) : null),
    [dataset, rows],
  );
  const hasData = !!dataset && !!kpis;
  return { dataset: dataset ?? null, rows, kpis, forecast, intel, hasData };
}

function DashboardPage() {
  const qc = useQueryClient();
  const { setActiveDatasetId } = useActiveDataset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { dataset, rows, kpis, forecast, intel, hasData } = useDashboardData();

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const parsed = await parseFile(file);
      if (!parsed.length) throw new Error("No rows detected in file");
      const ds = await createDataset({
        name: file.name.replace(/\.(csv|xlsx?|xls)$/i, ""),
        source_filename: file.name,
        rows: parsed,
      });
      const freshRows = await getDatasetRows(ds.id);
      const summary = computeKpis(freshRows, ds.schema);
      await saveKpiSummary(ds.id, summary);
      await saveForecast(ds.id, forecastRevenue(summary.series, 6));
      setActiveDatasetId(ds.id);
      await qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Uploaded ${ds.name} (${parsed.length.toLocaleString()} rows)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  const openUpload = () => inputRef.current?.click();
  const resolvedIntel = intel ?? (hasData && dataset ? computeIntelligence(rows, dataset.schema) : null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUpload(f);
          e.target.value = "";
        }}
      />

      {/* Hero, Executive Brief */}
      <ExecutiveBrief
        kpis={kpis}
        forecast={forecast}
        intel={resolvedIntel}
        hasData={hasData}
        uploading={uploading}
        onUpload={openUpload}
      />

      {/* Data quality, so trust is earned before the numbers are read */}
      {hasData && dataset && <DataQualityPanel schema={dataset.schema} rows={rows} />}

      {/* Landing analytics overview, just the gist */}
      {hasData && <AnalyticsOverview kpis={kpis!} forecast={forecast} intel={resolvedIntel!} />}

      {/* Section navigation, the three sections live on their own pages */}
      <DashboardSectionLinks />
    </>
  );
}

const DASHBOARD_SECTIONS = [
  { to: "/signals", index: "01", title: "Strategic Signals", caption: "Board-ready conclusions, KPIs, trend, forecast and anomalies.", icon: Signal },
  { to: "/decisions", index: "02", title: "Decisions Requiring Attention", caption: "What needs your call, escalated from signals and risk.", icon: GitBranch },
  { to: "/team", index: "03", title: "Executive Team Activity", caption: "Your AI C-suite and what each officer is working on now.", icon: Activity },
] as const;

function DashboardSectionLinks() {
  return (
    <section className="mt-20">
      <div className="flex items-baseline gap-4 mb-8">
        <h2 className="font-display text-3xl lg:text-4xl tracking-tight">Explore your briefing</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {DASHBOARD_SECTIONS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="group executive-card rounded-3xl p-8 flex flex-col transition-all hover:-translate-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="grid place-items-center h-11 w-11 rounded-2xl bg-[var(--color-rose)]/12 text-[var(--color-rose)]">
                <s.icon className="h-5 w-5" />
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-secondary transition-colors" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-secondary mt-6">{s.index}</p>
            <h3 className="font-display text-2xl mt-1 leading-tight">{s.title}</h3>
            <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">{s.caption}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── Shared structure ────────────────────────── */

function CollapsibleSection({
  id, index, title, caption, open, onToggle, children,
}: {
  id: string; index: string; title: string; caption?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-20 scroll-mt-28">
      <button onClick={onToggle} className="w-full text-left group" aria-expanded={open}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <span className="font-display text-2xl text-secondary/80 leading-none">{index}</span>
            <h2 className="font-display text-3xl lg:text-4xl tracking-tight">{title}</h2>
          </div>
          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-full border border-border text-muted-foreground group-hover:text-foreground group-hover:border-foreground/25 transition-colors">
            <ChevronDown className={cn("h-5 w-5 transition-transform duration-300", open && "rotate-180")} />
          </span>
        </div>
        {caption && <p className="text-sm text-muted-foreground mt-2.5 ml-[2.6rem] max-w-2xl">{caption}</p>}
      </button>
      <div className="section-divider mt-6" />
      {open && <div className="mt-8">{children}</div>}
    </section>
  );
}

// Landing-level analytics gist, key numbers only; full breakdown lives in Strategic Signals.
function AnalyticsOverview({
  kpis,
  forecast,
  intel,
}: {
  kpis: NonNullable<ReturnType<typeof computeKpis>>;
  forecast: ReturnType<typeof forecastRevenue> | null;
  intel: Intelligence;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
  const totalRevenue = kpis.series.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const growth = kpis.metrics.find((m) => m.key === "growth")?.value ?? 0;
  const margin = kpis.metrics.find((m) => m.key === "margin")?.value ?? 0;
  let forecastPct = 0;
  if (forecast && forecast.series.length >= 2 && kpis.series.length) {
    const baseline = kpis.series[kpis.series.length - 1]?.revenue ?? 0;
    const future = forecast.series[forecast.series.length - 1]?.value ?? baseline;
    forecastPct = baseline ? ((future - baseline) / baseline) * 100 : 0;
  }

  const items = [
    { label: "Total Revenue", value: fmt(totalRevenue), tone: "foreground" },
    { label: "Growth", value: `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`, tone: growth >= 0 ? "success" : "destructive" },
    { label: "Margin", value: `${margin.toFixed(1)}%`, tone: "foreground" },
    { label: "Forecast", value: `${forecastPct >= 0 ? "+" : ""}${forecastPct.toFixed(1)}%`, tone: forecastPct >= 0 ? "success" : "destructive" },
    { label: "Top Opportunity", value: intel.opportunityHeadline, tone: "foreground" },
  ];
  const toneClass = (t: string) => (t === "success" ? "text-success" : t === "destructive" ? "text-destructive" : "text-foreground");

  return (
    <section className="executive-card rounded-3xl p-8 mt-8">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-[11px] uppercase tracking-[0.28em] text-secondary">Analytics Overview</span>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground hidden sm:block">The gist, full detail below</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border/60 rounded-2xl overflow-hidden">
        {items.map((it) => (
          <div key={it.label} className="bg-[var(--surface-3)] p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{it.label}</p>
            <p className={cn("font-display text-2xl lg:text-3xl mt-2 truncate tabular", toneClass(it.tone))}>{it.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// Progressive disclosure row, hides complexity until the executive asks for it.
function Disclosure({
  level,
  label,
  defaultOpen = false,
  children,
}: {
  level: string;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-6 text-left group"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-4">
          <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground/70 w-28 shrink-0">{level}</span>
          <span className="font-display text-xl text-foreground/90">{label}</span>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      {open && <div className="pb-8 -mt-1">{children}</div>}
    </div>
  );
}

/* ───────────────────────────── Hero · Executive Brief ──────────────────── */

function ExecutiveBrief({
  kpis,
  forecast,
  intel,
  hasData,
  uploading,
  onUpload,
}: {
  kpis: ReturnType<typeof computeKpis> | null;
  forecast: ReturnType<typeof forecastRevenue> | null;
  intel: Intelligence | null;
  hasData: boolean;
  uploading: boolean;
  onUpload: () => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const hour = now?.getHours() ?? 8;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)
    : " ";

  const growth = kpis?.metrics.find((m) => m.key === "growth")?.value ?? 0;
  const anomalies = kpis?.anomalies.length ?? 0;
  let forecastPct = 0;
  if (forecast && forecast.series.length >= 2 && kpis?.series.length) {
    const baseline = kpis.series[kpis.series.length - 1]?.revenue ?? 0;
    const future = forecast.series[forecast.series.length - 1]?.value ?? baseline;
    forecastPct = baseline ? ((future - baseline) / baseline) * 100 : 0;
  }

  const metrics = [
    { label: "Revenue", value: `${growth >= 0 ? "↑" : "↓"} ${Math.abs(growth).toFixed(1)}%`, tone: growth >= 0 ? "success" : "destructive" },
    { label: "Decisions Pending", value: String(anomalies), tone: anomalies > 0 ? "warning" : "foreground" },
    { label: "Agents Active", value: "10", tone: "foreground" },
  ] as const;

  const briefLines = hasData
    ? [
        growth >= 0
          ? `Revenue growth continues to accelerate, up ${growth.toFixed(1)}% across the period.`
          : `Revenue is under pressure, down ${Math.abs(growth).toFixed(1)}% across the period.`,
        anomalies === 0
          ? "No material risks require review this cycle."
          : `${anomalies} strategic ${anomalies === 1 ? "risk requires" : "risks require"} review.`,
        forecastPct
          ? `Forecast projects ${forecastPct >= 0 ? "+" : ""}${forecastPct.toFixed(1)}% over the coming periods.`
          : "Forecast holds steady across the coming periods.",
      ]
    : [
        "Your executive headquarters is ready.",
        "Brief it with a dataset and your AI C-suite will profile, analyze, forecast and surface the decisions that need you.",
      ];

  const recommendedAction = hasData
    ? intel?.recommendedAction ?? "Reallocate toward your strongest-performing segment and monitor weekly."
    : "Begin by uploading your operating data to assemble today's brief.";

  const toneClass = (t: string) =>
    t === "success" ? "text-success" : t === "destructive" ? "text-destructive" : t === "warning" ? "text-warning" : "text-foreground";

  return (
    <section className="executive-card-hero rounded-3xl px-8 py-9 lg:px-16 lg:py-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.34em] text-muted-foreground">{dateLabel}</span>
        <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.26em] text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]" />
          {hasData ? "Brief composed" : "Standing by"}
        </span>
      </div>
      <div className="masthead-rule mt-4 mb-7" />

      <p className="text-sm uppercase tracking-[0.3em] text-secondary mb-4">Today's Executive Brief</p>
      <h1 className="font-display text-5xl lg:text-7xl tracking-tight leading-[1.0] text-balance">
        <span className="gradient-text">{greeting}</span>
      </h1>

      {/* Key metrics */}
      <div className="mt-9 grid grid-cols-1 sm:grid-cols-3 max-w-3xl">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              "py-3 lg:py-0",
              i > 0 && "lg:pl-8 lg:border-l border-border",
              i < metrics.length - 1 && "lg:pr-8",
            )}
          >
            <p className={cn("font-display text-4xl lg:text-5xl tracking-tight tabular leading-none", toneClass(m.tone))}>{m.value}</p>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-3">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Brief + recommended action */}
      <div className="mt-10 grid lg:grid-cols-[1.5fr_1fr] gap-10 lg:gap-16 items-stretch">
        <div>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Summary</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-4">
            {briefLines.map((line, i) => (
              <p key={i} className="font-display text-2xl lg:text-[1.8rem] leading-snug text-foreground/90">{line}</p>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-primary text-primary-foreground p-9 flex flex-col justify-between min-h-[16rem]">
          <div>
            <div className="flex items-center gap-2 mb-5">
              <Compass className="h-4 w-4 opacity-80" />
              <span className="text-[10px] uppercase tracking-[0.26em] opacity-75">Recommended Action</span>
            </div>
            <p className="font-display text-2xl lg:text-[1.7rem] leading-snug">{recommendedAction}</p>
          </div>
          <div className="mt-8">
            {hasData ? (
              <Link
                to="/boardroom"
                className="inline-flex items-center gap-2 text-sm font-medium border-b border-primary-foreground/40 pb-0.5 hover:border-primary-foreground transition-colors"
              >
                Convene the boardroom <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                onClick={onUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 text-sm font-medium border-b border-primary-foreground/40 pb-0.5 hover:border-primary-foreground transition-colors disabled:opacity-50"
              >
                <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload a dataset"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── 01 · Strategic Signals ──────────────────── */

export function StrategicSignals({
  kpis,
  forecast,
  intel,
  dataset,
}: {
  kpis: NonNullable<ReturnType<typeof computeKpis>>;
  forecast: ReturnType<typeof forecastRevenue> | null;
  intel: Intelligence;
  dataset: { name: string; schema: { name: string; type: string }[]; row_count: number; column_count: number };
}) {
  return (
    <div>
      {/* Level 1, the conclusions, always visible */}
      <ExecutiveIntelligencePanel intel={intel} />

      {/* Levels 2–4, progressive disclosure */}
      <div className="mt-4">
        <Disclosure level="Management" label="Executive snapshot & business health">
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ExecutiveSnapshot kpis={kpis} forecast={forecast} intel={intel} />
            <HealthScoreCard kpis={kpis} forecast={forecast} />
          </section>
        </Disclosure>

        <Disclosure level="Operational" label="KPIs, trend & forecast">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Executive KPIs</span>
            <div className="section-divider flex-1" />
          </div>
          <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {kpis.metrics.map((m) => <KpiCard key={m.key} metric={m} />)}
          </section>
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="executive-card rounded-3xl p-7 lg:col-span-2">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Trend</p>
                  <h3 className="font-display text-2xl mt-0.5">Revenue &amp; Profit</h3>
                </div>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="h-72">
                <ResponsiveContainer>
                  <AreaChart data={kpis.series}>
                    <defs>
                      <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="prof" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => Intl.NumberFormat("en", { notation: "compact" }).format(v as number)} />
                    <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, color: "var(--color-foreground)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="revenue" stroke="var(--color-chart-1)" fill="url(#rev)" strokeWidth={2} />
                    <Area type="monotone" dataKey="profit" stroke="var(--color-chart-2)" fill="url(#prof)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="executive-card rounded-3xl p-7">
              <div className="flex items-center justify-between gap-2 mb-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-secondary" />
                  <h3 className="font-display text-2xl">Forecast</h3>
                </div>
                {forecast?.fitStrength && (
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded border",
                      forecast.fitStrength === "strong" ? "bg-success/15 text-success border-success/30" :
                      forecast.fitStrength === "moderate" ? "bg-secondary/15 text-secondary border-secondary/30" :
                      forecast.fitStrength === "weak" ? "bg-warning/15 text-warning border-warning/30" :
                      "bg-muted text-muted-foreground border-border",
                    )}
                    title={`Trend fit on your revenue series${forecast.r2 != null ? ` (R² ${forecast.r2.toFixed(2)})` : ""}${forecast.mape != null ? `, ±${forecast.mape}% backtest error` : ""}.`}
                  >
                    {forecast.fitStrength === "insufficient" ? "Low data" : `${forecast.fitStrength} fit`}
                    {forecast.mape != null ? ` · ±${forecast.mape}%` : ""}
                  </span>
                )}
              </div>
              <div className="h-72">
                {forecast && (
                  <ResponsiveContainer>
                    <LineChart data={forecast.series}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => Intl.NumberFormat("en", { notation: "compact" }).format(v as number)} />
                      <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, color: "var(--color-foreground)" }} />
                      <Line type="monotone" dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="upper" stroke="var(--color-analytics)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="lower" stroke="var(--color-analytics)" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>
        </Disclosure>

        <Disclosure level="Technical" label="Data schema & anomaly detection">
          <DataUnderstandingPanel dataset={dataset} />
          <section className="executive-card rounded-3xl p-7 mt-6">
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h3 className="font-display text-2xl">Anomalies Detected</h3>
            </div>
            {kpis.anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No statistically significant deviations in the period. Trend remains consistent with baseline.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {kpis.anomalies.map((a, i) => (
                  <div key={i} className="surface-inset rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{a.label}</span>
                      <span className={cn(
                        "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                        a.severity === "high" ? "bg-destructive/15 text-destructive" :
                        a.severity === "med" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                      )}>{a.severity}</span>
                    </div>
                    <div className="font-display text-xl mt-1 tabular">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(a.value)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.note}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </Disclosure>
      </div>
    </div>
  );
}

/* ───────────────────────────── 02 · Active Decisions ───────────────────── */

export function ActiveDecisions({
  kpis,
  intel,
  hasData,
  onUpload,
}: {
  kpis: ReturnType<typeof computeKpis> | null;
  intel: Intelligence | null;
  hasData: boolean;
  onUpload: () => void;
}) {
  if (!hasData || !kpis) {
    return (
      <div className="executive-card rounded-3xl p-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h3 className="font-display text-2xl">No decisions pending</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">Decisions surface here once your data is briefed and your team flags risk.</p>
        </div>
        <Button onClick={onUpload} variant="outline">
          <Upload className="h-4 w-4 mr-2" /> Brief with data
        </Button>
      </div>
    );
  }

  const decisions: { title: string; detail: string; severity: "high" | "med" | "low"; tag: string }[] = [];
  if (intel) {
    decisions.push({ title: intel.topRisk, detail: intel.recommendedAction, severity: "med", tag: "Strategic" });
  }
  for (const a of kpis.anomalies) {
    decisions.push({
      title: `Review ${a.label} deviation`,
      detail: `${a.note} (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(a.value)})`,
      severity: a.severity as "high" | "med" | "low",
      tag: "Anomaly",
    });
  }

  const sevStyle: Record<string, string> = {
    high: "bg-destructive/12 text-destructive border-destructive/25",
    med: "bg-warning/12 text-warning border-warning/25",
    low: "bg-success/12 text-success border-success/25",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {decisions.map((d, i) => (
        <div key={i} className="executive-card rounded-3xl p-7 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className={cn("text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border", sevStyle[d.severity])}>
              {d.tag} · {d.severity}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Awaiting decision</span>
          </div>
          <h3 className="font-display text-2xl leading-snug">{d.title}</h3>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed flex-1">{d.detail}</p>
          <div className="flex items-center gap-5 mt-6 pt-5 border-t border-border">
            <Link to="/boardroom" className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-secondary transition-colors">
              Deliberate <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link to="/action-plans" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Plan execution
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── 03 · Executive Team ─────────────────────── */

type Tier = "intel" | "advisory" | "execution";

const EXECUTIVE_TEAM: {
  name: string; title: string; tier: Tier; icon: typeof Crown;
  task: string; confidence: number; output: string;
}[] = [
  { name: "CEO Agent", title: "Chief Strategy Officer", tier: "advisory", icon: Crown, task: "Composing the executive brief", confidence: 92, output: "Approved the revenue narrative" },
  { name: "Research Agent", title: "Chief Intelligence Officer", tier: "intel", icon: Search, task: "Scanning market context", confidence: 84, output: "Added 3 competitive signals" },
  { name: "Forecast Agent", title: "Chief Planning Officer", tier: "intel", icon: LineIcon, task: "Projecting two quarters", confidence: 87, output: "Updated the confidence band" },
  { name: "Data Agent", title: "Chief Data Officer", tier: "intel", icon: Database, task: "Profiling the active dataset", confidence: 99, output: "Parsed schema · 0 errors" },
  { name: "KPI Agent", title: "Chief Metrics Officer", tier: "intel", icon: Gauge, task: "Recomputing core metrics", confidence: 96, output: "Refreshed 6 KPIs" },
  { name: "Consultant Agent", title: "Chief Advisory Officer", tier: "advisory", icon: Briefcase, task: "Framing strategic options", confidence: 89, output: "Drafted the recommendation set" },
  { name: "Decision Agent", title: "Chief Decision Scientist", tier: "advisory", icon: Compass, task: "Weighing trade-offs", confidence: 85, output: "Scored 4 scenarios" },
  { name: "Boardroom Agent", title: "Chief Deliberation Officer", tier: "advisory", icon: Users, task: "Preparing the debate", confidence: 88, output: "Convened 6 board seats" },
  { name: "Execution Agent", title: "Chief Operating Officer", tier: "execution", icon: ListChecks, task: "Sequencing initiatives", confidence: 90, output: "Queued 5 action plans" },
  { name: "Monitoring Agent", title: "Chief Risk Officer", tier: "execution", icon: ShieldAlert, task: "Watching KPIs for drift", confidence: 91, output: "Flagged 1 anomaly" },
];

function teamStatus(name: string, tier: Tier, hasData: boolean): { label: string; tone: "success" | "secondary" | "warning" | "muted" } {
  if (!hasData) return { label: "Idle", tone: "muted" };
  if (name === "Monitoring Agent") return { label: "Monitoring", tone: "warning" };
  if (tier === "intel") return { label: "Completed", tone: "success" };
  return { label: "Ready", tone: "secondary" };
}

const TIER_LABEL: Record<Tier, string> = { intel: "Intelligence", advisory: "Advisory", execution: "Execution" };

export function ExecutiveTeam({ hasData }: { hasData: boolean }) {
  const [lead, ...rest] = EXECUTIVE_TEAM;
  const leadStatus = teamStatus(lead.name, lead.tier, hasData);
  const activeCount = hasData ? EXECUTIVE_TEAM.length : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Featured, Chief Strategy Officer */}
      <div className="executive-card-elevated rounded-3xl p-9 lg:row-span-2 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="grid place-items-center h-12 w-12 rounded-2xl bg-[var(--color-rose)]/12 text-[var(--color-rose)]">
            <lead.icon className="h-6 w-6" />
          </span>
          <TeamStatusPill status={leadStatus} />
        </div>
        <p className="text-[10px] uppercase tracking-[0.24em] text-secondary mt-7">{lead.title}</p>
        <h3 className="font-display text-3xl mt-1">{lead.name}</h3>

        <div className="my-8 flex items-center gap-5">
          <ConfidenceRing value={hasData ? lead.confidence : 0} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Confidence</p>
            <p className="font-display text-4xl tabular leading-none mt-1">{hasData ? `${lead.confidence}%` : "-"}</p>
          </div>
        </div>

        <div className="mt-auto space-y-3 pt-6 border-t border-border">
          <TeamLine icon={<Activity className="h-3.5 w-3.5" />} label="Current task" value={hasData ? lead.task : "Idle, awaiting data"} />
          <TeamLine icon={<Clock className="h-3.5 w-3.5" />} label="Recent output" value={hasData ? lead.output : "-"} />
        </div>

        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-6">
          {activeCount} officers · {hasData ? "all engaged" : "standing by"}
        </p>
      </div>

      {/* The rest of the C-suite */}
      {rest.map((a) => {
        const s = teamStatus(a.name, a.tier, hasData);
        return (
          <div key={a.name} className="executive-card rounded-3xl p-6">
            <div className="flex items-start justify-between">
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-foreground/5 text-foreground/70">
                <a.icon className="h-5 w-5" />
              </span>
              <TeamStatusPill status={s} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-secondary mt-4">{a.title}</p>
            <h4 className="font-display text-xl leading-tight mt-0.5">{a.name}</h4>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mt-1">{TIER_LABEL[a.tier]}</p>

            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-muted-foreground uppercase tracking-[0.18em]">Confidence</span>
                <span className="tabular font-medium text-foreground/80">{hasData ? `${a.confidence}%` : "-"}</span>
              </div>
              <div className="h-1 rounded-full bg-foreground/8 overflow-hidden">
                <div className="h-full rounded-full bg-secondary/70 transition-all duration-700" style={{ width: hasData ? `${a.confidence}%` : "0%" }} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              <span className="text-foreground/80">{hasData ? a.task : "Idle"}</span>
              {hasData && <> · {a.output}</>}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function TeamLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground/90 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function TeamStatusPill({ status }: { status: { label: string; tone: "success" | "secondary" | "warning" | "muted" } }) {
  const dot = status.tone === "success" ? "bg-success shadow-[0_0_8px_var(--color-success)]"
    : status.tone === "secondary" ? "bg-secondary"
    : status.tone === "warning" ? "bg-warning shadow-[0_0_8px_var(--color-warning)] animate-pulse"
    : "bg-muted-foreground/40";
  const text = status.tone === "success" ? "text-success" : status.tone === "secondary" ? "text-secondary" : status.tone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full bg-foreground/5", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {status.label}
    </span>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  const size = 76, stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} className="stroke-foreground/10" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        className="stroke-[var(--color-rose)]"
        strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1)" }}
      />
    </svg>
  );
}

/* ───────────────────────────── Executive Snapshot ──────────────────────── */

function ExecutiveSnapshot({
  kpis,
  forecast,
  intel,
}: {
  kpis: NonNullable<ReturnType<typeof computeKpis>>;
  forecast: ReturnType<typeof forecastRevenue> | null;
  intel: Intelligence;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
  const totalRevenue = kpis.series.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const growth = kpis.metrics.find((m) => m.key === "growth")?.value ?? 0;
  const anomalies = kpis.anomalies.length;
  const risk: { label: string; tone: "success" | "warning" | "destructive" } =
    anomalies >= 4 || growth < -5
      ? { label: "High", tone: "destructive" }
      : anomalies >= 1 || growth < 2
      ? { label: "Medium", tone: "warning" }
      : { label: "Low", tone: "success" };
  let forecastPct = 0;
  if (forecast && forecast.series.length >= 2 && kpis.series.length) {
    const baseline = kpis.series[kpis.series.length - 1]?.revenue ?? 0;
    const future = forecast.series[forecast.series.length - 1]?.value ?? baseline;
    forecastPct = baseline ? ((future - baseline) / baseline) * 100 : 0;
  }
  const opportunity = intel.opportunityHeadline;

  const items = [
    { label: "Revenue", value: fmt(totalRevenue), tone: "primary" as const },
    { label: "Growth", value: `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`, tone: (growth >= 0 ? "success" : "destructive") as "success" | "destructive" },
    { label: "Risk", value: risk.label, tone: risk.tone },
    { label: "Forecast", value: `${forecastPct >= 0 ? "+" : ""}${forecastPct.toFixed(1)}%`, tone: (forecastPct >= 0 ? "success" : "destructive") as "success" | "destructive" },
    { label: "Top Opportunity", value: opportunity, tone: "primary" as const },
  ];

  const toneClass = (t: string) =>
    t === "success" ? "text-success" : t === "destructive" ? "text-destructive" : t === "warning" ? "text-warning" : "text-foreground";

  return (
    <section className="executive-card-elevated rounded-3xl p-7 lg:col-span-2">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-secondary" />
          <h3 className="font-display text-2xl">Executive Snapshot</h3>
        </div>
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground hidden sm:block">One-glance summary</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border/60 rounded-2xl overflow-hidden">
        {items.map((it) => (
          <div key={it.label} className="bg-[var(--surface-3)] p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{it.label}</p>
            <p className={cn("font-display text-2xl mt-1.5 truncate", toneClass(it.tone))}>{it.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── Health score ────────────────────────────── */

function HealthScoreCard({
  kpis,
  forecast,
}: {
  kpis: NonNullable<ReturnType<typeof computeKpis>>;
  forecast: ReturnType<typeof forecastRevenue> | null;
}) {
  const growth = kpis.metrics.find((m) => m.key === "growth")?.value ?? 0;
  const margin = kpis.metrics.find((m) => m.key === "margin")?.value ?? 0;

  const revs = kpis.series.map((s) => s.revenue).filter((v) => Number.isFinite(v));
  const mean = revs.length ? revs.reduce((a, b) => a + b, 0) / revs.length : 0;
  const variance = revs.length ? revs.reduce((a, b) => a + (b - mean) ** 2, 0) / revs.length : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const consistencyBoost = Math.max(-10, Math.min(10, (1 - Math.min(cv, 1)) * 10));

  let forecastBoost = 0;
  if (forecast && forecast.series.length >= 2 && kpis.series.length) {
    const baseline = kpis.series[kpis.series.length - 1]?.revenue ?? 0;
    const future = forecast.series[forecast.series.length - 1]?.value ?? baseline;
    const pct = baseline ? ((future - baseline) / baseline) * 100 : 0;
    forecastBoost = Math.max(-10, Math.min(10, pct / 3));
  }

  const anomaliesPenalty = Math.min(20, kpis.anomalies.length * 5);
  const raw =
    55 +
    Math.max(-20, Math.min(20, growth)) +
    Math.max(-10, Math.min(15, margin / 4)) +
    consistencyBoost +
    forecastBoost -
    anomaliesPenalty;
  const score = Math.max(5, Math.min(98, Math.round(raw)));
  const tone: "success" | "warning" | "destructive" = score >= 75 ? "success" : score >= 55 ? "warning" : "destructive";
  const label = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "At Risk";
  return (
    <div className="executive-card-elevated rounded-3xl p-7 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Business Health</p>
        <span className={cn(
          "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded",
          tone === "success" ? "bg-success/15 text-success" : tone === "warning" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive",
        )}>{label}</span>
      </div>
      <div className="flex-1 grid place-items-center py-4">
        <ScoreRing value={score} label={`${score} / 100`} size={170} tone={tone} />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-5 border-t border-border">
        <Stat label="Growth" value={`${growth.toFixed(1)}%`} />
        <Stat label="Margin" value={`${margin.toFixed(1)}%`} />
        <Stat label="Consistency" value={`${Math.round((1 - Math.min(cv, 1)) * 100)}%`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-lg leading-tight tabular">{value}</p>
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    </div>
  );
}

/* ───────────────────────────── Data understanding ──────────────────────── */

function inferDatasetType(name: string, cols: string[]): string {
  const n = (name + " " + cols.join(" ")).toLowerCase();
  if (/(sale|revenue|order|sku|product)/.test(n)) return "Retail Sales";
  if (/(customer|churn|subscription|mrr|arr)/.test(n)) return "Customer Analytics";
  if (/(marketing|campaign|impression|click|conversion)/.test(n)) return "Marketing Performance";
  if (/(finance|expense|profit|cogs|ledger)/.test(n)) return "Financial Operations";
  if (/(employee|headcount|payroll|hr)/.test(n)) return "Workforce Data";
  return "Business Operations";
}

function recommendKpis(schemaNames: string[]): string[] {
  const n = schemaNames.join(" ").toLowerCase();
  const recs: string[] = [];
  if (/(revenue|sale|amount|gross|income|total)/.test(n)) recs.push("Revenue Growth");
  if (/(profit|margin|net|earnings)/.test(n) || /(cost|expense|cogs|spend)/.test(n)) recs.push("Profit Margin");
  if (/(customer|user|account|client|churn|subscriber)/.test(n)) recs.push("Customer Growth");
  if (/(marketing|campaign|impression|click|conversion|spend|ad)/.test(n)) recs.push("Marketing Efficiency");
  if (/(region|country|state|territory|market|location|city)/.test(n)) recs.push("Regional Performance");
  if (/(category|product|segment|department|sku|type|industry|brand)/.test(n)) recs.push("Category Performance");
  if (recs.length === 0) recs.push("Revenue Growth", "Profit Margin");
  return recs.slice(0, 6);
}

function DataUnderstandingPanel({ dataset, className }: { dataset: { name: string; schema: { name: string; type: string }[]; row_count: number; column_count: number }; className?: string }) {
  const metrics = dataset.schema.filter((c) => c.type === "number").slice(0, 8);
  const dimensions = dataset.schema.filter((c) => c.type !== "number").slice(0, 8);
  const type = inferDatasetType(dataset.name, dataset.schema.map((c) => c.name));
  const recommended = recommendKpis(dataset.schema.map((c) => c.name));
  return (
    <div className={cn("executive-card rounded-3xl p-7", className)}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-secondary" />
          <h3 className="font-display text-2xl">Data Understanding</h3>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-success flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Schema parsed
        </span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoBlock icon={<Tag className="h-3.5 w-3.5" />} label="Dataset Type">
          <p className="font-display text-xl mt-1">{type}</p>
          <p className="text-[11px] text-muted-foreground mt-1 tabular">{dataset.row_count.toLocaleString()} rows · {dataset.column_count} columns</p>
        </InfoBlock>
        <InfoBlock icon={<Activity className="h-3.5 w-3.5" />} label={`Detected Metrics (${metrics.length})`}>
          <ul className="mt-2 space-y-1">
            {metrics.length === 0 && <li className="text-xs text-muted-foreground">No numeric columns detected.</li>}
            {metrics.map((m) => (
              <li key={m.name} className="text-xs flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--color-analytics)]" /> {m.name}
              </li>
            ))}
          </ul>
        </InfoBlock>
        <InfoBlock icon={<Calendar className="h-3.5 w-3.5" />} label={`Detected Dimensions (${dimensions.length})`}>
          <ul className="mt-2 space-y-1">
            {dimensions.length === 0 && <li className="text-xs text-muted-foreground">No categorical columns detected.</li>}
            {dimensions.map((d) => (
              <li key={d.name} className="text-xs flex items-center gap-1.5">
                <MapPin className="h-2.5 w-2.5 text-muted-foreground" /> {d.name}
              </li>
            ))}
          </ul>
        </InfoBlock>
        <InfoBlock icon={<Target className="h-3.5 w-3.5" />} label={`Recommended KPIs (${recommended.length})`}>
          <ul className="mt-2 space-y-1">
            {recommended.map((k) => (
              <li key={k} className="text-xs flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--color-rose)]" /> {k}
              </li>
            ))}
          </ul>
        </InfoBlock>
      </div>
    </div>
  );
}

function InfoBlock({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="surface-inset rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.18em]">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executive Intelligence, transforms raw rows into business conclusions.
// ---------------------------------------------------------------------------

const REGION_KEYS = ["region", "country", "state", "territory", "market", "location", "city", "zone", "area", "geo"];
const CATEGORY_KEYS = ["category", "product", "segment", "department", "sku", "type", "industry", "brand", "line"];
const REVENUE_KEYS = ["revenue", "sales", "amount", "gross", "income", "total"];
const PROFIT_KEYS = ["profit", "net_income", "net", "margin_value", "earnings"];

export interface Intelligence {
  bestRegion: string | null;
  bestRegionLabel: string;
  bestRegionValue: number;
  bestCategory: string | null;
  bestCategoryLabel: string;
  bestCategoryValue: number;
  topOpportunity: string;
  topRisk: string;
  recommendedAction: string;
  opportunityHeadline: string;
  metricName: "Revenue" | "Profit" | "Records";
  concentrationPct: number;
}

function pickCol(schema: DatasetColumn[], candidates: string[], type?: DatasetColumn["type"]): string | null {
  const lower = schema.map((c) => ({ ...c, l: c.name.toLowerCase() }));
  for (const cand of candidates) {
    const m = lower.find((c) => c.l.includes(cand) && (!type || c.type === type));
    if (m) return m.name;
  }
  return null;
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function groupTotals(rows: DatasetRow[], dimCol: string, metricCol: string | null): Array<{ name: string; total: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const raw = r[dimCol];
    if (raw === null || raw === undefined || raw === "") continue;
    const key = String(raw);
    const v = metricCol ? toNum(r[metricCol]) : 1;
    map.set(key, (map.get(key) ?? 0) + v);
  }
  return Array.from(map.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

export function computeIntelligence(rows: DatasetRow[], schema: DatasetColumn[]): Intelligence {
  const regionCol = pickCol(schema, REGION_KEYS);
  const categoryCol = pickCol(schema, CATEGORY_KEYS);
  const revCol = pickCol(schema, REVENUE_KEYS, "number");
  const profCol = pickCol(schema, PROFIT_KEYS, "number");
  const metricCol = revCol ?? profCol;
  const metricName: Intelligence["metricName"] = revCol ? "Revenue" : profCol ? "Profit" : "Records";

  const regionTotals = regionCol ? groupTotals(rows, regionCol, metricCol) : [];
  const categoryTotals = categoryCol ? groupTotals(rows, categoryCol, metricCol) : [];

  const bestRegion = regionTotals[0]?.name ?? null;
  const bestRegionValue = regionTotals[0]?.total ?? 0;
  const bestCategory = categoryTotals[0]?.name ?? null;
  const bestCategoryValue = categoryTotals[0]?.total ?? 0;

  const categoryTotalSum = categoryTotals.reduce((a, b) => a + b.total, 0);
  const concentrationPct = categoryTotalSum > 0 ? (bestCategoryValue / categoryTotalSum) * 100 : 0;

  let topOpportunity = "Scale strongest performing segment";
  if (bestRegion && bestCategory) {
    topOpportunity = `Expand ${bestCategory} sales in ${bestRegion}`;
  } else if (bestCategory) {
    topOpportunity = `Double down on ${bestCategory} performance`;
  } else if (bestRegion) {
    topOpportunity = `Expand presence in ${bestRegion}`;
  }

  let topRisk = "Demand variability across segments";
  if (bestCategory && concentrationPct >= 35) {
    topRisk = `Revenue concentration in ${bestCategory} category`;
  } else if (bestRegion && regionTotals.length === 1) {
    topRisk = `Geographic concentration in ${bestRegion}`;
  } else if (regionTotals.length >= 2) {
    const weakest = regionTotals[regionTotals.length - 1];
    topRisk = `Underperformance in ${weakest.name} region`;
  }

  let recommendedAction = "Reallocate budget to highest-performing segment and monitor weekly.";
  if (bestRegion && bestCategory) {
    recommendedAction = `Increase inventory allocation and marketing investment in ${bestCategory} within ${bestRegion}.`;
  } else if (bestCategory) {
    recommendedAction = `Increase marketing investment and inventory in ${bestCategory} to capture upside.`;
  } else if (bestRegion) {
    recommendedAction = `Concentrate go-to-market resources on ${bestRegion} to accelerate growth.`;
  }

  let opportunityHeadline = "Top Segment Expansion";
  if (bestRegion && bestCategory) opportunityHeadline = `${bestRegion} ${bestCategory} Expansion`;
  else if (bestCategory) opportunityHeadline = `${bestCategory} Upsell Expansion`;
  else if (bestRegion) opportunityHeadline = `${bestRegion} Growth Opportunity`;

  return {
    bestRegion,
    bestRegionLabel: regionCol ?? "Region",
    bestRegionValue,
    bestCategory,
    bestCategoryLabel: categoryCol ?? "Category",
    bestCategoryValue,
    topOpportunity,
    topRisk,
    recommendedAction,
    opportunityHeadline,
    metricName,
    concentrationPct,
  };
}

function ExecutiveIntelligencePanel({ intel }: { intel: Intelligence }) {
  const fmt = (n: number) => {
    if (intel.metricName === "Records") return n.toLocaleString();
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
  };
  const tiles: Array<{ label: string; icon: typeof Trophy; value: string; sub?: string; tone: "success" | "secondary" | "warning" | "primary" }> = [
    {
      label: "Best Performing Region",
      icon: MapPin,
      value: intel.bestRegion ?? "Not detected",
      sub: intel.bestRegion ? `${fmt(intel.bestRegionValue)} · ${intel.metricName}` : "Add a region column",
      tone: "success",
    },
    {
      label: "Best Performing Category",
      icon: Trophy,
      value: intel.bestCategory ?? "Not detected",
      sub: intel.bestCategory ? `${fmt(intel.bestCategoryValue)} · ${intel.metricName}` : "Add a category column",
      tone: "success",
    },
    {
      label: "Top Opportunity",
      icon: Lightbulb,
      value: intel.topOpportunity,
      tone: "secondary",
    },
    {
      label: "Top Risk",
      icon: ShieldAlert,
      value: intel.topRisk,
      sub: intel.concentrationPct > 0 ? `Top-segment share ${intel.concentrationPct.toFixed(0)}%` : undefined,
      tone: "warning",
    },
    {
      label: "Recommended Action",
      icon: Compass,
      value: intel.recommendedAction,
      tone: "primary",
    },
  ];
  const toneRing: Record<string, string> = {
    success: "text-success bg-success/12 border-success/25",
    secondary: "text-secondary bg-secondary/12 border-secondary/25",
    warning: "text-warning bg-warning/12 border-warning/25",
    primary: "text-primary bg-primary/8 border-primary/20",
  };
  return (
    <section className="executive-card-elevated rounded-3xl p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-secondary" />
          <div>
            <h3 className="font-display text-2xl leading-tight">Executive Intelligence</h3>
            <p className="text-[11px] text-muted-foreground">Raw KPIs translated into board-ready conclusions.</p>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground hidden sm:block">{intel.metricName}-weighted</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="surface-inset rounded-2xl p-5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t.label}</span>
              <span className={cn("grid place-items-center h-6 w-6 rounded-md border", toneRing[t.tone])}>
                <t.icon className="h-3 w-3" />
              </span>
            </div>
            <p className="font-display text-lg leading-snug">{t.value}</p>
            {t.sub && <p className="text-[11px] text-muted-foreground leading-snug tabular">{t.sub}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
