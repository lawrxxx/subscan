"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAIN_ID } from "@/lib/celo/config";
import { connectWallet, currentChainId, ensureCelo, getBalances, provider, walletName, type Balances } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";

interface WalletCtx {
  address?: `0x${string}`;
  chainId: number | null;
  onCelo: boolean;
  hasProvider: boolean;
  name: string;
  balances?: Balances;
  balanceError?: string;
  connecting: boolean;
  error?: string;
  connect(): Promise<void>;
  switchToCelo(): Promise<void>;
  refresh(): Promise<void>;
  disconnect(): void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { state, updateSettings, ready } = useStore();
  const [address, setAddress] = useState<`0x${string}`>();
  const [chainId, setChainId] = useState<number | null>(null);
  const [balances, setBalances] = useState<Balances>();
  const [balanceError, setBalanceError] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [hasProvider, setHasProvider] = useState(false);
  const [name, setName] = useState("No wallet");

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setBalances(await getBalances(address));
      setBalanceError(undefined);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : String(e));
    }
  }, [address]);

  // Restore a previously authorised account silently (eth_accounts never prompts).
  useEffect(() => {
    if (!ready) return;
    const p = provider();
    setHasProvider(!!p);
    setName(walletName());
    if (!p) return;
    p.request({ method: "eth_accounts" })
      .then((a) => {
        const acc = (a as string[])[0] as `0x${string}` | undefined;
        if (acc) setAddress(acc);
        else if (state.settings.wallet) updateSettings({ wallet: undefined });
      })
      .catch(() => {});
    currentChainId().then(setChainId).catch(() => {});
    const onAccounts = (a: unknown) => {
      const acc = (a as string[])[0] as `0x${string}` | undefined;
      setAddress(acc);
      updateSettings({ wallet: acc });
    };
    const onChain = (id: unknown) => setChainId(Number(id));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    // MiniPay injects an already-connected account; connect implicitly there.
    if (p.isMiniPay) connectWallet().then((acc) => setAddress(acc)).catch(() => {});
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (address && state.settings.wallet !== address) updateSettings({ wallet: address });
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const value = useMemo<WalletCtx>(
    () => ({
      address,
      chainId,
      onCelo: chainId === CHAIN_ID,
      hasProvider,
      name,
      balances,
      balanceError,
      connecting,
      error,
      async connect() {
        setConnecting(true);
        setError(undefined);
        try {
          const acc = await connectWallet();
          setAddress(acc);
          await ensureCelo().catch((e) => setError(`Connected, but could not switch to Celo: ${e.message ?? e}`));
          setChainId(await currentChainId());
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setConnecting(false);
        }
      },
      async switchToCelo() {
        setError(undefined);
        try {
          await ensureCelo();
          setChainId(await currentChainId());
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
      refresh,
      disconnect() {
        setAddress(undefined);
        setBalances(undefined);
        updateSettings({ wallet: undefined });
      },
    }),
    [address, chainId, hasProvider, name, balances, balanceError, connecting, error, refresh, updateSettings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}
