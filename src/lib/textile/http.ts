import { NextResponse } from "next/server";
import { TextileError } from "./client.ts";

export function textileErrorResponse(e: unknown) {
  if (e instanceof TextileError) {
    return NextResponse.json({ error: e.message, reason: e.reason, requestId: e.requestId }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
  }
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: `Textile FX unreachable: ${msg}` }, { status: 502 });
}

export const TOKEN_SYMBOLS = ["USDT", "cNGN"] as const;
export function isToken(x: unknown): x is (typeof TOKEN_SYMBOLS)[number] {
  return typeof x === "string" && (TOKEN_SYMBOLS as readonly string[]).includes(x);
}
