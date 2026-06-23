// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Make non-VITE_ env vars (e.g. GEMINI_API_KEY) available to SERVER code in
// `vite dev`. Vite only injects VITE_-prefixed vars into the bundle; our server
// functions read process.env, which Vite does NOT populate from .env on its own.
// Without this, a key present in .env still reads as "missing" at runtime and
// every agent / the chat falls back to the built-in engine. In production the
// host (Vercel) provides these vars directly, so this is a dev-time bridge.
const _env = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
for (const _k in _env) {
  if (process.env[_k] === undefined) process.env[_k] = _env[_k];
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Enable the Nitro deploy plugin and target Vercel so SSR + server functions
  // (the Gemini AI brain) ship as Vercel serverless functions. Override the
  // preset with the NITRO_PRESET env var for other hosts. The Lovable sandbox
  // still force-builds Cloudflare regardless of this setting.
  nitro: { preset: process.env.NITRO_PRESET || "vercel" },
});
