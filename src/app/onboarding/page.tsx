"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { ReviewTable, reviewTotals } from "@/components/review-table";
import { useStore } from "@/lib/db/store";
import { KIND_LABEL, KIND_PLURAL } from "@/lib/detection/merchants";
import { money } from "@/lib/format";
import { extractStatement } from "@/lib/import";
import { markDuplicates, flagInFileRepeats } from "@/lib/import/normalise";
import { PdfPasswordError } from "@/lib/import/pdf";
import type { ColumnMapping, ExtractResult, ExtractedRow } from "@/lib/import/types";
import type { ImportRecord, Subscription } from "@/lib/types";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; file: File }
  | { kind: "password"; file: File; incorrect: boolean }
  | { kind: "mapping"; file: File; result: ExtractResult }
  | { kind: "review"; file: File; result: ExtractResult; rows: ExtractedRow[] }
  | { kind: "done"; record: ImportRecord; subs: Subscription[] };

const ROLES: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description / narration", required: true },
  { key: "debit", label: "Money out (debit)" },
  { key: "credit", label: "Money in (credit)" },
  { key: "amount", label: "Single amount column" },
  { key: "type", label: "Type (DR/CR)" },
  { key: "currency", label: "Currency" },
];

export default function UploadStatement() {
  const router = useRouter();
  const { state, importRows, loadSample, updateSettings } = useStore();
  const home = state.settings.homeCurrency;
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const [password, setPassword] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const input = useRef<HTMLInputElement>(null);

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
        setError(result.warnings.join(" ") || "No transactions found.");
        return setStep({ kind: "pick" });
      }
      // Mark rows we already have so the same statement can't be imported twice.
      const rows = flagInFileRepeats(markDuplicates(result.rows, state.dataSource === "sample" ? [] : state.transactions));
      setStep({ kind: "review", file, result, rows });
    } catch (e) {
      if (e instanceof PdfPasswordError) return setStep({ kind: "password", file, incorrect: e.incorrect });
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "pick" });
    } finally {
      setPassword("");
    }
  }

  function save() {
    if (step.kind !== "review") return;
    const { record, subscriptions } = importRows(step.rows, { fileName: step.file.name, format: step.result.format, source: step.result.format.startsWith("PDF") ? "pdf" : "csv" });
    updateSettings({ onboarded: true });
    setStep({ kind: "done", record, subs: subscriptions });
  }

  return (
    <div className="min-h-dvh">
      <div className="flex items-center justify-between border-b rule px-4 py-5 sm:px-8 lg:px-12">
        <Wordmark />
        {state.subscriptions.length > 0 && <Link href="/" className="text-[13px] text-muted link">Back to overview</Link>}
      </div>

      {step.kind === "review" ? (
        <Review step={step} home={home} onChange={(rows) => setStep({ ...step, rows })} onCancel={() => setStep({ kind: "pick" })} onSave={save} />
      ) : step.kind === "done" ? (
        <Done record={step.record} subs={step.subs} home={home} onContinue={() => router.push("/")} />
      ) : (
        <div className="grid lg:grid-cols-[1.05fr_1fr]">
          <section className="border-b rule px-4 py-10 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-16">
            <div className="kicker mb-5">Your bills and subscriptions agent</div>
            <h1 className="display max-w-xl text-[44px] sm:text-[62px]">
              What is your money <span className="italic">already committed to?</span>
            </h1>
            <p className="mt-6 max-w-md text-[16px] text-ink-2">
              Upload a bank or card statement. subscan finds every subscription, utility bill and regular obligation in it, shows what they cost you, and tells you what&rsquo;s due next.
            </p>
            <div className="mt-12 max-w-md border-t rule pt-6">
              <div className="kicker mb-3">How your statement is handled</div>
              <ul className="space-y-3 text-[14px] text-ink-2">
                <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">i.</span>Your file is read inside this browser. It is never uploaded, and the file itself is not kept.</li>
                <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">ii.</span>You review the extracted transactions before anything is saved. Saved data stays on this device.</li>
                <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">iii.</span>The agent sees structured transactions (date, description, amount) — never the statement file — and only when you ask it something.</li>
                <li className="grid grid-cols-[20px_1fr]"><span className="num text-faint">iv.</span>subscan never asks for bank logins or card details. Delete imports any time in Settings.</li>
              </ul>
            </div>
          </section>

          <section className="px-4 py-10 sm:px-8 lg:px-12 lg:py-16">
            {step.kind === "password" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (password) void read(step.file, { password });
                }}
              >
                <div className="kicker mb-3">Protected PDF</div>
                <h2 className="display text-[30px]">{step.file.name} is password-protected</h2>
                <p className="mt-2 max-w-sm text-[14px] text-muted">Many banks lock statements with a password (often your date of birth or account number). It&rsquo;s used only here to open the file and is never stored or sent anywhere.</p>
                <input type="password" autoFocus className="field mt-6 max-w-xs" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="PDF password" />
                {step.incorrect && <p className="mt-2 text-[13px] text-alert">That password didn&rsquo;t work. Try again.</p>}
                <div className="mt-4 flex gap-3">
                  <button className="btn btn-primary" disabled={!password}>Open statement</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setStep({ kind: "pick" })}>Choose another file</button>
                </div>
              </form>
            ) : step.kind === "mapping" ? (
              <div>
                <div className="kicker mb-3">Match columns</div>
                <h2 className="display text-[30px]">Which column is which?</h2>
                <p className="mt-2 max-w-md text-[14px] text-muted">{step.result.warnings[0]}</p>
                <div className="mt-6 grid max-w-lg gap-3">
                  {ROLES.map((r) => (
                    <label key={r.key} className="grid grid-cols-[1fr_1.2fr] items-center gap-3 text-[13px]">
                      <span>{r.label}{r.required && <span className="text-alert"> *</span>}</span>
                      <select className="field h-9" value={mapping[r.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [r.key]: e.target.value || undefined }))}>
                        <option value="">—</option>
                        {step.result.headers?.map((h) => <option key={h}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-muted">Pick either money out / money in columns, or a single amount column (negative = money out, or with a type column).</p>
                <div className="mt-6 flex gap-3">
                  <button className="btn btn-primary" disabled={!mapping.date || !mapping.description || !(mapping.amount || mapping.debit || mapping.credit)} onClick={() => void read(step.file, { mapping })}>Read statement</button>
                  <button className="btn btn-ghost" onClick={() => setStep({ kind: "pick" })}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
                  className={`border border-dashed px-6 py-12 transition-colors ${drag ? "border-accent bg-accent-wash" : "border-rule bg-paper-2/50"}`}
                >
                  <div className="kicker mb-2">Step 1 · Upload</div>
                  <div className="display text-[32px]">{step.kind === "reading" ? `Reading ${step.file.name}…` : "Upload your statement"}</div>
                  <p className="mt-2 max-w-sm text-[14px] text-muted">PDF statements downloaded from your bank (not scanned photos), or a CSV export. 3–12 months works best.</p>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button className="btn btn-primary" disabled={step.kind === "reading"} onClick={() => input.current?.click()}>{step.kind === "reading" ? "Reading…" : "Choose PDF or CSV"}</button>
                    <span className="text-[12px] text-muted">or drag it here</span>
                    <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
                  </div>
                  {error && <p role="alert" className="mt-4 max-w-md text-[13px] text-alert">{error}</p>}
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="text-[12px] text-muted">Your main currency
                    <select className="field mt-1 text-ink" value={home} onChange={(e) => updateSettings({ homeCurrency: e.target.value })}>
                      <option value="NGN">Nigerian naira (NGN)</option>
                      <option value="USD">US dollar (USD)</option>
                    </select>
                  </label>
                  <div className="text-[12px] text-muted">
                    No statement handy?
                    <button className="btn btn-ghost mt-1 w-full" onClick={() => { loadSample(); router.push("/"); }}>Explore with a sample statement</button>
                  </div>
                </div>
                <p className="mt-6 text-[12px] text-muted">Supported: CSV exports from any bank or card, and digital PDF statements with a transactions table (date, description, debit/credit or amount, balance). Scanned images aren&rsquo;t supported yet.</p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Review({ step, home, onChange, onCancel, onSave }: { step: Extract<Step, { kind: "review" }>; home: string; onChange(rows: ExtractedRow[]): void; onCancel(): void; onSave(): void }) {
  const t = reviewTotals(step.rows, home);
  const pending = step.rows.filter((r) => r.issues.length && !r.include && !r.duplicateOf).length;
  return (
    <div className="pb-28">
      <div className="border-b rule px-4 py-8 sm:px-8 lg:px-12">
        <div className="kicker mb-3">Step 2 · Review what we found</div>
        <h1 className="display text-[38px] sm:text-[48px]">{step.rows.length} transactions in {step.file.name}</h1>
        <p className="mt-2 text-[14px] text-muted">
          Read as {step.result.format}. Check dates, descriptions, amounts and whether money went out or in. Nothing is saved until you continue.
        </p>
        {step.result.warnings.length > 0 && <ul className="mt-4 space-y-1 text-[13px] text-amber">{step.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </div>
      <div className="px-4 py-6 sm:px-8 lg:px-12">
        <ReviewTable rows={step.rows} onChange={onChange} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink bg-paper/95 px-4 py-3 backdrop-blur sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px]">
            <span className="num font-medium">{t.count}</span> to save · out <span className="num">{t.out}</span> · in <span className="num">{t.in}</span>
            {t.from && <span className="text-muted"> · {t.from} → {t.to}</span>}
            {pending > 0 && <span className="text-amber"> · {pending} flagged rows left out</span>}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" disabled={!t.count} onClick={onSave}>Save &amp; find my bills</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Done({ record, subs, home, onContinue }: { record: ImportRecord; subs: Subscription[]; home: string; onContinue(): void }) {
  const byKind = (["subscription", "utility", "obligation"] as const).map((k) => ({ k, list: subs.filter((s) => (s.kind ?? "subscription") === k && s.status !== "dismissed") }));
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-8">
      <div className="kicker mb-3">Step 3 · Your obligations</div>
      <div className="figure text-[110px] leading-none">{subs.filter((s) => s.status !== "dismissed").length}</div>
      <h1 className="display mt-2 text-[34px]">recurring payments found</h1>
      <p className="mt-2 text-[14px] text-muted">
        {record.rows} transactions saved{record.duplicates ? `, ${record.duplicates} already imported were skipped` : ""}. Each item stays “detected” until you confirm it.
      </p>
      <div className="mt-8 grid gap-px border rule bg-rule sm:grid-cols-3">
        {byKind.map(({ k, list }) => (
          <div key={k} className="bg-paper px-4 py-4">
            <div className="kicker">{KIND_PLURAL[k]}</div>
            <div className="figure mt-2 text-[40px]">{list.length}</div>
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">{list.slice(0, 4).map((s) => <li key={s.id} className="truncate">{s.displayName} · {money(s.amount, s.currency)}</li>)}</ul>
          </div>
        ))}
      </div>
      <button className="btn btn-primary mt-8" onClick={onContinue}>See what&rsquo;s committed</button>
      <span className="ml-3 text-[12px] text-muted">Home currency {home}</span>
    </div>
  );
}
