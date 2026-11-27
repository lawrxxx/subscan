import { NextResponse } from "next/server";
import { rowToSub } from "@/lib/db/repo";
import { SubscriptionPatch } from "@/lib/db/schema";
import { dbError, parseBody } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  const b = await parseBody(req, SubscriptionPatch);
  if (!b.ok) return b.res;
  const p = b.data;
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.displayName !== undefined) row.display_name = p.displayName;
  if (p.category !== undefined) row.category = p.category;
  if (p.amount !== undefined) row.amount = p.amount;
  if (p.frequency !== undefined) row.frequency = p.frequency;
  if (p.intervalDays !== undefined) row.interval_days = p.intervalDays;
  if (p.nextRenewal !== undefined) row.next_renewal = p.nextRenewal;
  if (p.payment !== undefined) row.payment = p.payment;
  if (p.edited !== undefined) row.edited = p.edited;
  if (!Object.keys(row).length) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
  try {
    const { data, error } = await a.supabase.from("subscan_subscriptions").update(row).eq("user_id", a.user.id).eq("id", decodeURIComponent(id)).select().maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    return NextResponse.json({ data: rowToSub(data) });
  } catch (e) {
    return dbError(e);
  }
}
