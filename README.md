# ExecutiveOS

A decision-intelligence platform for executives. A company uploads its operating data and gets statistically grounded analysis: KPIs, a CEO brief, a strategy consultant report, and an AI boardroom where CEO, CFO, CMO, COO, Risk and Forecast agents debate a business problem and converge on one recommendation.

Built for the **AWS Databases x Vercel v0 Hackathon 2026** (Track 2, monetizable B2B app).

**Live demo:** https://executive-os.vercel.app

## What it does

| Area | What you get |
|---|---|
| Mission Control | Dashboard of KPIs for the active dataset |
| CEO Brief | An executive summary grounded in the uploaded data |
| Consultant Report | A strategy-consultant style analysis |
| AI Boardroom | Six role-based agents debating one problem to a single recommendation |
| Simulator | Scenario and decision simulation |
| Executive Memory | A decision log that records outcomes and tracks a real hit-rate |
| Strategic Signals, Decisions, Execution Center | Signals, decisions needing attention, and action plans |
| Reports | Generated reports with export (PDF and PowerPoint among them) |
| Model Accuracy | A dashboard showing how the models actually perform |
| AI Chat | A data-grounded chat with the same brain |

## How it is built

- **App:** TanStack Start (React 19, TypeScript, file-based routing), Tailwind CSS 4, Radix UI components.
- **Database:** Amazon Aurora PostgreSQL is the single source of truth. The browser never talks to it. Every read and write goes through zod-validated server functions (`src/lib/db/data.functions.ts`) that use a pooled `pg` client (`src/lib/db/aurora.server.ts`). Schema: `db/schema.sql`.
- **LLM:** AWS Bedrock (Claude), called server-side only (`src/lib/ai/gemini.server.ts`; the filename is a leftover from an earlier provider). Responses are cached and capped by a daily call budget. When the model is unavailable, the app says so and falls back to a built-in engine instead of pretending.
- **Models in the loop:** a trained risk classifier and a forecast model are exported to ONNX and run in Node through `onnxruntime-node`, so there is no Python at runtime. For risk, the model decides the tier and the LLM only explains why.
- **Statistics:** a real engine in `src/lib/api/statistics.ts` (OLS trend with R-squared and p-value, prediction intervals, backtest MAPE, HHI concentration, anomaly detection) with unit tests.
- **Deploy:** Vercel, using the Nitro `vercel` preset.

## Honest accuracy numbers

- The risk classifier scores **97.33%** on a held-out set of 1,500 rows. That data is **synthetic**, and the classes are imbalanced, so read the per-class F1 in `ml/README.md` rather than the headline. Critical recall is the weakest at 0.86.
- A separate pilot on real SEC EDGAR filings (10 companies, 40 year-over-year transitions) is in `docs/REAL_WORLD_BACKTEST_REPORT.md`. It is labelled a directional pilot, not a powered study, and the two sets of numbers are deliberately never blended.
- The held-out test set is never used for training, tuning or prompt design (see `data/seed/README.md`).

## Security

Passwords are hashed with Node's `scrypt` with a per-user salt. Sessions are random 256-bit tokens stored in Aurora and sent in an httpOnly, SameSite=Lax cookie (Secure in production). Every data function scopes queries by `user_id`. Secrets stay server-side. The full write-up, including the hardening backlog, is in [`docs/SECURITY.md`](docs/SECURITY.md).

Known gaps, listed here so nobody has to find them:

- No rate limiting on the auth endpoints yet, and no email verification or password reset.
- The database connection uses TLS with certificate verification turned off (`rejectUnauthorized: false` in `src/lib/db/aurora.server.ts`). The fix is to trust the RDS CA bundle.
- Writes to dataset-derived tables rely on unguessable dataset UUIDs and do not re-check ownership on every write.

## Run it locally

You need Node.js 20.19 or newer (or 22.12+), an Amazon Aurora PostgreSQL database (or any Postgres reachable through `DATABASE_URL`), and AWS credentials with Bedrock access.

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and the BEDROCK_AWS_* values
npm run db:setup         # applies db/schema.sql to the database in DATABASE_URL
npm run dev
```

Other scripts:

```bash
npm test                 # Vitest
npm run lint
npm run build
npm run eval:agent       # LLM eval harness
```

Use `npm install`, not `npm ci`: `package-lock.json` is currently out of sync with `package.json`.

The ML pipeline (training, ONNX export, evaluation and the Node parity check) is documented in [`ml/README.md`](ml/README.md). Deployment notes are in `docs/DEPLOY.md` and the Aurora walkthrough is in `docs/AURORA_SETUP.md`.

## Repository layout

```
src/
  routes/       file-based routes, one per screen
  lib/
    agents/     agent brains and server functions
    ai/         Bedrock client, cost controls, LLM judge
    api/        statistics, data quality, estimates, reports
    db/         Aurora client, auth, data server functions
    ml/         ONNX inference (server only)
  components/   app shell and shared UI
db/schema.sql   relational schema
ml/             training, ONNX export and evaluation scripts
data/seed/      synthetic train and test sets, golden eval cases, real backtest data
docs/           security, deployment, backtest and hackathon notes
scripts/        database setup
```

## Status

Hackathon submission, still evolving. Some documents in `docs/` were written before the move from Supabase and Gemini to Aurora and Bedrock, so where they disagree with this README, trust this README and the code.
