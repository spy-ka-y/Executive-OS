// Live database status chip. Calls the dbPing server function (which runs a real
// `select version()` against Amazon Aurora PostgreSQL) and shows the result, so a
// demo can visibly prove the AWS connection on-screen. Re-checks every 60s.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database } from "lucide-react";
import { dbPing } from "@/lib/db/data.functions";

export function DbStatus() {
  const ping = useServerFn(dbPing);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["aurora-ping"],
    queryFn: () => ping(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  const ok = !!data && data.ok === true;
  const checking = isLoading;
  const dot = checking ? "bg-muted-foreground" : ok ? "bg-success shadow-[0_0_8px_var(--color-success)]" : "bg-destructive";
  const border = ok ? "border-success/30" : checking ? "border-border" : "border-destructive/30";
  const text = ok ? "text-success" : checking ? "text-muted-foreground" : "text-destructive";

  const label = checking ? "Aurora · checking" : ok ? "Aurora · connected" : "Aurora · offline";
  const title =
    data && data.ok
      ? `Amazon Aurora PostgreSQL — ${data.version} · ${data.latencyMs}ms (live select version())`
      : isError
        ? "Could not reach the database server function."
        : data && !data.ok
          ? data.message
          : "Checking Amazon Aurora PostgreSQL…";

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border ${border} px-2.5 py-1 ${text}`}
    >
      <Database className="h-3 w-3" />
      <span className="text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {ok && data.ok ? <span className="text-[10px] tabular-nums opacity-80">{data.latencyMs}ms</span> : null}
    </span>
  );
}
