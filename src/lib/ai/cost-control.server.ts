// Server-only LLM cost controls. Sits in front of the single Gemini call path
// (executeBrain) and does three things so real usage neither runs up cost nor
// silently burns the free-tier quota:
//   1. Response cache — identical prompts (e.g. regenerating the same brief on
//      the same dataset) are served from memory instead of re-calling the model.
//   2. Daily call budget — once the configured number of live calls is spent,
//      further calls short-circuit so the app falls back to the built-in engine
//      (with the honest "built-in" banner) rather than erroring or overspending.
//   3. Token accounting — running token totals for visibility.
//
// NOTE: state is in-process. On a single long-running server this is global;
// on serverless it is per-instance and resets on cold start (best-effort). A
// DB-backed counter would be needed for a hard cross-instance budget.
import { createHash } from "node:crypto";

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const DAILY_CALL_BUDGET = () => num("LLM_DAILY_CALL_BUDGET", 250);
const CACHE_TTL_MS = () => num("LLM_CACHE_TTL_MS", 60 * 60 * 1000); // 1h
const CACHE_MAX = 500;

export function defaultModel(): string | undefined {
  const m = process.env.GEMINI_MODEL?.trim();
  return m && m.length ? m : undefined;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

let usage = {
  day: currentDay(),
  calls: 0,
  cacheHits: 0,
  promptTokens: 0,
  responseTokens: 0,
};

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollDayIfNeeded() {
  const today = currentDay();
  if (usage.day !== today) {
    usage = { day: today, calls: 0, cacheHits: 0, promptTokens: 0, responseTokens: 0 };
  }
}

export function cacheKey(parts: { section: string; json: boolean; model?: string; system: string; user: string }): string {
  return createHash("sha256")
    .update(`${parts.section}|${parts.json ? "json" : "text"}|${parts.model ?? "auto"}|${parts.system}|${parts.user}`)
    .digest("hex");
}

export function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  rollDayIfNeeded();
  usage.cacheHits++;
  return hit.value as T;
}

export function setCached<T>(key: string, value: T): void {
  if (cache.size >= CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS() });
}

/** True when today's live-call budget is already spent. */
export function isOverBudget(): boolean {
  rollDayIfNeeded();
  return usage.calls >= DAILY_CALL_BUDGET();
}

export function recordCall(promptTokens: number, responseTokens: number): void {
  rollDayIfNeeded();
  usage.calls++;
  usage.promptTokens += promptTokens || 0;
  usage.responseTokens += responseTokens || 0;
}

export function usageSnapshot() {
  rollDayIfNeeded();
  return {
    day: usage.day,
    calls: usage.calls,
    budget: DAILY_CALL_BUDGET(),
    remaining: Math.max(0, DAILY_CALL_BUDGET() - usage.calls),
    cacheHits: usage.cacheHits,
    cacheSize: cache.size,
    promptTokens: usage.promptTokens,
    responseTokens: usage.responseTokens,
    totalTokens: usage.promptTokens + usage.responseTokens,
  };
}
