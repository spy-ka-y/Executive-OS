# Deploying ExecutiveOS

The deployment guide lives in [`docs/DEPLOY.md`](docs/DEPLOY.md) and the Aurora
walkthrough in [`docs/AURORA_SETUP.md`](docs/AURORA_SETUP.md). This file used to
describe an earlier Supabase and Gemini setup and was replaced to avoid
conflicting instructions.

Quick summary: import the repo into Vercel (Nitro `vercel` preset, build with
`npm run build`), then set `DATABASE_URL` and the `BEDROCK_AWS_*` variables listed
in [`.env.example`](.env.example).
