// Autopilot API. All checks run here, server-side; the browser only ever holds
// sealed tokens it cannot open. Actions: key | activate | status | recipients | pay.
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { activate, issueKey, pay, status, updateRecipients } from "@/lib/autopilot/server";
import { AutopilotConfigError } from "@/lib/autopilot/seal";
import { REFUSAL_TEXT } from "@/lib/payments/engine";

export const maxDuration = 120;

const addr = (v: unknown): v is `0x${string}` => typeof v === "string" && isAddress(v);

export async function GET() {
  return NextResponse.json({ data: { available: !!process.env.AUTOPILOT_SEAL_KEY, conversions: !!process.env.TEXTILE_API_KEY } });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.action !== "string") return NextResponse.json({ error: "action required" }, { status: 400 });
  try {
    switch (b.action) {
      case "key": {
        if (!addr(b.wallet)) return NextResponse.json({ error: "wallet address required" }, { status: 400 });
        return NextResponse.json({ data: issueKey(b.wallet) });
      }
      case "activate": {
        const s = b.session as { walletAddress?: string; publicKey?: string; expiry?: number } | undefined;
        if (typeof b.sealedKey !== "string" || !s || !addr(s.walletAddress) || typeof s.expiry !== "number") return NextResponse.json({ error: "sealedKey and session required" }, { status: 400 });
        return NextResponse.json({ data: await activate({ sealedKey: b.sealedKey, session: b.session as never, recipients: (b.recipients as never) ?? [], limits: b.limits as never }) });
      }
      case "status": {
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet)) return NextResponse.json({ error: "sealedPolicy and wallet required" }, { status: 400 });
        return NextResponse.json({ data: await status(b.sealedPolicy, b.wallet) });
      }
      case "recipients": {
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet) || !Array.isArray(b.recipients)) return NextResponse.json({ error: "sealedPolicy, wallet and recipients required" }, { status: 400 });
        return NextResponse.json({ data: { sealedPolicy: updateRecipients(b.sealedPolicy, b.wallet, b.recipients as never) } });
      }
      case "pay": {
        const r = b.request as Record<string, unknown> | undefined;
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet) || !r || !addr(r.recipient) || (r.token !== "USDT" && r.token !== "cNGN") || typeof r.amountAtomic !== "string" || !/^\d+$/.test(r.amountAtomic) || typeof r.billId !== "string" || typeof r.dueDate !== "string")
          return NextResponse.json({ error: "invalid payment request" }, { status: 400 });
        const result = await pay({ sealedPolicy: b.sealedPolicy, wallet: b.wallet, request: r as never, enabled: b.enabled === true, alreadyPaid: b.alreadyPaid === true });
        return NextResponse.json({ data: { ...result, refusalText: result.refusals?.map((x) => REFUSAL_TEXT[x]) } });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof AutopilotConfigError) return NextResponse.json({ error: "Autopilot isn't set up on this server yet.", code: "unavailable" }, { status: 503 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Autopilot failed" }, { status: 400 });
  }
}
