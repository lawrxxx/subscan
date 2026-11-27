import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { syncLink } from "@/lib/mono/sync";
import { adminSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

function verified(req: Request) {
  const expected = process.env.MONO_WEBHOOK_SECRET;
  const got = req.headers.get("mono-webhook-secret");
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Mono webhooks: account_connected carries the account id + our ref;
// account_updated reports data_status. Verified with the mono-webhook-secret header.
export async function POST(req: Request) {
  if (!verified(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const db = adminSupabase();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { event?: string; data?: { id?: string; account?: { _id?: string; id?: string }; meta?: { ref?: string; data_status?: string } } } | null;
  if (!body?.event) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const accountId = body.data?.id ?? body.data?.account?._id ?? body.data?.account?.id;
  const ref = body.data?.meta?.ref;
  const status = body.data?.meta?.data_status?.toLowerCase();

  if (body.event === "mono.events.account_connected" && ref && accountId) {
    await db.from("subscan_mono_links").update({ account_id: accountId, status: "connected" }).eq("ref", ref);
  }
  if (body.event === "mono.events.account_updated" && accountId) {
    const { data: link } = await db.from("subscan_mono_links").select("id,user_id,account_id").eq("account_id", accountId).maybeSingle();
    if (link && status && ["available", "partial", "unavailable", "failed"].includes(status)) {
      await db.from("subscan_mono_links").update({ status }).eq("id", link.id);
      if (status === "available" || status === "partial") await syncLink(db, link).catch(() => {});
    }
  }
  return NextResponse.json({ received: true });
}
