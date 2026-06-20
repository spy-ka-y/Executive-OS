import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, MessageSquareText, Sparkles, ShieldAlert, TrendingUp, Compass, Lightbulb, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { PageHeader, EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useActiveDataset } from "@/lib/dataset-context";
import { getDataset, getDatasetRows } from "@/lib/api/datasets";
import { computeKpis } from "@/lib/api/analysis";
import { chat } from "@/lib/api/ai";
import type { ChatMessage } from "@/lib/api/types";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Executive Copilot, ExecutiveOS" }] }),
  component: ChatPage,
});

const STARTERS = [
  "Summarize the business for an executive audience.",
  "What is my biggest business risk right now?",
  "Where is revenue growth coming from?",
  "What should we do next quarter?",
];

const QUICK_ACTIONS: Array<{ label: string; prompt: string; icon: React.ElementType }> = [
  { label: "Executive Summary", prompt: "Give me a boardroom-ready executive summary of the business.", icon: Sparkles },
  { label: "Top Risks", prompt: "What are my biggest business risks and exposures right now?", icon: ShieldAlert },
  { label: "Growth Opportunities", prompt: "What are the top growth opportunities in this dataset?", icon: TrendingUp },
  { label: "Forecast Outlook", prompt: "Explain the forecast outlook and trajectory.", icon: Compass },
  { label: "Strategic Recommendations", prompt: "What should I do next quarter? Give me strategic recommendations.", icon: Lightbulb },
  { label: "Boardroom Summary", prompt: "Generate a boardroom summary with CEO, CFO, COO, and CMO perspectives.", icon: Users },
];

const AGENT_ID = "Se7l9eh9kb-0vhrP7QANVG9PZbo";

function ChatPage() {
  const { activeDatasetId } = useActiveDataset();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationId = useRef(crypto.randomUUID());

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
  const kpis = useMemo(
    () => (dataset && rows.length ? computeKpis(rows, dataset.schema) : null),
    [dataset, rows],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const suggestedPrompts = useMemo(() => {
    const set = new Set<string>();
    for (const s of STARTERS) set.add(s);
    for (const a of QUICK_ACTIONS) set.add(a.prompt);
    return set;
  }, []);

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      created_at: new Date().toISOString(),
    };

    if (typeof window !== "undefined" && window.pendo?.trackAgent) {
      window.pendo.trackAgent("prompt", {
        agentId: AGENT_ID,
        conversationId: conversationId.current,
        messageId: userMsg.id,
        content: userMsg.content,
        suggestedPrompt: suggestedPrompts.has(text.trim()),
      });
    }

    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);
    try {
      const reply = await chat({
        dataset_id: activeDatasetId,
        kpis,
        rows: dataset ? rows : undefined,
        schema: dataset?.schema,
        history: [...messages, userMsg],
        question: text.trim(),
      });
      setMessages((m) => [...m, reply]);

      if (typeof window !== "undefined" && window.pendo?.trackAgent) {
        window.pendo.trackAgent("agent_response", {
          agentId: AGENT_ID,
          conversationId: conversationId.current,
          messageId: reply.id,
          content: reply.content,
        });
      }
    } finally {
      setThinking(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="02, Executive Copilot"
        title="Executive Copilot"
        description="Your CEO advisor, strategy consultant, and decision-support agent in one. Every answer is grounded in your dataset and structured as Observation → Insight → Recommendation → Expected Outcome."
      />

      <div className="executive-card rounded-xl flex flex-col h-[70vh]">
        <div ref={scroller} className="flex-1 overflow-y-auto p-6 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="max-w-lg text-center">
                <MessageSquareText className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <h3 className="font-display text-2xl mb-2">Ask your Executive Copilot</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  {activeDatasetId ? "Ask about strategy, risks, growth opportunities, forecasts, or decisions." : "Tip: select a dataset in the sidebar for grounded, dataset-specific answers."}
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="text-left text-xs rounded-lg border border-border/60 bg-background/40 hover:bg-background/70 px-3 py-2.5 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" ? (
                  <div className="max-w-[85%]">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-secondary mb-1">
                      {m.agent ?? "Copilot"}
                    </p>
                    <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed text-foreground">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[75%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm shadow-elegant">
                    {m.content}
                  </div>
                )}
              </div>
            ))
          )}
          {thinking && (
            <div className="flex">
              <p className="text-xs text-muted-foreground italic animate-pulse">Copilot is reasoning over your dataset…</p>
            </div>
          )}
        </div>

        <div className="border-t border-border/60 px-3 pt-3">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_ACTIONS.map(({ label, prompt, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => void send(prompt)}
                disabled={thinking}
                className="inline-flex items-center gap-1.5 text-[11px] rounded-md border border-border/60 bg-background/40 hover:bg-background/70 px-2.5 py-1 transition-colors disabled:opacity-50"
              >
                <Icon className="h-3 w-3" /> {label}
              </button>
            ))}
          </div>
          <form
            className="pb-3 flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the Copilot, strategy, risks, forecasts, decisions…"
              rows={1}
              className="resize-none bg-background/40 border-border/60 min-h-[44px] max-h-32 transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
              }}
            />
            <Button type="submit" size="icon" disabled={thinking || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      {!activeDatasetId && (
        <div className="mt-6">
          <EmptyState
            title="No dataset selected"
            description="The Copilot can still discuss strategy, but answers become dataset-specific once you select a dataset in the sidebar."
          />
        </div>
      )}
    </>
  );
}
