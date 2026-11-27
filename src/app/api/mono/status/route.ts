import { NextResponse } from "next/server";
import { monoConfigured } from "@/lib/mono/client";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const { data } = await a.supabase.from("mono_links").select("ref,account_id,status,last_synced_at,last_error,created_at").eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(5);
  return NextResponse.json({ data: { configured: monoConfigured(), links: data ?? [] } });
}
