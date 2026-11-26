"use client";
// Browser half of x402: the connected wallet signs the payment authorization
// (EIP-3009 for USD₮/USDC, Permit2 for cNGN) using the official @x402 packages.
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm";
import { CHAIN_ID } from "../celo/config";
import { allowance, erc20ApproveData, publicClient, sendTx, waitForReceipt, walletClient } from "../celo/wallet";

// Canonical Permit2 — listed for Celo in both Textile's address book and docs.celo.org/build/agents/x402.
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

export function describeRequirement(r: PaymentRequirements) {
  const extra = (r.extra ?? {}) as Record<string, unknown>;
  return {
    network: r.network,
    asset: r.asset as `0x${string}`,
    amount: r.amount,
    payTo: r.payTo as `0x${string}`,
    method: extra.assetTransferMethod === "permit2" ? "permit2" : "eip3009",
    tokenName: typeof extra.name === "string" ? extra.name : undefined,
  };
}

/** cNGN has no EIP-2612 permit, so the first Permit2 payment needs an approve tx. */
export async function ensurePermit2Allowance(account: `0x${string}`, req: PaymentRequirements, payGasInUsdt: boolean) {
  const d = describeRequirement(req);
  if (d.method !== "permit2") return null;
  const current = await publicClient.readContract({
    address: d.asset,
    abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "allowance",
    args: [account, PERMIT2],
  });
  if (current >= BigInt(d.amount)) return null;
  const hash = await sendTx(account, { to: d.asset, data: erc20ApproveData(PERMIT2, BigInt(d.amount)) }, { payGasInUsdt });
  await waitForReceipt(hash);
  return hash;
}

export async function buildPaymentHeaders(account: `0x${string}`, paymentRequired: PaymentRequired, maxAtomic: bigint) {
  const wc = walletClient(account);
  const signer = {
    address: account,
    signTypedData: (m: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) =>
      wc.signTypedData({ ...(m as Omit<Parameters<typeof wc.signTypedData>[0], "account">), account } as Parameters<typeof wc.signTypedData>[0]),
    readContract: (args: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) =>
      publicClient.readContract(args as Parameters<typeof publicClient.readContract>[0]),
  };
  const celoOnly = { ...paymentRequired, accepts: paymentRequired.accepts.filter((a) => a.network === `eip155:${CHAIN_ID}`) };
  if (!celoOnly.accepts.length) throw new Error("Merchant does not accept payment on Celo mainnet");
  const client = x402Client.fromConfig({
    schemes: [{ network: `eip155:${CHAIN_ID}`, client: new ExactEvmScheme(signer) }],
    spendControls: {
      maxAmountPerPayment: false,
      allowedAssets: celoOnly.accepts.map((a) => ({ network: a.network, asset: a.asset, maxAmountPerPayment: maxAtomic.toString() })),
    },
  });
  const http = new x402HTTPClient(client);
  const payload = await http.createPaymentPayload(celoOnly);
  return http.encodePaymentSignatureHeader(payload);
}

export { allowance };
