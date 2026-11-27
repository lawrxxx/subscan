// Supabase is optional at build time so the app still runs (device-only guest
// mode) before a project is connected. When these are set, auth is required.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
