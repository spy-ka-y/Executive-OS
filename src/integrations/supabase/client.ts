// Originally generated. Edited so the app runs WITHOUT Supabase: the data layer
// is Amazon Aurora PostgreSQL (src/lib/db). Supabase is now only an optional
// auth shim; when its env vars are absent we return a no-op stub instead of
// throwing, so every server-function RPC and the root auth listener keep working.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Minimal no-op auth client used when Supabase isn't configured.
function noopSupabase() {
  return {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; },
      async getClaims() { return { data: null, error: new Error('Supabase not configured') }; },
      async getUser() { return { data: { user: null }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from() {
      throw new Error('Supabase data access is disabled — this app uses Amazon Aurora PostgreSQL (src/lib/db).');
    },
  };
}

function createSupabaseClient() {
  // Use import.meta.env for client-side (Vite build-time replacement)
  // Fall back to process.env for SSR (server-side rendering)
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return noopSupabase() as unknown as ReturnType<typeof createClient<Database>>;
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

