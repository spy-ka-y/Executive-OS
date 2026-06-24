// Persists one eval-run summary row. Primary target is Aurora (eval_runs, self-
// created if absent). If Aurora is unreachable or no DATABASE_URL is set, the
// summary is appended to a local JSONL so a run's results are never lost.
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import type { JudgeVerdict } from "../ai/judge.server";

export interface RunFailure {
  scenario_id: string;
  verdict: JudgeVerdict | null;
  judgeError?: string;
}

export interface RunSummary {
  runAt: string;
  agentModel: string;
  judgeModel: string;
  total: number;
  passed: number;
  passRate: number;
  reportPath: string;
  failures: RunFailure[];
  notes: string;
}

// Self-creating DDL for the eval_runs table (no schema qualifier so it applies
// to whichever default schema the Aurora connection uses).
export const EVAL_RUNS_DDL = `create table if not exists eval_runs (
  id          bigint generated always as identity primary key,
  run_at      timestamptz not null default now(),
  agent_model text,
  judge_model text,
  total       integer not null,
  passed      integer not null,
  pass_rate   numeric not null,
  report_path text,
  failures    jsonb,
  notes       text
)`;

function appendJsonl(jsonlPath: string, summary: RunSummary): void {
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  fs.appendFileSync(jsonlPath, JSON.stringify(summary) + "\n", "utf8");
}

async function writeAurora(databaseUrl: string, summary: RunSummary): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(EVAL_RUNS_DDL);
    await pool.query(
      `insert into eval_runs
         (run_at, agent_model, judge_model, total, passed, pass_rate, report_path, failures, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        summary.runAt,
        summary.agentModel,
        summary.judgeModel,
        summary.total,
        summary.passed,
        summary.passRate,
        summary.reportPath,
        JSON.stringify(summary.failures),
        summary.notes,
      ],
    );
  } finally {
    await pool.end();
  }
}

export async function persistRun(
  summary: RunSummary,
  opts: { databaseUrl?: string; jsonlPath: string },
): Promise<{ target: "aurora" | "jsonl"; detail: string }> {
  if (opts.databaseUrl) {
    try {
      await writeAurora(opts.databaseUrl, summary);
      return { target: "aurora", detail: "eval_runs row inserted" };
    } catch (e) {
      console.warn(`[eval] Aurora write failed (${e instanceof Error ? e.message : e}) — writing JSONL.`);
    }
  }
  appendJsonl(opts.jsonlPath, summary);
  return { target: "jsonl", detail: opts.jsonlPath };
}
