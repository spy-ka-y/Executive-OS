// Live AI-brain status chip. Calls the pingBrain server function (a real, tiny
// Gemini call) once on mount and shows the result next to the Aurora chip, so a
// single header screenshot proves both the AWS database and the AI brain are
// live. Pings once per page load (no polling) to conserve quota.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { pingBrain } from "@/lib/agents/executeBrain.functions";

export function BrainStatus() {
  const ping = useServerFn(pingBrain);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["gemini-ping"],
    queryFn: () => ping(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const ok = !!data && data.ok === true;
  const checking = isLoading;
  const dot = checking ? "bg-muted-foreground" : ok ? "bg-success shadow-[0_0_8px_var(--color-success)]" : "bg-destructive";
  const border = ok ? "border-success/30" : checking ? "border-border" : "border-destructive/30";
  const text = ok ? "text-success" : checking ? "text-muted-foreground" : "text-destructive";

  const label = checking ? "Gemini · checking" : ok ? "Gemini · connected" : "Gemini · offline";
  const title =
    data && data.ok
      ? `Live AI brain — ${data.model} · ${data.latencyMs}ms`
      : isError
        ? "Could not reach the AI brain server function."
        : data && !data.ok
          ? `${data.code}: ${data.message}`
          : "Checking the Gemini AI brain…";

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border ${border} px-2.5 py-1 ${text}`}
    >
      <Sparkles className="h-3 w-3" />
      <span className="text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </span>
  );
}
