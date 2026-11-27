import { NextResponse } from "next/server";
import { dbError } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

// Only unsigned drafts can be discarded; on-chain records are permanent history.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  try {
    const { data, error } = await a.supabase.from("payments").delete().eq("user_id", a.user.id).eq("id", id).eq("status", "prepared").select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: "Only prepared drafts can be discarded" }, { status: 409 });
    return NextResponse.json({ data: { deleted: id } });
  } catch (e) {
    return dbError(e);
  }
}
