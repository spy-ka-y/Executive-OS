import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signInFn, signUpFn, signOutFn, getMeFn, type AuthUser } from "@/lib/auth/auth.functions";

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const callSignIn = useServerFn(signInFn);
  const callSignUp = useServerFn(signUpFn);
  const callSignOut = useServerFn(signOutFn);
  const callGetMe = useServerFn(getMeFn);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    callGetMe()
      .then((r) => { if (!cancelled) setUser(r.user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [callGetMe]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await callSignIn({ data: { email, password } });
    if (r.ok) setUser(r.user);
    return { ok: r.ok, error: r.ok ? undefined : r.error };
  }, [callSignIn]);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const r = await callSignUp({ data: { email, password, name } });
    if (r.ok) setUser(r.user);
    return { ok: r.ok, error: r.ok ? undefined : r.error };
  }, [callSignUp]);

  const signOut = useCallback(async () => {
    await callSignOut();
    setUser(null);
  }, [callSignOut]);

  return <Ctx.Provider value={{ user, loading, signIn, signUp, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
