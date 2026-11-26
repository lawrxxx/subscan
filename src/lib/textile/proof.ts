"use client";
// Textile "proof of control" — EIP-712 TakerControl v1, signed by the user's
// wallet only when the firm-quote endpoint asks for it (401
// proof_of_control_required). Moves no funds, approves nothing.
import { toHex } from "viem";
import { CHAIN_ID } from "../celo/config";
import { walletClient } from "../celo/wallet";
import type { TakerProof } from "./client";

export async function signTakerControl(account: `0x${string}`): Promise<TakerProof> {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = Date.now();
  const signature = await walletClient(account).signTypedData({
    account,
    domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}
