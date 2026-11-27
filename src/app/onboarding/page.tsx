"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { ReviewTable, reviewTotals } from "@/components/review-table";
import { Avatar, ConfidenceText, Icon } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { KIND_LABEL } from "@/lib/detection/merchants";
import { date, FREQ_LABEL, money } from "@/lib/format";
import { extractStatement } from "@/lib/import";
import { markDuplicates, flagInFileRepeats } from "@/lib/import/normalise";
import { takePendingUpload } from "@/lib/import/pending";
import { PdfPasswordError } from "@/lib/import/pdf";
import type { ColumnMapping, ExtractResult, ExtractedRow } from "@/lib/import/types";
import type { ImportRecord, ObligationKind } from "@/lib/types";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; file: File }
  | { kind: "password"; file: File; incorrect: boolean }
  | { kind: "mapping"; file: File; result: ExtractResult }
  | { kind: "review"; file: File; result: ExtractResult; rows: ExtractedRow[] }
  | { kind: "bills"; record: ImportRecord; ids: string[] };

const ROLES: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description / narration", required: true },
  { key: "debit", label: "Money out (debit)" },
  { key: "credit", label: "Money in (credit)" },
  { key: "amount", label: "Single amount column" },
  { key: "type", label: "Type (DR/CR)" },
  { key: "currency", label: "Currency" },
];

const STEPS = ["Upload", "Check transactions", "Review bills"];

function Progress({ at }: { at: number }) {
  return (
    <ol className="flex items-center gap-2 text-[12.5px]" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 ${i === at ? "font-medium text-ink" : i < at ? "text-accent" : "text-faint"}`} aria-current={i === at ? "step" : undefined}>
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i < at ? "bg-accent text-surface" : i === at ? "bg-ink text-surface" : "bg-paper-2 text-muted"}`}>{i < at ? <Icon name="check" size={12} /> : i + 1}</span>
          <span className={i === at ? "" : "hidden sm:inline"}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-rule sm:w-8" />}
        </li>
      ))}
    </ol>
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
    const before = new Set(state.subscriptions.map((s) => s.id));
    const { record, subscriptions } = importRows(step.rows, { fileName: step.file.name, format: step.result.format, source: step.result.format.startsWith("PDF") ? "pdf" : "csv" });
    updateSettings({ onboarded: true });
    // Review the bills this statement produced (new ones first, then any it updated).
    const ids = subscriptions.filter((s) => !s.manual && s.status !== "dismissed").sort((a, b) => Number(before.has(a.id)) - Number(before.has(b.id)) || a.confidence - b.confidence).map((s) => s.id);
    setStep({ kind: "bills", record, ids });
    window.scrollTo(0, 0);
  }

  const at = step.kind === "review" ? 1 : step.kind === "bills" ? 2 : 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b rule bg-paper/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <Wordmark className="text-[20px]" />
        <Progress at={at} />
        <Link href="/" className="btn btn-quiet btn-sm" aria-label="Close upload"><Icon name="close" size={16} /><span className="hidden sm:inline">Close</span></Link>
      </header>

      {step.kind === "review" ? (
        <Review step={step} home={home} onChange={(rows) => setStep({ ...step, rows })} onCancel={() => setStep({ kind: "pick" })} onSave={save} />
      ) : step.kind === "bills" ? (
        <BillsReview record={step.record} ids={step.ids} onDone={() => router.push("/")} />
      ) : (
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:py-14">
          <section>
            <h1 className="title text-[30px] sm:text-[36px]">Upload a statement</h1>
            <p className="mt-2 max-w-lg text-[14.5px] text-ink-2">subscan reads your bank or card statement, finds subscriptions, utilities and other regular payments, and shows you what&rsquo;s committed and what&rsquo;s due next.</p>

            <div className="panel mt-6">
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
                  className={`m-2 flex flex-col items-center rounded-[6px] border border-dashed px-6 py-12 text-center transition-colors ${drag ? "border-accent bg-accent-wash" : "border-line-strong bg-paper-2/40"}`}
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface text-accent shadow-[0_0_0_1px_var(--color-rule)]">
                    <Icon name={step.kind === "reading" ? "clock" : "upload"} size={20} />
                  </span>
                  <div className="mt-3 text-[16px] font-semibold">{step.kind === "reading" ? `Reading ${step.file.name}…` : "Drop your statement here"}</div>
                  <p className="mt-1 max-w-sm text-[13px] text-muted">{step.kind === "reading" ? "Extracting transactions in your browser." : "PDF downloaded from your bank, or a CSV export. Three to twelve months works best."}</p>
                  <button className="btn btn-primary mt-5" disabled={step.kind === "reading"} onClick={() => input.current?.click()}>{step.kind === "reading" ? "Reading…" : "Choose a file"}</button>
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

          <aside className="space-y-4 lg:pt-[88px]">
            <div className="panel px-5 py-5">
              <div className="label mb-3">What happens next</div>
              <ol className="space-y-3 text-[13.5px]">
                {[
                  ["Check transactions", "See every row we read. Fix dates, amounts or direction and untick anything wrong."],
                  ["Review bills", "We list the regular payments we found with how sure we are. Confirm, correct or dismiss each one."],
                  ["Your overview", "What you're committed to each month, what's due next and where you could save."],
                ].map(([t, d], i) => (
                  <li key={t} className="grid grid-cols-[22px_1fr] gap-1">
                    <span className="num text-faint">{i + 1}.</span>
                    <span><span className="font-medium">{t}</span><span className="block text-muted">{d}</span></span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="panel px-5 py-5 text-[13px] text-ink-2">
              <div className="label mb-2">Your privacy</div>
              <ul className="space-y-1.5">
                <li>The file is read in this browser and never uploaded or kept.</li>
                <li>Saved transactions stay on this device. Delete them any time in Settings.</li>
                <li>The agent only sees structured rows, and only when you ask it something.</li>
                <li>subscan never asks for bank logins or card numbers.</li>
              </ul>
            </div>
          </aside>
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
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-4 sm:px-6 lg:px-8">
        <h1 className="title text-[28px]">Check your transactions</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          We read <span className="num text-ink">{step.rows.length}</span> rows from {step.file.name} ({step.result.format}). Correct anything that looks wrong. Nothing is saved until you continue.
        </p>
        {step.result.warnings.length > 0 && <ul className="mt-3 space-y-1 rounded-[6px] bg-amber-wash px-3 py-2 text-[13px] text-amber">{step.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ReviewTable rows={step.rows} onChange={onChange} />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-surface/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="text-[13px]">
            <span className="num font-medium">{t.count}</span> to save · out <span className="num">{t.out}</span> · in <span className="num text-accent">{t.in}</span>
            {t.from && <span className="text-muted"> · {t.from} → {t.to}</span>}
            {pending > 0 && <span className="text-amber"> · {pending} flagged rows left out</span>}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onCancel}>Back</button>
            <button className="btn btn-primary" disabled={!t.count} onClick={onSave}>Save and find bills<Icon name="arrow" size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillsReview({ record, ids, onDone }: { record: ImportRecord; ids: string[]; onDone(): void }) {
  const { state, updateSubscription, logAction } = useStore();
  const list = ids.map((id) => state.subscriptions.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const categories = [...new Set(state.subscriptions.map((s) => s.category))].sort();
  const open = list.filter((s) => s.status === "detected").length;
  const set = (id: string, name: string, status: "confirmed" | "dismissed" | "detected") => {
    updateSubscription(id, { status });
    logAction({ kind: status === "detected" ? "restored" : status, title: `${status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Dismissed" : "Restored"} ${name}`, detail: "During statement import", href: `/bills/${encodeURIComponent(id)}` });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-28 sm:px-6 lg:py-8">
      <h1 className="title text-[28px]">{list.length ? `We found ${list.length} regular payment${list.length === 1 ? "" : "s"}` : "No regular payments found"}</h1>
      <p className="mt-1 text-[13.5px] text-muted">
        {record.rows} transactions saved{record.duplicates ? `, ${record.duplicates} already imported were skipped` : ""}.{" "}
        {list.length ? "Check each one. Lower-confidence matches are listed first — correct the type or category if we got it wrong." : ""}
      </p>

      {!list.length ? (
        <div className="panel mt-6 px-6 py-8">
          <p className="max-w-lg text-[14px] text-ink-2">A bill needs at least two charges from the same payee, spaced regularly, before we treat it as recurring. This statement didn&rsquo;t have any we could be confident about.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] text-muted">
            <li>Upload more months — three or more gives the best results.</li>
            <li>Add a bill you know about yourself from the Bills page.</li>
          </ul>
          <div className="mt-5 flex gap-2">
            <button className="btn btn-primary" onClick={onDone}>Go to overview</button>
            <Link href="/bills?add=1" className="btn btn-ghost">Add a bill</Link>
          </div>
        </div>
      ) : (
        <section className="panel mt-6">
          <ul className="divide-y divide-[var(--color-rule)]">
            {list.map((s) => (
              <li key={s.id} className={`grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[1.4fr_1fr_auto] md:items-center ${s.status === "dismissed" ? "opacity-55" : ""}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={s.displayName} size={36} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{s.displayName}</span>
                      <span className="text-[13px] text-ink-2 num">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)} · {FREQ_LABEL[s.frequency].toLowerCase()}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{s.chargeCount} charges since {date(s.firstSeen)} · next around {date(s.nextRenewal)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><ConfidenceText value={s.confidence} />{s.confidence < 0.85 && s.confidenceReasons[0] && <span className="text-[12px] text-muted">· {s.confidenceReasons[0]}</span>}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" aria-label={`Type for ${s.displayName}`} value={s.kind ?? "subscription"} onChange={(e) => updateSubscription(s.id, { kind: e.target.value as ObligationKind, edited: true })}>
                    {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  <select className="input" aria-label={`Category for ${s.displayName}`} value={s.category} onChange={(e) => updateSubscription(s.id, { category: e.target.value, edited: true })}>
                    {[...new Set([s.category, ...categories, "Entertainment", "Utilities", "Telecoms", "Insurance", "Housing", "Loans", "Software", "Education", "Health", "Other"])].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex gap-1.5 md:justify-end">
                  {s.status === "detected" ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => set(s.id, s.displayName, "confirmed")}><Icon name="check" size={14} />Confirm</button>
                      <button className="btn btn-quiet btn-sm" onClick={() => set(s.id, s.displayName, "dismissed")}>Not a bill</button>
                    </>
                  ) : (
                    <>
                      <span className={`pill ${s.status === "confirmed" ? "pill-green" : ""}`}>{s.status === "confirmed" ? "Confirmed" : "Dismissed"}</span>
                      <button className="btn btn-quiet btn-sm" onClick={() => set(s.id, s.displayName, "detected")}>Undo</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-muted">{open ? `${open} still to review — you can also do this later from Bills.` : "All reviewed."}</span>
            <div className="flex gap-2">
              {open > 0 && <button className="btn btn-ghost" onClick={() => list.filter((s) => s.status === "detected" && s.confidence >= 0.85).forEach((s) => set(s.id, s.displayName, "confirmed"))}>Confirm high-confidence</button>}
              <button className="btn btn-primary" onClick={onDone}>See my overview<Icon name="arrow" size={15} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
