// Live AI-brain status chip. Calls the pingBrain server function (a real, tiny
// AWS Bedrock call) on mount and shows the result next to the Aurora chip, so a
// single header screenshot proves both the AWS database and the AI brain are
// live. CLICK the chip to re-check on demand (e.g. right after enabling model
// access) without a full page reload. Short stale window so it self-heals.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { pingBrain } from "@/lib/agents/executeBrain.functions";

export function BrainStatus() {
  const ping = useServerFn(pingBrain);
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["bedrock-ping"],
    queryFn: () => ping(),
    refetchInterval: false,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: 1,
  });

  const ok = !!data && data.ok === true;
  const checking = isLoading || isFetching;
  const dot = checking ? "bg-muted-foreground animate-pulse" : ok ? "bg-success shadow-[0_0_8px_var(--color-success)]" : "bg-destructive";
  const border = ok ? "border-success/30" : checking ? "border-border" : "border-destructive/30";
  const text = ok ? "text-success" : checking ? "text-muted-foreground" : "text-destructive";

  const label = checking ? "Bedrock · checking" : ok ? "Bedrock · connected" : "Bedrock · offline";
  const reason =
    data && data.ok
      ? `Live AI brain — ${data.model} · ${data.latencyMs}ms`
      : isError
        ? "Could not reach the AI brain server function."
        : data && !data.ok
          ? `${data.code}: ${data.message}`
          : "Checking the Bedrock AI brain…";
  const title = `${reason}\n(click to re-check)`;

  return (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={checking}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border ${border} px-2.5 py-1 ${text} cursor-pointer disabled:cursor-wait`}
    >
      <Sparkles className="h-3 w-3" />
      <span className="text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </button>
  );
}
