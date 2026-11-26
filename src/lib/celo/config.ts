// Single source of truth for Celo mainnet integration constants.
// Every address below was verified on 2026-11-26 against official sources and
// checked on chain (eth_getCode / decimals() / symbol() via forno.celo.org):
//  - Tokens + Textile reactor: https://docs.textilecredit.com/protocol/address-book.html (Celo, chain 42220)
//  - ERC-8004 registries:     https://docs.celo.org/build/agents/8004
//  - Fee-currency adapters:   https://docs.celo.org/build/tools/contracts/fee-currencies
import { celo } from "viem/chains";

export const CHAIN = celo;
export const CHAIN_ID = 42220 as const;
export const CHAIN_ID_HEX = "0xa4ec" as const;

export const RPC_URL = process.env.NEXT_PUBLIC_CELO_RPC_URL || "https://forno.celo.org";
export const EXPLORER_URL = "https://celoscan.io";

export type TokenSymbol = "USDT" | "cNGN";

export interface TokenInfo {
  symbol: TokenSymbol;
  display: string;
  address: `0x${string}`;
  decimals: number;
  fiat: string; // fiat currency the token tracks
  feeCurrencyAdapter?: `0x${string}`; // CIP-64 gas adapter, if supported
}

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  USDT: {
    symbol: "USDT",
    display: "USD₮",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // on-chain symbol "USD₮", 6 decimals
    decimals: 6,
    fiat: "USD",
    feeCurrencyAdapter: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  },
  cNGN: {
    symbol: "cNGN",
    display: "cNGN",
    address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", // Compliant Naira, 6 decimals
    decimals: 6,
    fiat: "NGN",
  },
};

export const TEXTILE = {
  apiBase: process.env.TEXTILE_API_BASE || "https://api.textilecredit.com/v2",
  reactor: "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3" as `0x${string}`, // LimitOrderReactor (Celo)
  feeBps: 2, // published taker fee; the live quote is authoritative
};

export const ERC8004 = {
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as `0x${string}`,
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as `0x${string}`,
};

export const ERC8004_IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export function txUrl(hash: string) {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(addr: string) {
  return `${EXPLORER_URL}/address/${addr}`;
}

export function tokenForCurrency(currency: string): TokenSymbol | undefined {
  if (currency === "NGN") return "cNGN";
  if (currency === "USD") return "USDT";
  return undefined;
}
