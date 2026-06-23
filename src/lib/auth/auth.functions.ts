// Auth RPC endpoints. The browser calls these; they run on Vercel serverless and
// use the Aurora-backed auth module (src/lib/db/auth.server.ts). Password hashing,
// session tokens and DATABASE_URL never leave the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}
export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };

const credsIn = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
  name: z.string().optional(),
});

export const signUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => credsIn.parse(d))
  .handler(async ({ data }): Promise<AuthResult> => {
    const { signUp } = await import("@/lib/db/auth.server");
    try {
      const user = await signUp(data.email, data.password, data.name);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Sign up failed." };
    }
  });

export const signInFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => credsIn.parse(d))
  .handler(async ({ data }): Promise<AuthResult> => {
    const { signIn } = await import("@/lib/db/auth.server");
    try {
      const user = await signIn(data.email, data.password);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Sign in failed." };
    }
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { signOut } = await import("@/lib/db/auth.server");
  await signOut();
  return { ok: true };
});

export const getMeFn = createServerFn({ method: "GET" }).handler(async (): Promise<{ user: AuthUser | null }> => {
  const { currentUser } = await import("@/lib/db/auth.server");
  return { user: await currentUser() };
});
