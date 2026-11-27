"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseEventLogs, encodeFunctionData } from "viem";
import { addressUrl, CHAIN_ID, ERC8004, ERC8004_IDENTITY_ABI, TEXTILE, TOKENS } from "@/lib/celo/config";
import { publicClient, sendTx, waitForReceipt } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";
import { HashLink } from "@/components/bits";
import { PageHeader } from "@/components/shell";
import { useWallet } from "@/components/wallet";

interface Status {
  celoRpc: { ok: boolean; block?: string; error?: string };
  textile: { ok: boolean; ngnPerUsd?: number; auth?: string; error?: string };
  agent: { llm: boolean; model: string };
  supabase: boolean;
  mono: boolean;
  erc8004AgentId: string | null;
}

export default function WalletPage() {
  const w = useWallet();
  const { state, updateSettings } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [reg, setReg] = useState<{ busy?: boolean; hash?: `0x${string}`; error?: string }>({});

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j) => setStatus(j.data)).catch(() => {});
  }, []);

  const agentId = state.settings.agentId ?? status?.erc8004AgentId ?? undefined;

  async function register() {
    if (!w.address) return;
    setReg({ busy: true });
    try {
      const uri = `${window.location.origin}/api/erc8004`;
      await publicClient.simulateContract({ account: w.address, address: ERC8004.identityRegistry, abi: ERC8004_IDENTITY_ABI, functionName: "register", args: [uri] });
      const hash = await sendTx(w.address, { to: ERC8004.identityRegistry, data: encodeFunctionData({ abi: ERC8004_IDENTITY_ABI, functionName: "register", args: [uri] }) }, { payGasInUsdt: state.settings.payGasInUsdt });
      setReg({ busy: true, hash });
      const receipt = await waitForReceipt(hash);
      const [ev] = parseEventLogs({ abi: ERC8004_IDENTITY_ABI, eventName: "Registered", logs: receipt.logs });
      if (receipt.status !== "success" || !ev) throw new Error("Registration transaction did not emit Registered");
      updateSettings({ agentId: ev.args.agentId.toString(), agentRegistrationTx: hash });
      setReg({ hash });
    } catch (e) {
      setReg((r) => ({ ...r, busy: false, error: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message }));
    }
  }

  return (
    <div>
      <PageHeader kicker="Wallet" title={<>Your wallet on <span className="italic">Celo</span></>}>Balances are read live from Celo mainnet. subscan never holds keys or funds.</PageHeader>

      <section className="grid border-b rule lg:grid-cols-[1.2fr_1fr]">
        <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12">
          <div className="kicker mb-4">Wallet</div>
          {!w.address ? (
            <>
              <div className="display text-[30px]">Not connected</div>
              <p className="mt-2 max-w-md text-[14px] text-muted">
                {w.hasProvider ? `Detected: ${w.name}. ` : "No browser wallet detected. Open subscan in MiniPay or install a Celo-compatible wallet (MetaMask, Valora, Rabby). "}
                subscan asks for your address only; every transaction needs your approval in the wallet.
              </p>
              <button className="btn btn-primary mt-6" onClick={w.connect} disabled={!w.hasProvider || w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>
            </>
          ) : (
            <>
              <a href={addressUrl(w.address)} target="_blank" rel="noreferrer" className="font-mono text-[14px] break-all link">{w.address}</a>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="tag">{w.name}</span>
                {w.onCelo ? <span className="tag border-accent/40 bg-accent-wash text-accent">Celo mainnet · {CHAIN_ID}</span> : <><span className="tag border-alert/40 bg-alert-wash text-alert">Chain {w.chainId ?? "?"}</span><button className="link text-[13px]" onClick={w.switchToCelo}>Switch to Celo</button></>}
              </div>
              <div className="mt-8 grid grid-cols-3 border-t border-ink">
                {(["USDT", "cNGN", "CELO"] as const).map((t) => (
                  <div key={t} className="border-b rule py-4 pr-3">
                    <div className="text-[12px] text-muted">{t === "CELO" ? "CELO" : TOKENS[t].display}</div>
                    <div className="figure mt-1 text-[30px] sm:text-[38px]">{w.balances ? Number(w.balances[t]).toLocaleString("en-US", { maximumFractionDigits: t === "CELO" ? 4 : 2 }) : "—"}</div>
                  </div>
                ))}
              </div>
              {w.balanceError && <p className="mt-2 text-[12px] text-alert">{w.balanceError}</p>}
              <div className="mt-4 flex gap-3">
                <button className="btn btn-ghost" onClick={w.refresh}>Refresh balances</button>
                <button className="btn btn-ghost" onClick={w.disconnect}>Forget wallet</button>
              </div>
            </>
          )}
          {w.error && <p className="mt-3 text-[13px] text-alert">{w.error}</p>}

        </div>

        <div className="bg-paper-2/60 px-4 py-10 sm:px-8 lg:px-10">
          <div className="kicker mb-4">Agent identity · ERC-8004</div>
          {agentId ? (
            <>
              <div className="figure text-[64px]">#{agentId}</div>
              <p className="mt-2 text-[13px] text-muted">Registered on the ERC-8004 Identity Registry, Celo mainnet.</p>
              {state.settings.agentRegistrationTx && <div className="mt-2"><HashLink hash={state.settings.agentRegistrationTx} /></div>}
            </>
          ) : (
            <>
              <div className="display text-[26px]">Not registered</div>
              <p className="mt-2 text-[13px] text-muted">
                Registering mints an identity NFT to the signing wallet, which becomes its owner and published agent wallet. Use a dedicated wallet, or run <code className="font-mono">npm run agent:register</code> server-side.
              </p>
              <button className="btn btn-ghost mt-5" disabled={!w.address || !w.onCelo || reg.busy} onClick={register}>{reg.busy ? "Registering…" : "Register from this wallet"}</button>
              {reg.hash && <div className="mt-2"><HashLink hash={reg.hash} /></div>}
              {reg.error && <p className="mt-2 text-[12px] text-alert">{reg.error}</p>}
            </>
          )}
          <dl className="mt-6 space-y-1 text-[12px]">
            <div className="flex justify-between gap-2"><dt className="text-muted">Registry</dt><dd><a className="font-mono link" href={addressUrl(ERC8004.identityRegistry)} target="_blank" rel="noreferrer">{ERC8004.identityRegistry.slice(0, 10)}…</a></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Agent card</dt><dd><a className="font-mono link" href="/api/erc8004" target="_blank" rel="noreferrer">/api/erc8004</a></dd></div>
          </dl>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-8 lg:px-12">
        <h2 className="display mb-4 text-[26px]">Contracts subscan uses</h2>
        <dl className="max-w-3xl border-t border-ink text-[13px]">
          {[
            ["USD₮ token", TOKENS.USDT.address],
            ["cNGN token", TOKENS.cNGN.address],
            ["Textile FX LimitOrderReactor", TEXTILE.reactor],
            ["ERC-8004 Identity Registry", ERC8004.identityRegistry],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 border-b rule py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-muted">{k}</dt>
              <dd><a className="font-mono text-[12px] link break-all" href={addressUrl(v)} target="_blank" rel="noreferrer">{v}</a></dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-muted">Celo mainnet, chain {CHAIN_ID}. Addresses verified against Textile FX and Celo documentation. Network preferences live in <Link href="/settings" className="link">Settings</Link>.</p>
      </section>
    </div>
  );
}
