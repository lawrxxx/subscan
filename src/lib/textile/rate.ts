import { effectiveRate, preview } from "./client.ts";

let cache: { at: number; value: RateInfo } | null = null;

export interface RateInfo {
  ngnPerUsd: number;
  source: "textile-fx-preview";
  asOf: string;
}

/** Indicative NGN per USD from a live Textile FX preview (10 USD₮ → cNGN). */
export async function indicativeUsdNgn(): Promise<RateInfo> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const p = await preview({ sellToken: "USDT", buyToken: "cNGN", sellAmount: "10000000" });
  if (p.status !== "preview" || !p.buyAmount || !p.takerPays) throw new Error(`No live USD₮→cNGN liquidity (${p.reason ?? p.status})`);
  const value: RateInfo = { ngnPerUsd: effectiveRate("USDT", "cNGN", p.takerPays, p.buyAmount), source: "textile-fx-preview", asOf: new Date().toISOString() };
  cache = { at: Date.now(), value };
  return value;
}
