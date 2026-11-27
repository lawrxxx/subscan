// Mono Connect (financial data). Endpoints per https://docs.mono.co (llms.txt and
// the Connect Link guide): POST /v2/accounts/initiate → mono_url; the linked
// account id arrives in the `mono.events.account_connected` webhook; data is
// ready once `data_status` is AVAILABLE/PARTIAL; GET /v2/accounts/{id}/transactions
// returns amounts in the lowest denomination (kobo).
import "server-only";
import { merchantKey } from "../detection/merchants.ts";
import type { Transaction } from "../types.ts";

const BASE = "https://api.withmono.com";

export const monoConfigured = () => !!process.env.MONO_SECRET_KEY;

async function mono<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.MONO_SECRET_KEY;
  if (!key) throw new Error("Mono is not configured (MONO_SECRET_KEY missing).");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", "mono-sec-key": key, ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; data?: unknown };
  if (!res.ok) throw new Error(`Mono ${res.status}: ${json.message ?? "request failed"}`);
  return json as T;
}

export async function initiateLink(customer: { name: string; email: string }, ref: string, redirectUrl: string) {
  const r = await mono<{ data: { mono_url: string; customer: string } }>("/v2/accounts/initiate", {
    method: "POST",
    body: JSON.stringify({ customer, meta: { ref }, scope: "auth", redirect_url: redirectUrl }),
  });
  return r.data;
}

interface MonoTx {
  id?: string;
  _id?: string;
  narration: string;
  amount: number;
  type: "debit" | "credit";
  date: string;
  currency?: string;
}

/** All transactions for an account, debits only, normalised to subscan's Transaction shape. */
export async function fetchTransactions(accountId: string, currency = "NGN"): Promise<Transaction[]> {
  // paginate=false returns every transaction in one response (documented); debits are filtered here.
  const q = new URLSearchParams({ paginate: "false" });
  const r = await mono<{ data: MonoTx[] | { transactions?: MonoTx[] } }>(`/v2/accounts/${encodeURIComponent(accountId)}/transactions?${q}`);
  const list = Array.isArray(r.data) ? r.data : (r.data?.transactions ?? []);
  return list
    .filter((t) => t.type === "debit" && t.amount > 0 && t.narration)
    .map((t, i) => ({
      id: `mono-${t.id ?? t._id ?? i}`,
      date: t.date.slice(0, 10),
      description: t.narration.slice(0, 300),
      merchant: merchantKey(t.narration),
      amount: Math.round(t.amount) / 100, // kobo → naira
      currency: t.currency ?? currency,
      source: "mono" as const,
    }));
}

export async function accountCurrency(accountId: string): Promise<string> {
  try {
    const r = await mono<{ data: { currency?: string } }>(`/v2/accounts/${encodeURIComponent(accountId)}/balance`);
    return r.data?.currency ?? "NGN";
  } catch {
    return "NGN";
  }
}
