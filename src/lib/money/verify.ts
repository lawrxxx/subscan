// Independent check, from the browser, that a transaction did what we expected:
// the receipt succeeded and it contains the token transfer we asked for.
import { erc20Abi, parseEventLogs, parseUnits, type Hex } from "viem";
import { TOKENS, type TokenSymbol } from "../celo/config";
import { publicClient } from "../celo/wallet";

export type Verdict = { state: "confirmed" } | { state: "pending" } | { state: "failed"; why: string };

export async function verifyTransfer(hash: Hex, expect: { token: TokenSymbol; to: `0x${string}`; minAmount: string }): Promise<Verdict> {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    return { state: "pending" };
  }
  if (receipt.status !== "success") return { state: "failed", why: "The transaction reverted on Celo." };
  const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const want = parseUnits(expect.minAmount, TOKENS[expect.token].decimals);
  const hit = logs.some((l) => l.address.toLowerCase() === TOKENS[expect.token].address.toLowerCase() && l.args.to.toLowerCase() === expect.to.toLowerCase() && l.args.value >= want);
  return hit ? { state: "confirmed" } : { state: "failed", why: "The transaction confirmed but didn't contain the expected transfer." };
}
