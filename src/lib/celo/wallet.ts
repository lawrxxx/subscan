"use client";
// Browser wallet integration (EIP-1193 injected: MiniPay, MetaMask, Valora,
// Rabby…). No private keys ever touch the app — the wallet signs everything.
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  type Hex,
  type WalletClient,
} from "viem";
import { CHAIN, CHAIN_ID, CHAIN_ID_HEX, RPC_URL, TOKENS, type TokenSymbol } from "./config";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
  isMiniPay?: boolean;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export function provider(): Eip1193 | undefined {
  return typeof window === "undefined" ? undefined : window.ethereum;
}

export function walletName(): string {
  const p = provider();
  if (!p) return "No wallet";
  if (p.isMiniPay) return "MiniPay";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

export async function connectWallet(): Promise<`0x${string}`> {
  const p = provider();
  if (!p) throw new Error("No Celo-compatible wallet found. Open subscan in MiniPay, or install MetaMask/Valora.");
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("Wallet returned no accounts.");
  return accounts[0] as `0x${string}`;
}

export async function currentChainId(): Promise<number | null> {
  const p = provider();
  if (!p) return null;
  const id = (await p.request({ method: "eth_chainId" })) as string;
  return Number(id);
}

export async function ensureCelo(): Promise<void> {
  const p = provider();
  if (!p) throw new Error("No wallet");
  if ((await currentChainId()) === CHAIN_ID) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: "Celo Mainnet",
          nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: ["https://celoscan.io"],
        },
      ],
    });
  }
  if ((await currentChainId()) !== CHAIN_ID) throw new Error("Wallet is not on Celo mainnet (42220).");
}

export function walletClient(account: `0x${string}`): WalletClient {
  const p = provider();
  if (!p) throw new Error("No wallet");
  return createWalletClient({ account, chain: CHAIN, transport: custom(p) });
}

export interface Balances {
  CELO: string;
  USDT: string;
  cNGN: string;
  raw: { CELO: bigint; USDT: bigint; cNGN: bigint };
}

export async function getBalances(address: `0x${string}`): Promise<Balances> {
  const [celo, usdt, cngn] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: TOKENS.USDT.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    publicClient.readContract({ address: TOKENS.cNGN.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return {
    CELO: formatUnits(celo, 18),
    USDT: formatUnits(usdt, TOKENS.USDT.decimals),
    cNGN: formatUnits(cngn, TOKENS.cNGN.decimals),
    raw: { CELO: celo, USDT: usdt, cNGN: cngn },
  };
}

export async function allowance(owner: `0x${string}`, token: TokenSymbol, spender: `0x${string}`) {
  return publicClient.readContract({ address: TOKENS[token].address, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

export interface SendOpts {
  /** Pay gas in USD₮ via the CIP-64 fee-currency adapter (MiniPay supports this). */
  payGasInUsdt?: boolean;
}

export async function sendTx(
  account: `0x${string}`,
  tx: { to: `0x${string}`; data: Hex; value?: bigint },
  opts: SendOpts = {},
): Promise<`0x${string}`> {
  await ensureCelo();
  const wc = walletClient(account);
  const request = {
    account,
    chain: CHAIN,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    ...(opts.payGasInUsdt ? { feeCurrency: TOKENS.USDT.feeCurrencyAdapter } : {}),
  };
  return wc.sendTransaction(request as Parameters<WalletClient["sendTransaction"]>[0]);
}

export function erc20TransferData(to: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

export function erc20ApproveData(spender: `0x${string}`, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

export async function waitForReceipt(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
}
