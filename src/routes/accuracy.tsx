import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ShieldCheck,
  TrendingUp,
  Gavel,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Building2,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/page-header";
import {
  getModelEvalRuns,
  getLlmEvalRuns,
  getRealMetrics,
  computeRealBacktest,
  parsePerClassF1,
  parseNoteNumber,
  RISK_MODEL,
  FORECAST_MODEL,
  type ModelEvalRun,
  type LlmEvalRun,
  type EvalRunFailure,
  type RealBacktest,
  type BacktestTransition,
} from "@/lib/api/accuracy";

export const Route = createFileRoute("/accuracy")({
  head: () => ({
    meta: [
      { title: "Model Accuracy, ExecutiveOS" },
      {
        name: "description",
        content:
          "Measured accuracy of the risk classifier, revenue forecast and LLM insight agent, tracked across evaluation runs.",
      },
    ],
  }),
  component: AccuracyPage,
});

/* ──────────────────────────────── helpers ──────────────────────────────── */

const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

function delta(runs: { value: number }[]): number | null {
  if (runs.length < 2) return null;
  return runs[runs.length - 1].value - runs[runs.length - 2].value;
}

type Tone = "success" | "warning" | "destructive";
function toneFor(value: number, good = 0.9, fair = 0.8): Tone {
  return value >= good ? "success" : value >= fair ? "warning" : "destructive";
}
const toneText: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};
const toneStroke: Record<Tone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  destructive: "var(--color-destructive)",
};

/* ──────────────────────────────── page ─────────────────────────────────── */

function AccuracyPage() {
  const riskQ = useQuery({ queryKey: ["model-eval", RISK_MODEL], queryFn: () => getModelEvalRuns(RISK_MODEL) });
  const forecastQ = useQuery({ queryKey: ["model-eval", FORECAST_MODEL], queryFn: () => getModelEvalRuns(FORECAST_MODEL) });
  const llmQ = useQuery({ queryKey: ["eval-runs"], queryFn: getLlmEvalRuns });
  // Real-world backtest — independent query so a missing/locked table never
  // breaks the synthetic eval sections above.
  const realQ = useQuery({ queryKey: ["real-metrics"], queryFn: getRealMetrics, retry: false });
  const realBacktest = useMemo(
    () => (realQ.data && realQ.data.length ? computeRealBacktest(realQ.data) : null),
    [realQ.data],
  );

  const loading = riskQ.isLoading || forecastQ.isLoading || llmQ.isLoading;
  const error = riskQ.error || forecastQ.error || llmQ.error;

  const risk = riskQ.data ?? [];
  const forecast = forecastQ.data ?? [];
  const llm = llmQ.data ?? [];

  const latestRisk = risk.at(-1) ?? null;
  const latestForecast = forecast.at(-1) ?? null;
  const latestLlm = llm.at(-1) ?? null;

  const hasAny = risk.length > 0 || forecast.length > 0 || llm.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Evaluation"
        title="Model Accuracy"
        description="Every executive output is graded against held-out data and golden references. These are the measured results across evaluation runs, not estimates."
        actions={
          latestRisk || latestForecast || latestLlm ? (
            <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Last run{" "}
              {shortDate(
                [latestRisk?.run_date, latestForecast?.run_date, latestLlm?.run_at]
                  .filter(Boolean)
                  .sort()
                  .at(-1) as string,
              )}
            </span>
          ) : undefined
        }
      />

      {error ? (
        <EmptyState
          title="Could not load eval results"
          description={error instanceof Error ? error.message : "Unknown error reading model_eval_runs / eval_runs."}
        />
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="executive-card rounded-3xl p-8 h-40 animate-pulse" />
          ))}
        </div>
      ) : !hasAny ? (
        <EmptyState
          title="No evaluation runs yet"
          description="Run the model evals (py ml/eval_risk_model.py, py ml/eval_forecast_model.py) and the LLM harness (npm run eval:agent) to populate accuracy history."
        />
      ) : (
        <div className="space-y-6">
          {/* Top row — latest headline numbers */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <HeadlineCard
              icon={ShieldCheck}
              label="Risk Classifier"
              caption="Accuracy on held-out test set"
              run={latestRisk}
              series={risk.map((r) => ({ value: r.accuracy }))}
            />
            <HeadlineCard
              icon={TrendingUp}
              label="Revenue Forecast"
              caption="1 − MAPE on held-out test set"
              run={latestForecast}
              series={forecast.map((r) => ({ value: r.accuracy }))}
            />
            <HeadlineCard
              icon={Gavel}
              label="LLM Insight Agent"
              caption="LLM-as-judge pass rate"
              value={latestLlm?.pass_rate ?? null}
              subValue={latestLlm ? `${latestLlm.passed}/${latestLlm.total} scenarios` : undefined}
              series={llm.map((r) => ({ value: r.pass_rate }))}
            />
          </section>

          {/* Risk classifier */}
          <RiskSection runs={risk} latest={latestRisk} />

          {/* Forecast */}
          <ForecastSection runs={forecast} latest={latestForecast} />

          {/* LLM eval */}
          <LlmSection runs={llm} latest={latestLlm} />

          {/* Real-world backtest — visually separated; never blended above */}
          <SyntheticRealDivider />
          <RealWorldBacktestPanel
            backtest={realBacktest}
            loading={realQ.isLoading}
            error={realQ.error}
          />
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────── headline cards ────────────────────────── */

function HeadlineCard({
  icon: Icon,
  label,
  caption,
  run,
  value,
  subValue,
  series,
}: {
  icon: typeof ShieldCheck;
  label: string;
  caption: string;
  run?: ModelEvalRun | null;
  value?: number | null;
  subValue?: string;
  series: { value: number }[];
}) {
  const v = value ?? run?.accuracy ?? null;
  const d = delta(series.map((s) => ({ value: s.value ?? 0 })));
  const tone = v == null ? "warning" : toneFor(v);

  return (
    <div className="executive-card rounded-3xl p-7 flex flex-col">
      <div className="flex items-center justify-between">
        <span className={cn("grid place-items-center h-10 w-10 rounded-2xl bg-foreground/5", toneText[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        {d != null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium tabular",
              d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {d > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : d < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            {d > 0 ? "+" : ""}
            {(d * 100).toFixed(1)} pts
          </span>
        )}
      </div>
      <p className="text-[10px] uppercase tracking-[0.22em] text-secondary mt-6">{label}</p>
      <p className={cn("font-display text-5xl mt-1 tabular leading-none", toneText[tone])}>
        {v == null ? "-" : pct(v)}
      </p>
      <p className="text-xs text-muted-foreground mt-3">{subValue ?? caption}</p>
    </div>
  );
}

/* ──────────────────────────────── trend chart ──────────────────────────── */

function TrendChart({
  data,
  tone,
  domain = [0, 1],
  target,
}: {
  data: { label: string; value: number }[];
  tone: Tone;
  domain?: [number, number];
  target?: number;
}) {
  if (data.length === 0) {
    return <div className="h-56 grid place-items-center text-sm text-muted-foreground">No runs recorded yet.</div>;
  }
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
          <YAxis
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            domain={domain}
            tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              color: "var(--color-foreground)",
            }}
            formatter={(v) => [pct(v as number, 2), "Accuracy"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={toneStroke[tone]}
            strokeWidth={2.5}
            dot={{ r: 3, fill: toneStroke[tone] }}
            activeDot={{ r: 5 }}
          />
          {target != null && (
            <Line
              type="monotone"
              dataKey={() => target}
              stroke="var(--color-muted-foreground)"
              strokeWidth={1}
              strokeDasharray="5 5"
              dot={false}
              legendType="none"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SectionShell({
  index,
  title,
  caption,
  badge,
  children,
}: {
  index: string;
  title: string;
  caption: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="executive-card rounded-3xl p-7 lg:p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-xl text-secondary/80 leading-none">{index}</span>
          <div>
            <h2 className="font-display text-2xl lg:text-3xl tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xl">{caption}</p>
          </div>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

/* ──────────────────────────────── risk section ─────────────────────────── */

function RiskSection({ runs, latest }: { runs: ModelEvalRun[]; latest: ModelEvalRun | null }) {
  const trend = runs.map((r) => ({ label: shortDate(r.run_date), value: r.accuracy }));
  const perClass = parsePerClassF1(latest?.notes ?? null);
  const tone = latest ? toneFor(latest.accuracy) : "warning";

  return (
    <SectionShell
      index="01"
      title="Risk Classifier"
      caption="Random-forest model classifying business risk level, graded on a 1,500-row held-out test set it never trained on."
      badge={<TargetBadge met={latest ? latest.accuracy >= 0.9 : null} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Accuracy across runs · target 90%</p>
          <TrendChart data={trend} tone={tone} domain={[0.7, 1]} target={0.9} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">
            Per-class F1 · latest run
          </p>
          {perClass ? (
            <div className="space-y-4">
              {perClass.map((c) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="text-foreground/90">{c.label}</span>
                    <span className="tabular text-muted-foreground">
                      F1 <span className="text-foreground font-medium">{c.f1.toFixed(3)}</span>
                      {c.support != null && <span className="ml-2 text-muted-foreground/70">n={c.support}</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-foreground/8 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.max(0, Math.min(1, c.f1)) * 100}%`, background: toneStroke[toneFor(c.f1)] }}
                    />
                  </div>
                  <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground tabular">
                    <span>Precision {c.precision.toFixed(3)}</span>
                    <span>Recall {c.recall.toFixed(3)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Per-class F1 not recorded for the latest run. Re-run{" "}
              <code className="text-foreground/80">py ml/eval_risk_model.py</code> to capture it.
            </p>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ─────────────────────────────── forecast section ──────────────────────── */

function ForecastSection({ runs, latest }: { runs: ModelEvalRun[]; latest: ModelEvalRun | null }) {
  const trend = runs.map((r) => ({ label: shortDate(r.run_date), value: r.accuracy }));
  const tone = latest ? toneFor(latest.accuracy) : "warning";
  const mape = parseNoteNumber(latest?.notes ?? null, "mape");
  const rmse = parseNoteNumber(latest?.notes ?? null, "rmse");
  const n = parseNoteNumber(latest?.notes ?? null, "n");

  const stats = [
    { label: "Accuracy (1 − MAPE)", value: latest ? pct(latest.accuracy, 2) : "-" },
    { label: "MAPE", value: mape != null ? pct(mape, 2) : "-" },
    { label: "RMSE", value: rmse != null ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(rmse) : "-" },
    { label: "Test rows", value: n != null ? n.toLocaleString() : "-" },
  ];

  return (
    <SectionShell
      index="02"
      title="Revenue Forecast"
      caption="Gradient-boosted forecast of revenue, scored as 1 − mean absolute percentage error on the held-out test set."
      badge={<TargetBadge met={latest ? latest.accuracy >= 0.9 : null} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Accuracy across runs · target 90%</p>
          <TrendChart data={trend} tone={tone} domain={[0.7, 1]} target={0.9} />
        </div>
        <div className="grid grid-cols-2 gap-px bg-border/60 rounded-2xl overflow-hidden self-start">
          {stats.map((s) => (
            <div key={s.label} className="bg-[var(--surface-3)] p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.label}</p>
              <p className="font-display text-2xl mt-1.5 tabular">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

/* ──────────────────────────────── llm section ──────────────────────────── */

function LlmSection({ runs, latest }: { runs: LlmEvalRun[]; latest: LlmEvalRun | null }) {
  const trend = runs.map((r) => ({ label: shortDate(r.run_at), value: r.pass_rate }));
  const tone = latest ? toneFor(latest.pass_rate, 0.9, 0.7) : "warning";
  const failures = latest?.failures ?? [];

  return (
    <SectionShell
      index="03"
      title="LLM Insight Agent"
      caption="An independent LLM-as-judge grades the insight agent's free-text output against golden references. Pass = every rubric dimension ≥ 3 and zero hallucinated numbers."
      badge={
        latest ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hidden sm:block">
            {latest.agent_model} · judged by {latest.judge_model}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Pass rate across runs</p>
          <TrendChart data={trend} tone={tone} domain={[0, 1]} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Currently failing scenarios</p>
            <span className="text-[11px] tabular text-muted-foreground">{failures.length}</span>
          </div>
          {!latest ? (
            <p className="text-sm text-muted-foreground">No LLM eval runs recorded yet.</p>
          ) : failures.length === 0 ? (
            <div className="surface-inset rounded-2xl p-6 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              <div>
                <p className="font-display text-lg leading-tight">All scenarios passing</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {latest.passed}/{latest.total} golden scenarios cleared the rubric.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[18rem] overflow-y-auto scrollbar-slim pr-1">
              {failures.map((f) => (
                <FailureRow key={f.scenario_id} failure={f} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

function FailureRow({ failure }: { failure: EvalRunFailure }) {
  const [open, setOpen] = useState(false);
  const v = failure.verdict;
  const dims = v
    ? [
        { key: "Factual", score: v.factual_correctness },
        { key: "Drivers", score: v.cites_right_drivers },
        { key: "Action", score: v.actionability },
        { key: "No-hallucination", score: v.hallucination },
      ]
    : [];

  return (
    <div className="surface-inset rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left group"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm font-medium truncate">{failure.scenario_id}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {v && (
            <span className="hidden sm:flex items-center gap-1">
              {dims.map((d) => (
                <span
                  key={d.key}
                  title={`${d.key}: ${d.score}/5`}
                  className={cn(
                    "h-1.5 w-4 rounded-full",
                    d.score >= 3 ? "bg-success/70" : "bg-destructive/70",
                  )}
                />
              ))}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 -mt-1 space-y-3 text-sm">
          {failure.judgeError ? (
            <p className="text-destructive">Judge error: {failure.judgeError}</p>
          ) : v ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {dims.map((d) => (
                  <div key={d.key} className="flex items-center justify-between rounded-lg bg-foreground/5 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{d.key}</span>
                    <span className={cn("tabular text-sm font-medium", d.score >= 3 ? "text-success" : "text-destructive")}>
                      {d.score}/5
                    </span>
                  </div>
                ))}
              </div>
              {v.hallucinated_numbers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Hallucinated:</span>
                  {v.hallucinated_numbers.map((h, i) => (
                    <span key={i} className="text-[11px] rounded bg-destructive/12 text-destructive px-1.5 py-0.5 tabular">
                      {h}
                    </span>
                  ))}
                </div>
              )}
              {v.overall && (
                <p className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                  <Activity className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {v.overall}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">No verdict recorded for this scenario.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── real-world backtest ───────────────────────── */

// Hard visual break so the real-world pilot is never read as part of the
// synthetic eval numbers above.
function SyntheticRealDivider() {
  return (
    <div className="flex items-center gap-4 pt-6">
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <FlaskConical className="h-3.5 w-3.5" /> Synthetic held-out eval
      </span>
      <span className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] text-secondary">
        Real-world backtest <Building2 className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function RealWorldBacktestPanel({
  backtest,
  loading,
  error,
}: {
  backtest: RealBacktest | null;
  loading: boolean;
  error: unknown;
}) {
  return (
    <section className="executive-card rounded-3xl p-7 lg:p-8 border border-secondary/20">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center h-10 w-10 rounded-2xl bg-secondary/12 text-secondary">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-2xl lg:text-3xl tracking-tight">Real-World Backtest</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              10 real public companies (SEC EDGAR financials + hand-verified 10-K concentration).
              Does an elevated risk tier in year N precede a real revenue decline the next year?
            </p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border border-secondary/25 bg-secondary/10 text-secondary shrink-0">
          Separate from synthetic eval
        </span>
      </div>

      {/* Pilot caveat — always shown, even with data */}
      <div className="surface-inset rounded-2xl p-4 flex items-start gap-3 mb-6">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground/90 font-medium">Directional pilot, not a statistically powered study.</span>{" "}
          N&nbsp;=&nbsp;10 companies (40 year-over-year transitions, not independent). These figures are
          kept entirely separate from the synthetic eval above and are never combined into one headline accuracy number.
        </p>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-foreground/5 animate-pulse" />
      ) : error || !backtest ? (
        <div className="surface-inset rounded-2xl p-6">
          <p className="text-sm text-muted-foreground">
            No real-world metrics available. Build them with{" "}
            <code className="text-foreground/80">py ml/backtest_real.py</code> and seed{" "}
            <code className="text-foreground/80">executive_metrics_real</code> (needs the read-policy migration applied).
          </p>
        </div>
      ) : (
        <RealBacktestBody backtest={backtest} />
      )}
    </section>
  );
}

function RealBacktestBody({ backtest }: { backtest: RealBacktest }) {
  const { elevated, low, transitions, companies } = backtest;
  const revLift = elevated.revenueDeclineRate - low.revenueDeclineRate;

  return (
    <>
      {/* Headline comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Revenue decline — the clean signal */}
        <div className="surface-inset rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Elevated tier → next-year revenue decline
            </p>
            <ArrowDownRight className="h-4 w-4 text-secondary" />
          </div>
          <div className="flex items-end gap-6 mt-3">
            <div>
              <p className="font-display text-4xl tabular text-foreground leading-none">
                {Number.isFinite(elevated.revenueDeclineRate) ? pct(elevated.revenueDeclineRate, 0) : "-"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                High/Critical · {elevated.revenueDecline}/{elevated.n}
              </p>
            </div>
            <div className="pb-1">
              <p className="font-display text-2xl tabular text-muted-foreground leading-none">
                {Number.isFinite(low.revenueDeclineRate) ? pct(low.revenueDeclineRate, 0) : "-"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Low · {low.revenueDecline}/{low.n}
              </p>
            </div>
          </div>
          {Number.isFinite(revLift) && (
            <p className="text-xs text-success mt-3">
              +{(revLift * 100).toFixed(0)} pts higher for elevated tiers, the expected direction.
            </p>
          )}
        </div>

        {/* Margin compression — inverted, flagged honestly */}
        <div className="surface-inset rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Elevated tier → next-year margin compression
            </p>
            <Minus className="h-4 w-4 text-warning" />
          </div>
          <div className="flex items-end gap-6 mt-3">
            <div>
              <p className="font-display text-4xl tabular text-foreground leading-none">
                {Number.isFinite(elevated.marginCompressionRate) ? pct(elevated.marginCompressionRate, 0) : "-"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                High/Critical · {elevated.marginCompression}/{elevated.n}
              </p>
            </div>
            <div className="pb-1">
              <p className="font-display text-2xl tabular text-muted-foreground leading-none">
                {Number.isFinite(low.marginCompressionRate) ? pct(low.marginCompressionRate, 0) : "-"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Low · {low.marginCompression}/{low.n}
              </p>
            </div>
          </div>
          <p className="text-xs text-warning mt-3">
            Inverted: elevated companies are already at the margin floor, so Low (healthy) names
            compress more. Revenue decline is the informative outcome here.
          </p>
        </div>
      </div>

      {/* Per-company-year detail */}
      <div className="flex items-center gap-3 mb-3">
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Tier at N vs actual outcome at N+1 · {transitions.length} transitions, {companies} companies
        </p>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="max-h-[22rem] overflow-y-auto scrollbar-slim rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--surface-3)] text-muted-foreground">
            <tr className="text-left">
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-4 py-2.5">Company</th>
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-3 py-2.5">FY</th>
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-3 py-2.5">Tier (N)</th>
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-3 py-2.5 text-right">Revenue Δ</th>
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-3 py-2.5 text-right">Margin Δ</th>
              <th className="font-medium text-[11px] uppercase tracking-[0.14em] px-4 py-2.5">Outcome N+1</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map((t) => (
              <BacktestRow key={`${t.ticker}-${t.yearN}`} t={t} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function tierClass(tier: string): string {
  if (tier === "Critical") return "bg-destructive/12 text-destructive border-destructive/25";
  if (tier === "High") return "bg-warning/12 text-warning border-warning/25";
  return "bg-success/12 text-success border-success/25";
}

function BacktestRow({ t }: { t: BacktestTransition }) {
  return (
    <tr className="border-t border-border/60">
      <td className="px-4 py-2.5 font-medium">{t.ticker}</td>
      <td className="px-3 py-2.5 tabular text-muted-foreground">
        {t.yearN}→{t.yearN1}
        {t.yearGap > 1 && <span className="text-warning" title="crosses a missing fiscal year"> *</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className={cn("text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full border", tierClass(t.tierRule))}>
          {t.tierRule}
        </span>
      </td>
      <td className={cn("px-3 py-2.5 text-right tabular", t.revenueDecline ? "text-destructive" : "text-foreground/80")}>
        {t.revenueChangePct >= 0 ? "+" : ""}
        {t.revenueChangePct.toFixed(1)}%
      </td>
      <td className={cn("px-3 py-2.5 text-right tabular", t.marginCompression ? "text-destructive" : "text-foreground/80")}>
        {t.marginChangePp >= 0 ? "+" : ""}
        {t.marginChangePp.toFixed(1)}pp
      </td>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {t.revenueDecline ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <ArrowDownRight className="h-3.5 w-3.5" /> revenue
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-success">
              <ArrowUpRight className="h-3.5 w-3.5" /> revenue
            </span>
          )}
          {t.marginCompression && <span className="text-warning">· margin↓</span>}
        </span>
      </td>
    </tr>
  );
}

/* ──────────────────────────────── target badge ─────────────────────────── */

function TargetBadge({ met }: { met: boolean | null }) {
  if (met == null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border shrink-0",
        met ? "text-success bg-success/12 border-success/25" : "text-warning bg-warning/12 border-warning/25",
      )}
    >
      {met ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {met ? "Target met" : "Below target"}
    </span>
  );
}
