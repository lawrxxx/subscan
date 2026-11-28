// Autopilot API. All checks run here, server-side; the browser only ever holds
// sealed tokens it cannot open. Actions: key | activate | status | policy | execute.
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { activate, execute, issueKey, status, updatePolicy, type ExecuteRequest } from "@/lib/autopilot/server";
import { AutopilotConfigError } from "@/lib/autopilot/seal";
import { REFUSAL_TEXT } from "@/lib/payments/engine";

export const maxDuration = 120;

const addr = (v: unknown): v is `0x${string}` => typeof v === "string" && isAddress(v);
const tok = (v: unknown): v is "USDT" | "cNGN" => v === "USDT" || v === "cNGN";
const atomic = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v) && BigInt(v) > 0n;
const keyOk = (v: unknown): v is string => typeof v === "string" && v.length > 3 && v.length < 200;

function parseRequest(r: unknown): ExecuteRequest | null {
  const x = r as Record<string, unknown> | null;
  if (!x || !keyOk(x.key)) return null;
  if (x.kind === "transfer" && tok(x.token) && atomic(x.amountAtomic) && addr(x.recipient)) return { kind: "transfer", key: x.key, token: x.token, amountAtomic: x.amountAtomic, recipient: x.recipient };
  if (x.kind === "convert" && tok(x.sellToken) && tok(x.buyToken) && x.sellToken !== x.buyToken && (atomic(x.buyAmountAtomic) !== atomic(x.sellAmountAtomic)))
    return { kind: "convert", key: x.key, sellToken: x.sellToken, buyToken: x.buyToken, ...(atomic(x.buyAmountAtomic) ? { buyAmountAtomic: x.buyAmountAtomic } : { sellAmountAtomic: x.sellAmountAtomic as string }), ...(atomic(x.maxSellAtomic) ? { maxSellAtomic: x.maxSellAtomic } : {}) };
  return null;
}

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
        return NextResponse.json({ data: await activate({ sealedKey: b.sealedKey, session: b.session as never, recipients: (b.recipients as never) ?? [], limits: b.limits as never, maxPerTransfer: b.maxPerTransfer as never }) });
      }
      case "status": {
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet)) return NextResponse.json({ error: "sealedPolicy and wallet required" }, { status: 400 });
        return NextResponse.json({ data: await status(b.sealedPolicy, b.wallet) });
      }
      case "policy": {
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet)) return NextResponse.json({ error: "sealedPolicy and wallet required" }, { status: 400 });
        return NextResponse.json({ data: { sealedPolicy: updatePolicy(b.sealedPolicy, b.wallet, { recipients: Array.isArray(b.recipients) ? (b.recipients as never) : undefined, maxPerTransfer: (b.maxPerTransfer as never) ?? undefined }) } });
      }
      case "execute": {
        const request = parseRequest(b.request);
        if (typeof b.sealedPolicy !== "string" || !addr(b.wallet) || !request) return NextResponse.json({ error: "invalid request" }, { status: 400 });
        const result = await execute({ sealedPolicy: b.sealedPolicy, wallet: b.wallet, request });
        return NextResponse.json({ data: { ...result, refusalText: result.refusals?.map((x) => REFUSAL_TEXT[x]) } });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof AutopilotConfigError) return NextResponse.json({ error: "Automatic payments aren't set up on this server yet.", code: "unavailable" }, { status: 503 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: 400 });
  }
}
