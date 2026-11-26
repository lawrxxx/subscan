"use client";
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
  const { state, updateSettings, reset } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [reg, setReg] = useState<{ busy?: boolean; hash?: `0x${string}`; error?: string }>({});
  const [confirmReset, setConfirmReset] = useState(false);

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
      <PageHeader kicker="Wallet & settings" title="Wallet, network and data" />

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

          <div className="mt-10 border-t rule pt-6">
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={state.settings.payGasInUsdt} onChange={(e) => updateSettings({ payGasInUsdt: e.target.checked })} />
              <span>
                Pay network fees in USD₮
                <span className="block text-[12px] text-muted">Uses Celo fee abstraction (CIP-64 adapter {TOKENS.USDT.feeCurrencyAdapter?.slice(0, 10)}…). Supported by MiniPay; some wallets ignore it and charge CELO.</span>
              </span>
            </label>
            <label className="mt-5 block text-[12px] text-muted">Home currency
              <select className="field mt-1 block max-w-[220px] text-ink" value={state.settings.homeCurrency} onChange={(e) => updateSettings({ homeCurrency: e.target.value })}>
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>
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

      <section className="grid lg:grid-cols-[1.2fr_1fr]">
        <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12">
          <h2 className="display mb-4 text-[26px]">Integrations</h2>
          <ul className="border-t border-ink text-[14px]">
            <Integration name="Celo mainnet RPC" ok={status?.celoRpc.ok} detail={status?.celoRpc.ok ? `Block ${status.celoRpc.block}` : status?.celoRpc.error} />
            <Integration name="Textile FX (USD₮ ↔ cNGN)" ok={status?.textile.ok} detail={status?.textile.ok ? `Live · 1 USD₮ ≈ ₦${status.textile.ngnPerUsd?.toFixed(2)} · auth: ${status.textile.auth}` : status?.textile.error} />
            <Integration name="Agent model" ok={status?.agent.llm} warn detail={status ? (status.agent.llm ? `${status.agent.model} with tool use` : "No ANTHROPIC_API_KEY — local intent mode (same tools, no LLM)") : undefined} />
            <Integration name="Supabase receipts" ok={status?.supabase} warn detail={status ? (status.supabase ? "Mirroring payment records" : "Not configured — receipts stored on this device") : undefined} />
            <Integration name="Mono bank linking" ok={false} warn detail="Not available — use CSV import" />
          </ul>
          <dl className="mt-6 space-y-1 text-[12px] text-muted">
            <div>Textile LimitOrderReactor: <a className="font-mono link" href={addressUrl(TEXTILE.reactor)} target="_blank" rel="noreferrer">{TEXTILE.reactor}</a></div>
            <div>USD₮: <a className="font-mono link" href={addressUrl(TOKENS.USDT.address)} target="_blank" rel="noreferrer">{TOKENS.USDT.address}</a></div>
            <div>cNGN: <a className="font-mono link" href={addressUrl(TOKENS.cNGN.address)} target="_blank" rel="noreferrer">{TOKENS.cNGN.address}</a></div>
          </dl>
        </div>
        <div className="px-4 py-10 sm:px-8 lg:px-10">
          <h2 className="display mb-4 text-[26px]">Your data</h2>
          <p className="text-[14px] text-muted">
            {state.transactions.length} transactions, {state.subscriptions.length} subscriptions and {state.payments.length} payment records are stored in this browser.
          </p>
          {!confirmReset ? (
            <button className="btn btn-ghost mt-5 text-alert" onClick={() => setConfirmReset(true)}>Clear imported data</button>
          ) : (
            <div className="mt-5 flex items-center gap-3">
              <button className="btn btn-primary bg-alert" onClick={() => { reset(); setConfirmReset(false); }}>Yes, clear everything</button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Integration({ name, ok, detail, warn }: { name: string; ok?: boolean; detail?: string; warn?: boolean }) {
  const dot = ok === undefined ? "bg-stone" : ok ? "bg-accent" : warn ? "bg-amber" : "bg-alert";
  return (
    <li className="flex items-start justify-between gap-4 border-b rule py-3">
      <span className="flex items-center gap-2.5"><span className={`h-2 w-2 ${dot}`} />{name}</span>
      <span className="max-w-[60%] text-right text-[12px] text-muted">{detail ?? "Checking…"}</span>
    </li>
  );
}
