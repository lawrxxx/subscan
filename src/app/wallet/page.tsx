"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { parseEventLogs, encodeFunctionData } from "viem";
import { addressUrl, CHAIN_ID, ERC8004, ERC8004_IDENTITY_ABI, TEXTILE, TOKENS } from "@/lib/celo/config";
import { ATTRIBUTION_CODES } from "@/lib/celo/attribution";
import { publicClient, sendTx, waitForReceipt } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";
import { shortHash } from "@/lib/format";
import { HashLink } from "@/components/bits";
import { EmptyPanel, Icon, PageBar } from "@/components/ui";
import { useWallet } from "@/components/wallet";

interface Status {
  celoRpc: { ok: boolean; block?: string; error?: string };
  textile: { ok: boolean; ngnPerUsd?: number; auth?: string; error?: string };
  erc8004AgentId: string | null;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b rule-soft px-4 py-2.5 text-[13px] last:border-b-0 sm:px-5">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
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
  const fx = state.activity.filter((a) => a.kind === "conversion" && a.status === "completed");

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
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/settings" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />settings</Link></div>
      <PageBar
        title="everyday wallet"
        sub="The wallet you already use (MiniPay, MetaMask), for adding money to your payment wallet. subscan never holds its keys."
        actions={w.address ? <button className="btn btn-ghost" onClick={w.refresh}>Refresh</button> : <button className="btn btn-primary" onClick={w.connect} disabled={!w.hasProvider || w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>}
      />

      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:px-8">
        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Connected wallet</h2>
              {w.address && (w.onCelo ? <span className="pill pill-green">Celo mainnet</span> : <span className="pill pill-red">Wrong network</span>)}
            </div>
            {!w.address ? (
              <EmptyPanel icon="wallet" title="No wallet connected" action={<button className="btn btn-primary" onClick={w.connect} disabled={!w.hasProvider || w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>}>
                {w.hasProvider ? `${w.name} detected. ` : "No browser wallet found. Open subscan in MiniPay, or use MetaMask, Valora or Rabby. "}
                subscan only reads your address; every transaction needs your approval in the wallet.
              </EmptyPanel>
            ) : (
              <>
                <dl>
                  <Row k="Address"><a href={addressUrl(w.address)} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] link"><span className="hidden sm:inline">{w.address}</span><span className="sm:hidden">{shortHash(w.address, 6)}</span> ↗</a></Row>
                  <Row k="Wallet">{w.name}</Row>
                  <Row k="Network">{w.onCelo ? <>Celo mainnet · chain {CHAIN_ID}</> : <span className="inline-flex items-center gap-2 text-alert">Chain {w.chainId ?? "unknown"} <button className="btn btn-ghost btn-sm" onClick={w.switchToCelo}>Switch to Celo</button></span>}</Row>
                  <Row k="Network fees">{state.settings.payGasInUsdt ? "Paid in USD₮ (fee abstraction)" : "Paid in CELO"} · <Link href="/settings" className="link">change</Link></Row>
                </dl>
                <div className="border-t rule">
                  <table className="tbl">
                    <thead><tr><th>Asset</th><th className="hidden sm:table-cell">Contract</th><th className="r">Balance</th></tr></thead>
                    <tbody>
                      {(["USDT", "cNGN", "CELO"] as const).map((t) => (
                        <tr key={t}>
                          <td className="font-medium">{t === "CELO" ? "CELO" : TOKENS[t].display}<div className="text-[12px] font-normal text-muted">{t === "USDT" ? "Tether USD" : t === "cNGN" ? "Nigerian naira stablecoin" : "Celo native · gas"}</div></td>
                          <td className="hidden sm:table-cell">{t === "CELO" ? <span className="text-[12px] text-muted">Native</span> : <a className="font-mono text-[12px] link" href={addressUrl(TOKENS[t].address)} target="_blank" rel="noreferrer">{shortHash(TOKENS[t].address, 4)}</a>}</td>
                          <td className="r figure text-[17px]">{w.balances ? Number(w.balances[t]).toLocaleString("en-US", { maximumFractionDigits: t === "CELO" ? 4 : 2 }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {w.balanceError && <p className="border-t rule px-5 py-2 text-[12px] text-alert">{w.balanceError}</p>}
                <div className="flex justify-end border-t rule px-4 py-2.5"><button className="btn btn-quiet btn-sm" onClick={w.disconnect}>Forget wallet</button></div>
              </>
            )}
            {w.error && <p className="border-t rule px-5 py-2 text-[12px] text-alert">{w.error}</p>}
          </section>

        </div>

        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Textile FX</h2>
              {status && (status.textile.ok ? <span className="pill pill-green">Live</span> : <span className="pill pill-red">Unavailable</span>)}
            </div>
            <div className="px-4 pt-4 pb-3 sm:px-5">
              <div className="label">Indicative rate</div>
              <div className="figure mt-1 text-[24px]">{status?.textile.ngnPerUsd ? <>1 USD₮ = ₦{status.textile.ngnPerUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</> : status ? "—" : "Loading…"}</div>
              <p className="mt-1 text-[12px] text-muted">Indicative only. Every conversion uses a firm Textile quote, valid for a short window.</p>
            </div>
            <dl className="border-t rule">
              <Row k="Pair">USD₮ ↔ cNGN</Row>
              <Row k="Protocol fee">Shown on each quote</Row>
              <Row k="Settlement">LimitOrderReactor · <a className="font-mono text-[12px] link" href={addressUrl(TEXTILE.reactor)} target="_blank" rel="noreferrer">{shortHash(TEXTILE.reactor, 4)}</a></Row>
              <Row k="Quote auth">{status?.textile.auth === "api-key" ? "Builder API key (server-side)" : "Wallet proof (EIP-712)"}</Row>
              <Row k="Your conversions">{fx.length ? `${fx.length} completed` : "None yet"}</Row>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Agent identity · ERC-8004</h2>
              {agentId ? <span className="pill pill-green">Registered</span> : <span className="pill">Not registered</span>}
            </div>
            {agentId ? (
              <div className="px-4 py-4 sm:px-5">
                <div className="figure text-[28px]">Agent #{agentId}</div>
                <p className="mt-1 text-[12.5px] text-muted">Registered on the ERC-8004 Identity Registry, Celo mainnet.</p>
                {state.settings.agentRegistrationTx && <div className="mt-2"><HashLink hash={state.settings.agentRegistrationTx} /></div>}
              </div>
            ) : (
              <div className="px-4 py-4 sm:px-5">
                <p className="text-[13px] text-muted">Registering mints an identity NFT to the signing wallet, which becomes its owner. Use a dedicated wallet, or run <code className="font-mono text-[12px]">npm run agent:register</code> on a server.</p>
                <button className="btn btn-ghost mt-3" disabled={!w.address || !w.onCelo || reg.busy} onClick={register}>{reg.busy ? "Registering…" : "Register from this wallet"}</button>
                {reg.hash && <div className="mt-2"><HashLink hash={reg.hash} /></div>}
                {reg.error && <p className="mt-2 text-[12px] text-alert">{reg.error}</p>}
              </div>
            )}
            <dl className="border-t rule">
              <Row k="Registry"><a className="font-mono text-[12px] link" href={addressUrl(ERC8004.identityRegistry)} target="_blank" rel="noreferrer">{shortHash(ERC8004.identityRegistry, 4)}</a></Row>
              <Row k="Agent card"><a className="font-mono text-[12px] link" href="/api/erc8004" target="_blank" rel="noreferrer">/api/erc8004 ↗</a></Row>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Transaction attribution</h2><span className="pill pill-plain">ERC-8021</span></div>
            <div className="px-4 py-4 text-[13px] sm:px-5">
              <p className="text-muted">Every transaction subscan builds carries these builder codes in its calldata, so it can be verified on chain.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{ATTRIBUTION_CODES.map((c) => <code key={c} className="tag font-mono">{c}</code>)}</div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Network</h2>{status && (status.celoRpc.ok ? <span className="pill pill-green">Online</span> : <span className="pill pill-red">Unreachable</span>)}</div>
            <dl>
              <Row k="Chain">Celo mainnet · {CHAIN_ID}</Row>
              <Row k="Latest block"><span className="num">{status?.celoRpc.block ? Number(status.celoRpc.block).toLocaleString("en-US") : "—"}</span></Row>
              <Row k="Explorer"><a href="https://celoscan.io" target="_blank" rel="noreferrer" className="link">celoscan.io <Icon name="arrow" size={12} className="inline" /></a></Row>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
