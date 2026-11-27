import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./env";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function serverSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component; middleware refreshes the session */
        }
      },
    },
  });
}

/** Service-role client. Server only — bypasses RLS. Used for the Mono webhook. */
export function adminSupabase(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Authed = { supabase: SupabaseClient; user: User };

/** Resolve the signed-in user for an API route, or a ready-made error response. */
export async function requireUser(): Promise<Authed | NextResponse> {
  const supabase = await serverSupabase();
  if (!supabase) return NextResponse.json({ error: "Accounts are not configured on this deployment." }, { status: 503 });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return { supabase, user: data.user };
}
