// Statistical-fit indicator. Surfaces how trustworthy a trend/forecast is so a
// weak fit (noise) is visually distinguished from a strong one, instead of every
// projection looking equally confident.
import type { TrendFit } from "@/lib/api/statistics";

const STYLES: Record<TrendFit["strength"], { label: string; cls: string }> = {
  strong: { label: "Strong fit", cls: "bg-success/15 text-success border-success/30" },
  moderate: { label: "Moderate fit", cls: "bg-secondary/15 text-secondary border-secondary/30" },
  weak: { label: "Weak fit", cls: "bg-warning/15 text-warning border-warning/30" },
  insufficient: { label: "Too little data", cls: "bg-muted text-muted-foreground border-border" },
};

export function FitBadge({ fit, mape }: { fit: TrendFit; mape?: number | null }) {
  const s = STYLES[fit.strength];
  const detail =
    fit.strength === "insufficient"
      ? `${fit.n} data points`
      : `R² ${fit.r2.toFixed(2)} · p ${fit.pValue.toFixed(2)}${mape != null ? ` · ±${mape}% backtest` : ""}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${s.cls}`}
      title={`Trend fit on your revenue series. ${detail}.`}
    >
      {s.label}
      <span className="font-normal normal-case tracking-normal opacity-80">{detail}</span>
    </span>
  );
}
