import { NextResponse } from "next/server";
import { syncLink } from "@/lib/mono/sync";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

// Manual "sync now" for the user's most recent linked account.
export async function POST() {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const { data: link } = await a.supabase.from("subscan_mono_links").select("id,user_id,account_id,status").eq("user_id", a.user.id).not("account_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!link) return NextResponse.json({ error: "No linked bank account yet. Mono confirms the link a few moments after you finish." }, { status: 409 });
  try {
    // Runs as the user; mono_links status updates need the service role, so failures there are non-fatal.
    const r = await syncLink(a.supabase, link);
    return NextResponse.json({ data: r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
