import { NextResponse } from "next/server";
import { dbError } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  try {
    const { data, error } = await a.supabase.from("subscan_agent_events").select("id,question,reply,mode,tools,created_at").eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data });
  } catch (e) {
    return dbError(e);
  }
}
