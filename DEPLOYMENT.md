# Deploying ExecutiveOS to Vercel

ExecutiveOS is a **TanStack Start (SSR)** app. The Gemini AI runs as **server
functions**, so it must be deployed as a server (not a static site). The build
is already configured for Vercel via the Nitro `vercel` preset in
[`vite.config.ts`](./vite.config.ts), which emits the Vercel Build Output API
format (`.vercel/output/`).

## 1. Import the repo
- Go to https://vercel.com/new and import `RedMonkey2664/Executive-OS`.
- Build command: `npm run build` · Install: `npm install`.
- Framework preset: Vercel usually auto-detects the `.vercel/output`. If the
  deploy serves a blank/static page, set the preset to **Other** and redeploy.

## 2. Set environment variables (required)
Settings → Environment Variables. Add all **7** for **Production, Preview, and
Development**. Copy the values from your local `.env` (which is git-ignored).

| Variable | Used by |
| --- | --- |
| `SUPABASE_URL` | SSR / server |
| `SUPABASE_PUBLISHABLE_KEY` | SSR / server |
| `SUPABASE_PROJECT_ID` | SSR / server |
| `VITE_SUPABASE_URL` | client (baked in at build time) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client (baked in at build time) |
| `VITE_SUPABASE_PROJECT_ID` | client (baked in at build time) |
| `GEMINI_API_KEY` | server only — never exposed to the browser |

> The `VITE_*` vars are baked into the client bundle **at build time**, so they
> must exist **before** the build. If you add them after the first deploy, you
> must redeploy **without build cache**.

## 3. Redeploy
Deployments → latest → ⋯ → **Redeploy** → **uncheck "Use existing Build Cache"**.

## Verify it works
- App loads (no "Missing Supabase environment variable" error) → Supabase vars OK.
- AI Chat returns a real reply → `GEMINI_API_KEY` OK.
- DevTools → Network → filter `pendo` → requests return 200 → Novus analytics live.

## Optional: set env vars from the CLI instead of the dashboard
```bash
npm i -g vercel
vercel login
vercel link            # link this folder to the existing project
# push each var from your local .env to Production:
vercel env add SUPABASE_URL production
# ...repeat for the other 6, then:
vercel --prod          # redeploy
```
