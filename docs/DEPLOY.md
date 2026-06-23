# Deploying ExecutiveOS to Vercel

The app is a TanStack Start (SSR + server functions) project built with Vite +
Nitro. `vite build` emits the Vercel **Build Output API** (`.vercel/output`),
which Vercel deploys directly.

## 1. Vercel project settings

| Setting | Value |
| --- | --- |
| Framework preset | Other (Vite/Nitro Build Output API is auto-detected) |
| Build command | `npm run build` |
| Install command | `npm install` |
| Output directory | leave default (Vercel reads `.vercel/output`) |
| Node.js version | 20.x |

The build targets Vercel by default (`nitro.preset = "vercel"`). For another host
set the `NITRO_PRESET` env var (e.g. `node-server`, `cloudflare-pages`).

## 2. Environment variables (Vercel → Settings → Environment Variables)

Server-only (never exposed to the browser):

| Var | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Amazon Aurora PostgreSQL connection string (cluster endpoint or RDS Proxy). The app's entire data layer. Server-only. |
| `GEMINI_API_KEY` | yes (for live AI) | Google Gemini key. Aliases `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` also accepted. Without it the app runs on the built-in deterministic engine and says so. |
| `GEMINI_MODEL` | no | Override the default model (`gemini-2.5-flash`). |
| `LLM_DAILY_CALL_BUDGET` | no | Max live calls/day/instance before falling back to built-in (default 250). |
| `LLM_CACHE_TTL_MS` | no | Cache TTL for identical prompts (default 1h). |
| `PGSSL` | no | Set to `disable` only for a local non-TLS Postgres. Aurora uses TLS (default). |
| `SUPABASE_*` / `VITE_SUPABASE_*` | no | Optional auth shim only. The app runs fully on Aurora without them. |

## 3. Database setup (Amazon Aurora PostgreSQL)

1. Provision an Aurora PostgreSQL cluster (Serverless v2 is fine) and get its
   connection string.
2. Apply the schema (idempotent):
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
3. Set `DATABASE_URL` in Vercel and in local `.env`.

For high concurrency, put **Amazon RDS Proxy** in front and point `DATABASE_URL`
at the proxy endpoint — no code change. (`supabase/migrations/` is legacy from the
previous Supabase backend and is no longer used by the app.)

## 4. After deploy — verify live AI

1. Open the **AI Boardroom**. Section 16 "Provider Readiness" runs a real
   connectivity probe and shows **Connected** only if a model call actually
   succeeded. If it shows **Not Connected**, the CEO Brief / Consultant / Chat
   banners will state the exact reason (missing key, rate-limit, budget).
2. Generate a CEO Brief — the header badge reads **Live AI** when the model
   produced it, **Built-in analysis** (with the reason) otherwise.

## 5. Notes on the optional ML models

`ml/*.onnx` (the RandomForest risk classifier and the forecast model) run via
`onnxruntime-node`, a native module. They are **optional**: if the runtime or
model files are unavailable in the serverless environment, the risk tier and
ML-forecast surface honestly as "not computable" rather than failing.

The product's core analytics do **not** depend on ONNX: trend, forecast (with
prediction intervals + backtest), concentration, anomalies and data-quality all
run in pure TypeScript (`src/lib/api/statistics.ts`) and work everywhere.

## 6. Security reminder

This deploys as an **open app with no login** (see `docs/SECURITY.md`). Do not
put confidential company data on a public deploy until authentication + RLS are
enabled.
