// Server half of x402: probe a merchant endpoint for its 402 requirements and
// forward the wallet-signed payment header. No signing happens here.
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i;

export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:") throw new Error("x402 endpoints must use https");
  if (PRIVATE_HOST.test(u.hostname)) throw new Error("Private or local hosts are not allowed");
  return u;
}

const http = new x402HTTPClient(new x402Client());

export async function probe(url: string) {
  const u = assertSafeUrl(url);
  const res = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (res.status !== 402) return { status: res.status, x402: false as const };
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const paymentRequired = http.getPaymentRequiredResponse((n) => res.headers.get(n), body);
  const celo = paymentRequired.accepts.filter((a) => a.network === "eip155:42220" || a.network === ("celo" as string));
  return { status: 402, x402: true as const, paymentRequired, celoAccepts: celo };
}

export async function pay(url: string, paymentHeaders: Record<string, string>) {
  const u = assertSafeUrl(url);
  const allowed = Object.fromEntries(
    Object.entries(paymentHeaders).filter(([k]) => /^(payment-signature|x-payment)$/i.test(k)),
  );
  if (!Object.keys(allowed).length) throw new Error("Missing payment header");
  const res = await fetch(u, { method: "GET", headers: allowed, redirect: "manual", signal: AbortSignal.timeout(60_000), cache: "no-store" });
  const header = res.headers.get("PAYMENT-RESPONSE") || res.headers.get("X-PAYMENT-RESPONSE");
  let settlement: ReturnType<typeof decodePaymentResponseHeader> | null = null;
  if (header) {
    try {
      settlement = decodePaymentResponseHeader(header);
    } catch {
      settlement = null;
    }
  }
  const bodyText = (await res.text()).slice(0, 2000);
  return { status: res.status, ok: res.ok, settlement, body: bodyText };
}
