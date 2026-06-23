// Vercel server functions that mediate ALL database access. The browser calls
// these RPC endpoints; they run on Vercel serverless and query Amazon Aurora
// PostgreSQL via src/lib/db/aurora.server.ts. No SQL or DATABASE_URL ever
// reaches the client. This is the deliberate "Vercel front end → AWS database"
// boundary the architecture is built around.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DbValue, DbRow } from "./aurora.server";

// ── helpers (server-only; imported lazily so pg never enters the client) ──────
const j = z.any();
const idIn = z.object({ id: z.string().min(1) });
const dsIn = z.object({ dataset_id: z.string().min(1) });
const dsNullableIn = z.object({ dataset_id: z.string().nullable() });

// ── Datasets ─────────────────────────────────────────────────────────────────
export const dbListDatasets = createServerFn({ method: "GET" }).handler(async () => {
  const { queryRows } = await import("./aurora.server");
  return queryRows("select * from datasets order by created_at desc");
});

export const dbGetDataset = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => idIn.parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne("select * from datasets where id = $1", [data.id]);
  });

export const dbGetDatasetRows = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1), limit: z.number().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    const rows = await queryRows<{ data: DbValue }>(
      "select data from dataset_rows where dataset_id = $1 order by row_index asc limit $2",
      [data.id, data.limit ?? 5000],
    );
    return rows.map((r) => r.data);
  });

export const dbCreateDataset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1),
      source_filename: z.string().nullable().optional(),
      source_url: z.string().nullable().optional(),
      schema: z.array(z.object({ name: z.string(), type: z.string() })),
      rows: z.array(z.record(z.string(), j)),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { withTransaction } = await import("./aurora.server");
    return withTransaction(async (client) => {
      const ins = await client.query(
        `insert into datasets (name, source_filename, source_url, row_count, column_count, schema)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [data.name, data.source_filename ?? null, data.source_url ?? null, data.rows.length, data.schema.length, JSON.stringify(data.schema)],
      );
      const ds = ins.rows[0] as DbRow & { id: string };
      const capped = data.rows.slice(0, 5000);
      // Bulk insert rows in chunks of 500.
      for (let i = 0; i < capped.length; i += 500) {
        const chunk = capped.slice(i, i + 500);
        const values: string[] = [];
        const params: unknown[] = [];
        chunk.forEach((row, k) => {
          const base = k * 3;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
          params.push(ds.id, i + k, JSON.stringify(row));
        });
        await client.query(
          `insert into dataset_rows (dataset_id, row_index, data) values ${values.join(",")}`,
          params,
        );
      }
      return ds;
    });
  });

export const dbDeleteDataset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idIn.parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    await query("delete from datasets where id = $1", [data.id]);
    return { ok: true };
  });

// ── KPI summaries / forecasts ────────────────────────────────────────────────
export const dbSaveKpiSummary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ dataset_id: z.string(), metrics: j }).parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    await query("insert into kpi_summaries (dataset_id, metrics) values ($1,$2)", [data.dataset_id, JSON.stringify(data.metrics)]);
    return { ok: true };
  });

export const dbLatestKpiSummary = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsIn.parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    const row = await queryOne<{ metrics: unknown }>(
      "select metrics from kpi_summaries where dataset_id = $1 order by created_at desc limit 1",
      [data.dataset_id],
    );
    return row?.metrics ?? null;
  });

export const dbSaveForecast = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ dataset_id: z.string(), horizon: z.number(), series: j }).parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    await query("insert into forecast_results (dataset_id, horizon, series) values ($1,$2,$3)", [data.dataset_id, data.horizon, JSON.stringify(data.series)]);
    return { ok: true };
  });

// ── CEO Brief ────────────────────────────────────────────────────────────────
export const dbSaveCeoBrief = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    dataset_id: z.string(), summary: z.string(), risks: j, opportunities: j, priorities: j,
    forecast_highlights: j, health_score: z.number(), meta: j.optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne(
      `insert into ceo_briefs (dataset_id, summary, risks, opportunities, priorities, forecast_highlights, health_score, meta)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [data.dataset_id, data.summary, JSON.stringify(data.risks), JSON.stringify(data.opportunities),
       JSON.stringify(data.priorities), JSON.stringify(data.forecast_highlights), data.health_score, data.meta ? JSON.stringify(data.meta) : null],
    );
  });

export const dbLatestCeoBrief = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsIn.parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne("select * from ceo_briefs where dataset_id = $1 order by created_at desc limit 1", [data.dataset_id]);
  });

// ── Consultant report ────────────────────────────────────────────────────────
export const dbSaveConsultantReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    dataset_id: z.string(), problems: j, recommendations: j,
    impact_score: z.number(), roi_score: z.number(), risk_score: z.number(),
    investment_thesis: j.optional(), meta: j.optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne(
      `insert into consultant_reports (dataset_id, problems, recommendations, impact_score, roi_score, risk_score, investment_thesis, meta)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [data.dataset_id, JSON.stringify(data.problems), JSON.stringify(data.recommendations), data.impact_score, data.roi_score, data.risk_score,
       data.investment_thesis ? JSON.stringify(data.investment_thesis) : null, data.meta ? JSON.stringify(data.meta) : null],
    );
  });

export const dbLatestConsultantReport = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsIn.parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne("select * from consultant_reports where dataset_id = $1 order by created_at desc limit 1", [data.dataset_id]);
  });

// ── Decision simulations ─────────────────────────────────────────────────────
export const dbSaveSimulation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    dataset_id: z.string(), name: z.string(), scenario: j,
    revenue_impact: z.number(), profit_impact: z.number(), risk: z.number(), confidence: z.number(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne(
      `insert into decision_simulations (dataset_id, name, scenario, revenue_impact, profit_impact, risk, confidence)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [data.dataset_id, data.name, JSON.stringify(data.scenario), data.revenue_impact, data.profit_impact, data.risk, data.confidence],
    );
  });

export const dbListSimulations = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsIn.parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    return queryRows("select * from decision_simulations where dataset_id = $1 order by created_at desc", [data.dataset_id]);
  });

// ── Boardroom conversations ──────────────────────────────────────────────────
export const dbSaveBoardroom = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ dataset_id: z.string().nullable(), topic: z.string(), messages: j }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne("insert into boardroom_conversations (dataset_id, topic, messages) values ($1,$2,$3) returning *",
      [data.dataset_id, data.topic, JSON.stringify(data.messages)]);
  });

export const dbListBoardroom = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsNullableIn.parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    if (data.dataset_id) return queryRows("select * from boardroom_conversations where dataset_id = $1 order by created_at desc", [data.dataset_id]);
    return queryRows("select * from boardroom_conversations order by created_at desc");
  });

// ── Action plans ─────────────────────────────────────────────────────────────
export const dbUpsertActionPlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string().optional(), dataset_id: z.string().nullable(), horizon_days: z.number(), initiatives: j, progress: z.number(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    if (data.id) {
      return queryOne(
        "update action_plans set initiatives=$1, progress=$2, updated_at=now() where id=$3 returning *",
        [JSON.stringify(data.initiatives), data.progress, data.id],
      );
    }
    return queryOne(
      "insert into action_plans (dataset_id, horizon_days, initiatives, progress) values ($1,$2,$3,$4) returning *",
      [data.dataset_id, data.horizon_days, JSON.stringify(data.initiatives), data.progress],
    );
  });

export const dbListActionPlans = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsNullableIn.parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    if (data.dataset_id) return queryRows("select * from action_plans where dataset_id = $1 order by horizon_days asc", [data.dataset_id]);
    return queryRows("select * from action_plans order by horizon_days asc");
  });

// ── Generated reports ────────────────────────────────────────────────────────
export const dbListReports = createServerFn({ method: "GET" }).handler(async () => {
  const { queryRows } = await import("./aurora.server");
  return queryRows("select * from generated_reports order by created_at desc");
});

export const dbSaveReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ dataset_id: z.string().nullable(), kind: z.string(), title: z.string(), storage_path: z.string().nullable() }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne("insert into generated_reports (dataset_id, kind, title, storage_path) values ($1,$2,$3,$4) returning *",
      [data.dataset_id, data.kind, data.title, data.storage_path]);
  });

// ── Executive decisions (memory + outcome loop) ──────────────────────────────
export const dbSaveExecutiveDecision = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    dataset_id: z.string().nullable(), conversation_id: z.string().nullable().optional(),
    question: z.string(), decision: z.string(), consensus_score: z.number(), confidence_score: z.number(),
    revenue_impact: z.string().nullable().optional(), profit_impact: z.string().nullable().optional(),
    risk_level: z.string(), owner: z.string().nullable().optional(), timeline: z.string().nullable().optional(),
    next_actions: z.array(z.string()),
  }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./aurora.server");
    return queryOne(
      `insert into executive_decisions
        (dataset_id, conversation_id, question, decision, consensus_score, confidence_score, revenue_impact, profit_impact, risk_level, owner, timeline, next_actions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [data.dataset_id, data.conversation_id ?? null, data.question, data.decision, data.consensus_score, data.confidence_score,
       data.revenue_impact ?? null, data.profit_impact ?? null, data.risk_level, data.owner ?? null, data.timeline ?? null, JSON.stringify(data.next_actions)],
    );
  });

export const dbListExecutiveDecisions = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => dsNullableIn.parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    const rows = data.dataset_id
      ? await queryRows<DbRow>("select * from executive_decisions where dataset_id = $1 order by created_at desc", [data.dataset_id])
      : await queryRows<DbRow>("select * from executive_decisions order by created_at desc");
    return rows.map((r) => ({ ...r, next_actions: Array.isArray(r.next_actions) ? r.next_actions : [] }));
  });

export const dbUpdateExecutiveDecision = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string(),
    patch: z.object({
      status: z.string().optional(), progress: z.number().optional(), owner: z.string().nullable().optional(),
      timeline: z.string().nullable().optional(), due_date: z.string().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${i++}`);
      params.push(v);
    }
    if (sets.length) {
      sets.push("updated_at = now()");
      params.push(data.id);
      await query(`update executive_decisions set ${sets.join(", ")} where id = $${i}`, params);
    }
    return { ok: true };
  });

export const dbDeleteExecutiveDecision = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => idIn.parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    await query("delete from executive_decisions where id = $1", [data.id]);
    return { ok: true };
  });

export const dbRecordDecisionOutcome = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string(), outcome: z.string(), actual_value: z.number().nullable().optional(), outcome_notes: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./aurora.server");
    await query(
      "update executive_decisions set outcome=$1, actual_value=$2, outcome_notes=$3, outcome_at=now() where id=$4",
      [data.outcome, data.actual_value ?? null, data.outcome_notes ?? null, data.id],
    );
    return { ok: true };
  });

// ── Evaluation / accuracy reads ──────────────────────────────────────────────
export const dbGetModelEvalRuns = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ model_name: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { queryRows } = await import("./aurora.server");
    return queryRows("select id, model_name, run_date, accuracy, metric_type, notes from model_eval_runs where model_name = $1 order by run_date asc", [data.model_name]);
  });

export const dbGetLlmEvalRuns = createServerFn({ method: "GET" }).handler(async () => {
  const { queryRows } = await import("./aurora.server");
  return queryRows("select id, run_at, agent_model, judge_model, total, passed, pass_rate, report_path, failures, notes from eval_runs order by run_at asc");
});

export const dbGetRealMetrics = createServerFn({ method: "GET" }).handler(async () => {
  const { queryRows } = await import("./aurora.server");
  return queryRows("select ticker, fiscal_year, revenue, profit_margin, risk_level_rule, risk_level_model from executive_metrics_real order by ticker, fiscal_year");
});

// ── Health probe ─────────────────────────────────────────────────────────────
export const dbPing = createServerFn({ method: "GET" }).handler(async () => {
  const { pingAurora } = await import("./aurora.server");
  return pingAurora();
});
