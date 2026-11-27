import { NextResponse } from "next/server";
import { initiateLink, monoConfigured } from "@/lib/mono/client";
import { requireUser } from "@/lib/supabase/server";

// Starts Mono account linking and returns the hosted Mono URL to redirect to.
export async function POST(req: Request) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  if (!monoConfigured()) return NextResponse.json({ error: "Bank linking is not configured on this deployment." }, { status: 503 });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const ref = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const { error: insErr } = await a.supabase.from("mono_links").insert({ user_id: a.user.id, ref });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  try {
    const { data: profile } = await a.supabase.from("profiles").select("display_name").eq("id", a.user.id).maybeSingle();
    const name = profile?.display_name || a.user.email!.split("@")[0];
    const link = await initiateLink({ name, email: a.user.email! }, ref, `${origin}/connect/mono?ref=${ref}`);
    return NextResponse.json({ data: { url: link.mono_url, ref } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
