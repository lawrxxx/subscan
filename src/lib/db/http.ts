import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { zodMessage } from "./schema.ts";

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const raw = await req.json().catch(() => undefined);
  if (raw === undefined) return { ok: false, res: NextResponse.json({ error: "Body must be JSON" }, { status: 400 }) };
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, res: NextResponse.json({ error: `Invalid request — ${zodMessage(r.error)}` }, { status: 422 }) };
  return { ok: true, data: r.data };
}

export function dbError(e: unknown) {
  return NextResponse.json({ error: e instanceof Error ? e.message : "Database error" }, { status: 500 });
}
