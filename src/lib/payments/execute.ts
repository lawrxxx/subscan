"use client";
// Client-side payment execution. Every on-chain step is a separate wallet
// prompt the user approves; nothing here runs without an explicit click.
import { erc20Abi, formatUnits, type Hex } from "viem";
import { TEXTILE, TOKENS, type TokenSymbol } from "../celo/config";
import { allowance, erc20ApproveData, erc20TransferData, publicClient, sendTx, waitForReceipt } from "../celo/wallet";
import type { FirmQuote, PreviewData } from "../textile/client";
import { signTakerControl } from "../textile/proof";

export async function fetchPreview(sell: TokenSymbol, buy: TokenSymbol, buyAtomic: string): Promise<PreviewData> {
  const r = await fetch("/api/fx/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellToken: sell, buyToken: buy, buyAmount: buyAtomic }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Preview failed");
  return j.data;
}

export async function requestFirmQuote(sell: TokenSymbol, buy: TokenSymbol, buyAtomic: string, taker: `0x${string}`): Promise<FirmQuote> {
  const send = (extra: object = {}) =>
    fetch("/api/fx/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellToken: sell, buyToken: buy, buyAmount: buyAtomic, taker, ...extra }) });
  let r = await send();
  let j = await r.json();
  if (r.status === 401 && j.reason === "proof_of_control_required") {
    // Textile asks the taker wallet to prove control (EIP-712, moves no funds).
    const takerProof = await signTakerControl(taker);
    r = await send({ takerProof });
    j = await r.json();
  }
  if (!r.ok) throw new Error(`${j.error ?? "Firm quote failed"}${j.reason ? ` (${j.reason})` : ""}`);
  return j.data as FirmQuote;
}

export async function reportSwap(rfqId: string, claimToken: string, txHash: string) {
  await fetch("/api/fx/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rfqId, claimToken, txHash }) }).catch(() => {});
}

export async function tokenBalance(token: TokenSymbol, owner: `0x${string}`) {
  return publicClient.readContract({ address: TOKENS[token].address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export interface StepCallbacks {
  onHash(kind: "approval" | "conversion" | "settlement", hash: `0x${string}`, label: string): void;
}

/** Approve the Textile reactor for exactly takerPays when the allowance is short. */
export async function approveIfNeeded(owner: `0x${string}`, sell: TokenSymbol, quote: FirmQuote, gasUsdt: boolean, cb: StepCallbacks) {
  const reactor = quote.quote!.reactor;
  if (reactor.toLowerCase() !== TEXTILE.reactor.toLowerCase()) {
    throw new Error(`Quote names reactor ${reactor}, which is not the Celo LimitOrderReactor in Textile's address book. Aborting.`);
  }
  const need = BigInt(quote.quote!.takerPays);
  const current = await allowance(owner, sell, reactor);
  if (current >= need) return;
  if (current > 0n && sell === "USDT") {
    // USDT-style tokens can reject approve(nonzero → nonzero) — reset first (per Textile docs).
    const h = await sendTx(owner, { to: TOKENS[sell].address, data: erc20ApproveData(reactor, 0n) }, { payGasInUsdt: gasUsdt });
    cb.onHash("approval", h, "Reset allowance");
    await waitForReceipt(h);
  }
  const approval = quote.transactions!.approval;
  if (approval.to.toLowerCase() !== TOKENS[sell].address.toLowerCase()) throw new Error("Approval transaction targets an unexpected token contract. Aborting.");
  const h = await sendTx(owner, { to: approval.to, data: approval.data as Hex, value: BigInt(approval.value) }, { payGasInUsdt: gasUsdt });
  cb.onHash("approval", h, `Allow Textile FX to spend ${formatUnits(need, TOKENS[sell].decimals)} ${TOKENS[sell].display}`);
  const r = await waitForReceipt(h);
  if (r.status !== "success") throw new Error("Approval transaction reverted");
}

export async function executeSwap(owner: `0x${string}`, quote: FirmQuote, gasUsdt: boolean, cb: StepCallbacks) {
  if (Date.now() >= Date.parse(quote.quote!.expiresAt)) throw new Error("Quote expired before the swap could be sent — request a new quote.");
  const swap = quote.transactions!.swap;
  if (swap.to.toLowerCase() !== TEXTILE.reactor.toLowerCase()) throw new Error("Swap transaction does not target the Textile reactor. Aborting.");
  const h = await sendTx(owner, { to: swap.to, data: swap.data as Hex, value: BigInt(swap.value) }, { payGasInUsdt: gasUsdt });
  cb.onHash("conversion", h, "Convert via Textile FX");
  void reportSwap(quote.rfqId, quote.claimToken, h);
  const r = await waitForReceipt(h);
  if (r.status !== "success") throw new Error("Conversion transaction reverted");
  return h;
}

export async function transferToMerchant(owner: `0x${string}`, token: TokenSymbol, to: `0x${string}`, atomic: bigint, gasUsdt: boolean, cb: StepCallbacks) {
  const bal = await tokenBalance(token, owner);
  if (bal < atomic) throw new Error(`Insufficient ${TOKENS[token].display}: have ${formatUnits(bal, TOKENS[token].decimals)}, need ${formatUnits(atomic, TOKENS[token].decimals)}`);
  const h = await sendTx(owner, { to: TOKENS[token].address, data: erc20TransferData(to, atomic) }, { payGasInUsdt: gasUsdt });
  cb.onHash("settlement", h, `Pay merchant ${formatUnits(atomic, TOKENS[token].decimals)} ${TOKENS[token].display}`);
  const r = await waitForReceipt(h);
  if (r.status !== "success") throw new Error("Merchant transfer reverted");
  return h;
}
