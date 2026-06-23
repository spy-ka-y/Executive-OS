// Server-only authentication on Amazon Aurora PostgreSQL. Passwords are hashed
// with Node's scrypt (no third-party dependency); sessions are random tokens
// stored in Aurora and carried in an httpOnly cookie. This file is never bundled
// for the client (.server.ts + only imported from server functions).
import { randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { query, queryOne } from "./aurora.server";
import { hashPassword, verifyPassword } from "./password";

const COOKIE = "eos_session";
const SESSION_DAYS = 30;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(row: { id: string; email: string; name: string | null }): AuthUser {
  return { id: row.id, email: row.email, name: row.name };
}

async function newSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query("insert into sessions (token, user_id, expires_at) values ($1,$2,$3)", [token, userId, expires.toISOString()]);
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

// ── public operations (called by the auth server functions) ──────────────────
export async function signUp(email: string, password: string, name?: string): Promise<AuthUser> {
  const e = normalizeEmail(email);
  if (!e.includes("@") || password.length < 8) {
    throw new Error("Enter a valid email and a password of at least 8 characters.");
  }
  const exists = await queryOne("select id from users where email = $1", [e]);
  if (exists) throw new Error("An account with that email already exists.");
  const row = await queryOne<{ id: string; email: string; name: string | null }>(
    "insert into users (email, name, password_hash) values ($1,$2,$3) returning id, email, name",
    [e, name?.trim() || null, hashPassword(password)],
  );
  if (!row) throw new Error("Could not create the account.");
  await newSession(row.id);
  return publicUser(row);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const e = normalizeEmail(email);
  const row = await queryOne<{ id: string; email: string; name: string | null; password_hash: string }>(
    "select id, email, name, password_hash from users where email = $1",
    [e],
  );
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error("Invalid email or password.");
  }
  await newSession(row.id);
  return publicUser(row);
}

export async function signOut(): Promise<void> {
  const token = getCookie(COOKIE);
  if (token) {
    try {
      await query("delete from sessions where token = $1", [token]);
    } catch {
      /* ignore */
    }
  }
  deleteCookie(COOKIE, { path: "/" });
}

// Resolve the authenticated user from the session cookie, or null. Used by the
// data layer to scope every query to the owner.
export async function currentUser(): Promise<AuthUser | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const row = await queryOne<{ id: string; email: string; name: string | null }>(
    `select u.id, u.email, u.name
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return row ? publicUser(row) : null;
}

export async function currentUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}

// For write operations that must have an owner.
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error("Not authenticated.");
  return id;
}
