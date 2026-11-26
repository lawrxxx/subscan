// Textile FX v2 RFQ client (server side). Endpoints and field names follow
// https://docs.textilecredit.com/api/v2/rfq.html and /api/v2/authentication.html.
// Base: https://api.textilecredit.com/v2 — preview, request, {id}/submit, {id}, {id}/cancel.
import { CHAIN_ID, TEXTILE, TOKENS, type TokenSymbol } from "../celo/config.ts";

export interface TakerProof {
  nonce: `0x${string}`;
  issuedAt: number;
  signature: `0x${string}`;
}

export interface RfqBody {
  sellToken: TokenSymbol;
  buyToken: TokenSymbol;
  sellAmount?: string; // atomic units
  buyAmount?: string; // atomic units (exact output)
}

export interface PreviewData {
  status: "preview" | "no_quote";
  sellAmount?: string;
  buyAmount?: string;
  feeAmount?: string;
  takerPays?: string;
  rateRay?: string;
  availableSellAmount?: string;
  availableBuyAmount?: string;
  reason?: string;
  retryAfterMs?: number;
}

export interface FirmQuote {
  rfqId: string;
  claimToken: string;
  status: "quoted" | "no_quote";
  reason?: string;
  quote?: {
    sellAmount: string;
    buyAmount: string;
    feeAmount: string;
    takerPays: string;
    rateRay: string;
    expiresAt: string;
    orderDeadline: string;
    reactor: `0x${string}`;
    taker: `0x${string}`;
  };
  transactions?: {
    approval: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
    swap: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
  };
}

export class TextileError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
    public requestId?: string | null,
  ) {
    super(message);
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.TEXTILE_API_KEY) h.Authorization = `Bearer ${process.env.TEXTILE_API_KEY}`;
  return h;
}

function body(b: RfqBody) {
  if (b.sellToken === b.buyToken) throw new TextileError("sellToken and buyToken must differ", 400);
  if (!!b.sellAmount === !!b.buyAmount) throw new TextileError("Send exactly one of sellAmount or buyAmount", 400);
  const amt = b.sellAmount ?? b.buyAmount!;
  if (!/^\d+$/.test(amt) || BigInt(amt) <= 0n) throw new TextileError("Amount must be a positive atomic-unit integer string", 400);
  return {
    chainId: CHAIN_ID,
    sellToken: TOKENS[b.sellToken].address,
    buyToken: TOKENS[b.buyToken].address,
    ...(b.sellAmount ? { sellAmount: b.sellAmount } : { buyAmount: b.buyAmount }),
  };
}

async function call<T>(path: string, init: RequestInit, timeoutMs = 75_000): Promise<T> {
  const res = await fetch(`${TEXTILE.apiBase}${path}`, { ...init, headers: { ...headers(), ...(init.headers as object) }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string; code?: string; details?: { reason?: string } } };
  if (!res.ok) {
    throw new TextileError(
      json.error?.message || `Textile FX responded ${res.status}`,
      res.status,
      json.error?.details?.reason || json.error?.code,
      res.headers.get("x-request-id"),
    );
  }
  return json.data as T;
}

export function preview(b: RfqBody) {
  return call<PreviewData>("/rfq/preview", { method: "POST", body: JSON.stringify(body(b)) }, 20_000);
}

export function requestFirm(b: RfqBody, taker: `0x${string}`, takerProof?: TakerProof) {
  return call<FirmQuote>("/rfq/request", {
    method: "POST",
    body: JSON.stringify({ ...body(b), taker, ...(takerProof && !process.env.TEXTILE_API_KEY ? { takerProof } : {}) }),
  });
}

export function submit(rfqId: string, claimToken: string, txHash: string) {
  return call<{ status: string }>(`/rfq/${encodeURIComponent(rfqId)}/submit`, {
    method: "POST",
    headers: { "X-Rfq-Claim": claimToken },
    body: JSON.stringify({ txHash }),
  }, 20_000);
}

export function status(rfqId: string, claimToken: string) {
  return call<Record<string, unknown>>(`/rfq/${encodeURIComponent(rfqId)}`, { method: "GET", headers: { "X-Rfq-Claim": claimToken } }, 20_000);
}

export function cancel(rfqId: string, claimToken: string) {
  return call<Record<string, unknown>>(`/rfq/${encodeURIComponent(rfqId)}/cancel`, { method: "POST", headers: { "X-Rfq-Claim": claimToken } }, 20_000);
}

/** Effective price: buy-token units per 1 sell-token unit, from atomic amounts. */
export function effectiveRate(sell: TokenSymbol, buy: TokenSymbol, sellAtomic: string, buyAtomic: string): number {
  const s = Number(sellAtomic) / 10 ** TOKENS[sell].decimals;
  const b = Number(buyAtomic) / 10 ** TOKENS[buy].decimals;
  return s ? b / s : 0;
}

/** Human rate, always quoted per 1 unit of the stronger token (e.g. "1 USD₮ = 1,439.98 cNGN"). */
export function formatRate(sell: TokenSymbol, buy: TokenSymbol, sellAtomic: string, buyAtomic: string): string {
  const r = effectiveRate(sell, buy, sellAtomic, buyAtomic);
  if (!r) return "—";
  const [base, quote, v] = r >= 1 ? [sell, buy, r] : [buy, sell, 1 / r];
  return `1 ${TOKENS[base].display} = ${v.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${TOKENS[quote].display}`;
}
