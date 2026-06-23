// Login / sign-up screen, shown by the auth gate when no user is signed in.
// Talks to the Aurora-backed auth server functions via the auth context.
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = mode === "signin" ? await signIn(email, password) : await signUp(email, password, name);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      setBusy(false);
    }
    // On success the provider sets the user and the gate swaps in the app.
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="grid place-items-center h-11 w-11 rounded-xl border border-[var(--color-rose)]/45 bg-[var(--color-rose)]/12 font-display text-2xl leading-none text-[var(--color-rose)]">
            E
          </div>
          <div className="leading-none">
            <p className="font-display text-2xl tracking-tight">ExecutiveOS</p>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-1">Chief of Staff</p>
          </div>
        </div>

        <div className="executive-card rounded-2xl p-7">
          <h1 className="font-display text-2xl mb-1">{mode === "signin" ? "Sign in" : "Create your workspace"}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "signin" ? "Welcome back." : "Your data is private to your account."}
          </p>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <input
                type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full h-11 rounded-lg border border-border bg-card/40 px-3 text-sm outline-none focus:border-secondary/50"
              />
            )}
            <input
              type="email" required placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              className="w-full h-11 rounded-lg border border-border bg-card/40 px-3 text-sm outline-none focus:border-secondary/50"
            />
            <input
              type="password" required placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="w-full h-11 rounded-lg border border-border bg-card/40 px-3 text-sm outline-none focus:border-secondary/50"
            />

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit" disabled={busy}
              className="w-full h-11 rounded-lg bg-[var(--color-rose)]/25 border border-[var(--color-rose)]/45 text-sm font-medium hover:bg-[var(--color-rose)]/35 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground w-full text-center"
          >
            {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-5">
          <ShieldCheck className="h-3 w-3" /> Secured on Amazon Aurora PostgreSQL
        </p>
      </div>
    </div>
  );
}
