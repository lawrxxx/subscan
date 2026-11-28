// Where a recipient receives money, and which tokens each destination is known to
// accept on Celo. A token is listed only when the provider's own documentation (or
// Celo's, for MiniPay) shows it on the Celo network. Nothing here talks to these
// providers: the user copies their deposit address from the app and pastes it.
import { isAddress } from "viem";
import type { TokenSymbol } from "../celo/config.ts";
import type { DestinationId, Recipient } from "../types.ts";

export interface Destination {
  id: DestinationId;
  name: string;
  kind: "exchange" | "wallet";
  /** Tokens confirmed for deposits on Celo. Empty = not available. */
  tokens: TokenSymbol[];
  /** How to find the deposit address, step by step. Only where we know the steps. */
  steps: string[];
  note?: string;
  /** Why it can't be picked, when tokens is empty. */
  unavailable?: string;
  source?: { label: string; url: string };
}

export const NETWORK = "Celo";

export const DESTINATIONS: Destination[] = [
  {
    id: "quidax",
    name: "Quidax",
    kind: "exchange",
    tokens: ["USDT"],
    steps: ["Open your Quidax account.", "Go to Deposits.", "Select USDT.", "Select Celo as the network.", "Copy your deposit address.", "Come back to subscan and paste the address."],
    note: "Quidax receives USD₮ on Celo. Naira (cNGN) on Celo isn't listed by Quidax, so it isn't offered.",
    source: { label: "Quidax supported crypto assets (USDT · Celo network)", url: "https://docs.quidax.io/docs/supported-crypto-assets" },
  },
  {
    id: "minipay",
    name: "MiniPay",
    kind: "wallet",
    tokens: ["USDT"],
    steps: ["Open MiniPay.", "Tap Add cash (or Receive).", "Choose the option to receive from a crypto exchange or wallet.", "Copy the address shown.", "Come back to subscan and paste the address."],
    note: "MiniPay holds USD₮ on Celo. We couldn't confirm MiniPay shows naira (cNGN), so it isn't offered. Menu names can differ between app versions.",
    source: { label: "Celo docs: MiniPay holds USDm, USDC and USD₮", url: "https://docs.celo.org/build-on-celo/build-on-minipay/overview" },
  },
  {
    id: "busha",
    name: "Busha",
    kind: "exchange",
    tokens: [],
    steps: [],
    unavailable: "Busha's published deposit networks don't include Celo for USD₮, and cNGN deposits on Celo aren't confirmed. Choose another Celo wallet instead.",
    source: { label: "Busha supported currencies", url: "https://docs.busha.io/guide/reference/supported-currencies" },
  },
  {
    id: "celo_wallet",
    name: "Another Celo wallet",
    kind: "wallet",
    tokens: ["USDT", "cNGN"],
    steps: ["Open the wallet the money should go to.", "Find its Receive screen and make sure it's on the Celo network.", "Copy the address.", "Come back to subscan and paste the address."],
    note: "Any wallet on Celo can hold USD₮ and cNGN, but some apps only show certain tokens. Check that the receiving wallet supports the token you'll send.",
  },
];

export const destinationOf = (r: Pick<Recipient, "destination">) => DESTINATIONS.find((d) => d.id === (r.destination ?? "celo_wallet"))!;

/** Tokens a recipient can receive: what was saved with them, else what their destination allows. */
export function tokensFor(r: Pick<Recipient, "destination" | "tokens">): TokenSymbol[] {
  return r.tokens?.length ? r.tokens : destinationOf(r).tokens;
}

export const TOKEN_NAME: Record<TokenSymbol, string> = { USDT: "USD₮ (US dollars)", cNGN: "cNGN (naira)" };
export const WARNING = "Make sure the token and network match your receiving wallet. Sending funds through an unsupported network may result in permanent loss.";

/** Check a pasted address without changing it. Returns an error, or null when it can be used. */
export function addressProblem(v: string, existing: Pick<Recipient, "address">[]): string | null {
  if (!v) return "Paste the wallet address.";
  if (v !== v.trim()) return "There are spaces before or after the address. Remove them so it's exactly as copied.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return "That isn't a valid Celo address. It starts with 0x followed by 40 letters and numbers.";
  if (/^0x0{40}$/i.test(v)) return "That address can't receive money.";
  if (/[a-f]/.test(v.slice(2)) && /[A-F]/.test(v.slice(2)) && !isAddress(v, { strict: true })) return "The capital letters in this address don't match its built-in check, which usually means a typo. Copy it again.";
  if (existing.some((r) => r.address.toLowerCase() === v.toLowerCase())) return "You've already saved this address.";
  return null;
}

