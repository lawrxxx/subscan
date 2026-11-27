"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { ReviewTable, reviewTotals } from "@/components/review-table";
import { Icon } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { extractStatement } from "@/lib/import";
import { markDuplicates, flagInFileRepeats } from "@/lib/import/normalise";
import { takePendingUpload } from "@/lib/import/pending";
import { PdfPasswordError } from "@/lib/import/pdf";
import type { ColumnMapping, ExtractResult, ExtractedRow } from "@/lib/import/types";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; file: File }
  | { kind: "password"; file: File; incorrect: boolean }
  | { kind: "mapping"; file: File; result: ExtractResult }
  | { kind: "review"; file: File; result: ExtractResult; rows: ExtractedRow[] }


const ROLES: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description / narration", required: true },
  { key: "debit", label: "Money out (debit)" },
  { key: "credit", label: "Money in (credit)" },
  { key: "amount", label: "Single amount column" },
  { key: "type", label: "Type (DR/CR)" },
  { key: "currency", label: "Currency" },
];

const STEPS = ["Add statement", "Check transactions", "Check payments"];

function Progress({ at }: { at: number }) {
  return (
    <>
    <span className="text-[12.5px] text-muted sm:hidden">Step {at + 1} of {STEPS.length}</span>
    <ol className="hidden items-center gap-2 text-[12.5px] sm:flex" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 ${i === at ? "font-medium text-ink" : i < at ? "text-accent" : "text-faint"}`} aria-current={i === at ? "step" : undefined}>
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i < at ? "bg-accent text-surface" : i === at ? "bg-ink text-surface" : "bg-paper-2 text-muted"}`}>{i < at ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className={i === at ? "" : "hidden sm:inline"}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-rule sm:w-8" />}
        </li>
      ))}
    </ol>
    </>
  );
}

export default function UploadStatement() {
  const router = useRouter();
  const { state, ready, importRows, updateSettings } = useStore();
  const home = state.settings.homeCurrency;
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const [password, setPassword] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const input = useRef<HTMLInputElement>(null);
  const took = useRef(false);

  async function read(file: File, opts: { password?: string; mapping?: ColumnMapping } = {}) {
    setError(undefined);
    setStep({ kind: "reading", file });
    try {
      const result = await extractStatement(file, { homeCurrency: home, ...opts });
      if (result.needsMapping) {
        setMapping(result.mapping ?? {});
        return setStep({ kind: "mapping", file, result });
      }
      if (!result.rows.length) {
        setError(result.warnings.join(" ") || "No transactions found in that file.");
        return setStep({ kind: "pick" });
      }
      // Mark rows we already have so the same statement can't be imported twice.
      const rows = flagInFileRepeats(markDuplicates(result.rows, state.transactions));
      setStep({ kind: "review", file, result, rows });
    } catch (e) {
      if (e instanceof PdfPasswordError) return setStep({ kind: "password", file, incorrect: e.incorrect });
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "pick" });
    } finally {
      setPassword("");
    }
  }

  // A file dropped on the overview is handed over in memory and read straight away.
  useEffect(() => {
    if (!ready || took.current) return;
    took.current = true;
    const f = takePendingUpload();
    if (f) void read(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function save() {
    if (step.kind !== "review") return;
    const { subscriptions } = importRows(step.rows, { fileName: step.file.name, format: step.result.format, source: step.result.format.startsWith("PDF") ? "pdf" : "csv" });
    updateSettings({ onboarded: true });
    router.push(subscriptions.some((x) => !x.manual) ? "/review" : "/?imported=none");
  }

  const at = step.kind === "review" ? 1 : 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b rule bg-paper/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <Wordmark className="text-[20px]" />
        <Progress at={at} />
        <Link href="/" className="btn btn-quiet btn-sm" aria-label="Close upload"><Icon name="close" size={16} /><span className="hidden sm:inline">Close</span></Link>
      </header>

      {step.kind === "review" ? (
        <Review step={step} home={home} onChange={(rows) => setStep({ ...step, rows })} onCancel={() => setStep({ kind: "pick" })} onSave={save} />
      ) : (
        <div className="mx-auto max-w-[640px] space-y-5 px-4 py-8 sm:px-6 lg:py-12">
          <section>
            <h1 className="title text-[22px] sm:text-[24px]">Add your bank statement</h1>
            <p className="mt-1 text-[14px] text-ink-2">We&rsquo;ll pull out the transactions, find what repeats, and let you check everything before it&rsquo;s saved.</p>

            <div className="panel mt-5">
              {step.kind === "password" ? (
                <form
                  className="px-5 py-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password) void read(step.file, { password });
                  }}
                >
                  <div className="flex items-center gap-2 text-[13px] text-muted"><Icon name="doc" size={16} />{step.file.name}</div>
                  <h2 className="mt-3 text-[17px] font-semibold">This PDF is password-protected</h2>
                  <p className="mt-1 max-w-md text-[13.5px] text-muted">Banks often lock statements with your date of birth or account number. The password is only used here to open the file. It isn&rsquo;t stored or sent anywhere.</p>
                  <input type="password" autoFocus className="input mt-4 max-w-xs" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="PDF password" placeholder="Statement password" />
                  {step.incorrect && <p className="mt-2 text-[13px] text-alert">That password didn&rsquo;t work. Try again.</p>}
                  <div className="mt-4 flex gap-2">
                    <button className="btn btn-primary" disabled={!password}>Open statement</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setStep({ kind: "pick" })}>Choose another file</button>
                  </div>
                </form>
              ) : step.kind === "mapping" ? (
                <div className="px-5 py-6">
                  <h2 className="text-[17px] font-semibold">Which column is which?</h2>
                  <p className="mt-1 max-w-md text-[13.5px] text-muted">{step.result.warnings[0]}</p>
                  <div className="mt-5 grid max-w-lg gap-2.5">
                    {ROLES.map((r) => (
                      <label key={r.key} className="grid grid-cols-[1fr_1.2fr] items-center gap-3 text-[13px]">
                        <span>{r.label}{r.required && <span className="text-alert"> *</span>}</span>
                        <select className="input" value={mapping[r.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [r.key]: e.target.value || undefined }))}>
                          <option value="">—</option>
                          {step.result.headers?.map((h) => <option key={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] text-muted">Pick money out / money in columns, or one amount column (negative means money out, or use a type column).</p>
                  <div className="mt-5 flex gap-2">
                    <button className="btn btn-primary" disabled={!mapping.date || !mapping.description || !(mapping.amount || mapping.debit || mapping.credit)} onClick={() => void read(step.file, { mapping })}>Read statement</button>
                    <button className="btn btn-ghost" onClick={() => setStep({ kind: "pick" })}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
                  className={`m-2 flex flex-col items-center rounded-[4px] border border-dashed px-5 py-8 text-center transition-colors ${drag ? "border-accent bg-accent-wash" : "border-line-strong bg-paper-2/40"}`}
                >
                  <div className="text-[15px] font-semibold">{step.kind === "reading" ? `Reading ${step.file.name}…` : "Drop your statement here"}</div>
                  <p className="mt-1 max-w-sm text-[13px] text-muted">{step.kind === "reading" ? "Extracting transactions in your browser…" : "Digital PDF from your bank, or a CSV export. Three to twelve months works best."}</p>
                  <button className="btn btn-primary mt-4" disabled={step.kind === "reading"} onClick={() => input.current?.click()}>{step.kind === "reading" ? "Reading…" : "Choose a file"}</button>
                  <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Statement file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
                  {error && <p role="alert" className="mt-4 max-w-md rounded-[6px] bg-alert-wash px-3 py-2 text-[13px] text-alert">{error}</p>}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t rule px-5 py-3">
                <label className="flex items-center gap-2 text-[13px] text-muted">Main currency
                  <select className="input w-auto" value={home} onChange={(e) => updateSettings({ homeCurrency: e.target.value })}>
                    <option value="NGN">Nigerian naira (NGN)</option>
                    <option value="USD">US dollar (USD)</option>
                  </select>
                </label>
                <span className="text-[12px] text-faint">Scanned images aren&rsquo;t supported yet</span>
              </div>
            </div>
          </section>

          <p className="flex items-start gap-2 text-[12.5px] text-muted">
            <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
            The file is read in this browser and never uploaded or stored. You check every transaction before anything is saved, and you can delete it all from Settings.
          </p>
        </div>
      )}
    </div>
  );
}

function Review({ step, home, onChange, onCancel, onSave }: { step: Extract<Step, { kind: "review" }>; home: string; onChange(rows: ExtractedRow[]): void; onCancel(): void; onSave(): void }) {
  const t = reviewTotals(step.rows, home);
  const pending = step.rows.filter((r) => r.issues.length && !r.include && !r.duplicateOf).length;
  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-6xl px-4 pt-5 pb-3 sm:px-6 lg:px-8">
        <h1 className="title text-[21px] sm:text-[24px]">Check your transactions</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          We read <span className="num text-ink">{step.rows.length}</span> rows from {step.file.name} ({step.result.format}). Correct anything that looks wrong. Nothing is saved until you continue.
        </p>
        {step.result.warnings.length > 0 && <ul className="mt-3 space-y-1 rounded-[6px] bg-amber-wash px-3 py-2 text-[13px] text-amber">{step.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ReviewTable rows={step.rows} onChange={onChange} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-surface/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0 text-[12.5px] leading-tight">
            <div><span className="num font-medium">{t.count}</span> transactions to save</div>
            <div className="truncate text-muted">{pending > 0 ? <span className="text-amber">{pending} unclear rows left out</span> : <>out <span className="num">{t.out}</span> · in <span className="num">{t.in}</span></>}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-ghost hidden sm:inline-flex" onClick={onCancel}>Back</button>
            <button className="btn btn-primary" disabled={!t.count} onClick={onSave}>Save and continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}
