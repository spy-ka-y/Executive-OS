// Surfaces the data-quality report so users see exactly what's wrong with their
// upload (and how trustworthy the downstream analysis is) instead of getting
// confident output over broken data.
import { useMemo, useState } from "react";
import { ShieldCheck, AlertTriangle, ChevronDown } from "lucide-react";
import type { DatasetColumn, DatasetRow } from "@/lib/api/types";
import { validateDataset } from "@/lib/api/data-quality";

const SEV_CLS: Record<"high" | "med" | "low", string> = {
  high: "text-destructive",
  med: "text-warning",
  low: "text-muted-foreground",
};

export function DataQualityPanel({ schema, rows }: { schema: DatasetColumn[]; rows: DatasetRow[] }) {
  const report = useMemo(() => validateDataset(schema, rows), [schema, rows]);
  const [open, setOpen] = useState(false);
  if (!report.rowCount) return null;

  const tone = report.score >= 80 ? "success" : report.score >= 55 ? "warning" : "destructive";
  const toneText = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-destructive";

  return (
    <div className="executive-card rounded-xl p-5">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {report.score >= 80 ? <ShieldCheck className={`h-4 w-4 ${toneText}`} /> : <AlertTriangle className={`h-4 w-4 ${toneText}`} />}
          <div className="text-left">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Data Quality</p>
            <p className="text-sm font-medium">
              <span className={toneText}>{report.score}/100</span>
              <span className="text-muted-foreground"> · {report.issues.length} issue{report.issues.length === 1 ? "" : "s"} · {report.rowCount.toLocaleString()} rows</span>
            </p>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {report.issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No quality issues detected. Analysis runs on clean data.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.issues.map((iss, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${iss.severity === "high" ? "bg-destructive" : iss.severity === "med" ? "bg-warning" : "bg-muted-foreground"}`} />
                  <span className={SEV_CLS[iss.severity]}>{iss.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground pt-1">
            Score reflects missing values, type consistency, duplicate rows and sample size. Fix high-severity items before relying on the figures.
          </p>
        </div>
      )}
    </div>
  );
}
