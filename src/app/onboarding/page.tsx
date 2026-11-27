"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { parseTransactionsCsv, type ParseResult } from "@/lib/detection/csv";
import { useStore } from "@/lib/db/store";
import { sampleStatementCsv } from "@/lib/sample";
import type { Subscription } from "@/lib/types";
import { money } from "@/lib/format";

export default function Onboarding() {
  const router = useRouter();
  const { importTransactions, state, updateSettings } = useStore();
  const [result, setResult] = useState<{ parse: ParseResult; subs: Subscription[]; source: "csv" | "sample"; file?: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const home = state.settings.homeCurrency;

  function run(text: string, source: "csv" | "sample", file?: string) {
    const parse = parseTransactionsCsv(text, home, source);
    const subs = parse.transactions.length ? importTransactions(parse.transactions, source) : [];
    if (subs.length) updateSettings({ onboarded: true });
    setResult({ parse, subs, source, file });
  }

  async function onFile(f?: File | null) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setResult({ parse: { transactions: [], skipped: 0, columns: {}, dateFormat: "dmy", warnings: ["File is larger than 10 MB."] }, subs: [], source: "csv", file: f.name });
    run(await f.text(), "csv", f.name);
  }

  function downloadSample() {
    const blob = new Blob([sampleStatementCsv()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "subscan-sample-statement.csv";
    a.click();
  }

  return (
    <div className="min-h-dvh">
      <div className="flex items-center justify-between border-b rule px-4 py-5 sm:px-8 lg:px-12">
        <Wordmark />
        {state.subscriptions.length > 0 && <Link href="/" className="text-[13px] text-muted link">Back to overview</Link>}
      </div>

      <div className="grid lg:grid-cols-[1.05fr_1fr]">
        <section className="border-b rule px-4 py-10 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-16">
          <div className="kicker mb-5">Step 1 of 2 · Import</div>
          <h1 className="display max-w-xl text-[44px] sm:text-[64px]">
            Every recurring charge, <span className="italic">accounted for.</span>
          </h1>
          <p className="mt-6 max-w-md text-[16px] text-ink-2">
            subscan reads a bank or card statement, finds the payments that repeat, and tells you what they cost you over a year — before the next one lands.
          </p>

          <div className="mt-12 max-w-md border-t rule pt-6">
            <div className="kicker mb-3">How your data is handled</div>
            <ul className="space-y-3 text-[14px] text-ink-2">
              <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">i.</span>The statement is parsed in this browser and stored only on this device. Raw rows are never uploaded.</li>
              <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">ii.</span>When you ask the agent a question, a summary of your detected subscriptions is sent to the server for that request only and is not stored.</li>
              <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">iii.</span>Payments are signed in your own wallet. subscan never holds keys or funds.</li>
              <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">iv.</span>Clear everything at any time from Settings.</li>
            </ul>
          </div>
        </section>

        <section className="px-4 py-10 sm:px-8 lg:px-12 lg:py-16">
          {!result ? (
            <>
              <label className="kicker mb-2 block" htmlFor="home">Home currency</label>
              <select id="home" className="field mb-8 max-w-[220px]" value={home} onChange={(e) => updateSettings({ homeCurrency: e.target.value })}>
                <option value="NGN">Nigerian naira (NGN)</option>
                <option value="USD">US dollar (USD)</option>
              </select>

              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]); }}
                className={`border border-dashed px-6 py-10 transition-colors ${drag ? "border-accent bg-accent-wash" : "border-rule bg-paper-2/50"}`}
              >
                <div className="display text-[28px]">Upload a statement</div>
                <p className="mt-2 max-w-sm text-[14px] text-muted">
                  CSV export from your bank or card. We look for a date, a description or narration, and an amount (or debit/credit) column.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button className="btn btn-primary" onClick={() => input.current?.click()}>Choose CSV file</button>
                  <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
                </div>
              </div>

              <div className="mt-px grid border border-t-0 rule sm:grid-cols-2">
                <button onClick={() => run(sampleStatementCsv(), "sample")} className="border-b rule px-6 py-5 text-left hover:bg-paper-2 sm:border-b-0 sm:border-r">
                  <div className="text-[14px] font-medium">Try a sample statement</div>
                  <div className="mt-1 text-[13px] text-muted">12 months of made-up Lagos spending. Labelled as sample throughout.</div>
                </button>
                <div className="px-6 py-5">
                  <div className="text-[14px] font-medium text-muted">Bank account linking</div>
                  <div className="mt-1 text-[13px] text-muted">Not part of this release. Export a CSV from your bank app or internet banking and upload it here.</div>
                </div>
              </div>
              <button onClick={downloadSample} className="mt-4 text-[13px] text-muted link">Download the sample as CSV to see the expected format</button>
            </>
          ) : (
            <ImportResult result={result} onDone={() => router.push("/")} onRetry={() => setResult(null)} home={home} />
          )}
        </section>
      </div>
    </div>
  );
}

function ImportResult({ result, onDone, onRetry, home }: { result: { parse: ParseResult; subs: Subscription[]; source: string; file?: string }; onDone(): void; onRetry(): void; home: string }) {
  const { parse, subs } = result;
  if (!parse.transactions.length)
    return (
      <div>
        <div className="kicker mb-3 text-alert">Import failed</div>
        <div className="display text-[30px]">We couldn&rsquo;t read that file.</div>
        <ul className="mt-4 space-y-2 text-[14px] text-ink-2">{parse.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        <button className="btn btn-ghost mt-8" onClick={onRetry}>Try another file</button>
      </div>
    );
  const range = [parse.transactions[0]?.date, parse.transactions[parse.transactions.length - 1]?.date].sort();
  return (
    <div>
      <div className="kicker mb-3">Step 2 of 2 · Review</div>
      <div className="figure text-[96px] sm:text-[120px]">{subs.length}</div>
      <div className="display mt-2 text-[28px]">possible subscriptions found</div>
      <dl className="mt-8 grid grid-cols-2 border-t rule text-[13px]">
        <div className="border-b rule py-3"><dt className="text-muted">Source</dt><dd className="mt-0.5">{result.source === "sample" ? "Sample statement" : result.file}</dd></div>
        <div className="border-b rule py-3 pl-4"><dt className="text-muted">Period</dt><dd className="num mt-0.5">{range[0]} → {range[1]}</dd></div>
        <div className="border-b rule py-3"><dt className="text-muted">Outgoing payments read</dt><dd className="num mt-0.5">{parse.transactions.length}</dd></div>
        <div className="border-b rule py-3 pl-4"><dt className="text-muted">Skipped (credits, blanks)</dt><dd className="num mt-0.5">{parse.skipped}</dd></div>
      </dl>
      <ul className="mt-6 divide-y divide-rule-soft">
        {subs.slice(0, 6).map((s) => (
          <li key={s.id} className="flex items-baseline justify-between py-2 text-[14px]">
            <span>{s.displayName}</span>
            <span className="num text-muted">{money(s.amount, s.currency)} · {Math.round(s.confidence * 100)}%</span>
          </li>
        ))}
      </ul>
      {subs.length > 6 && <p className="mt-2 text-[13px] text-muted">and {subs.length - 6} more</p>}
      <p className="mt-6 text-[13px] text-muted">Detected items stay unconfirmed until you confirm, edit or dismiss them. Home currency: {home}.</p>
      <div className="mt-8 flex gap-3">
        <button className="btn btn-primary" onClick={onDone}>Review subscriptions</button>
        <button className="btn btn-ghost" onClick={onRetry}>Import a different file</button>
      </div>
    </div>
  );
}
