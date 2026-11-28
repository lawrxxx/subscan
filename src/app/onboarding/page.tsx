"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { ImportResults, Organising } from "@/components/import-results";
import { Icon } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { extractStatement } from "@/lib/import";
import { markDuplicates, flagInFileRepeats } from "@/lib/import/normalise";
import { takePendingUpload } from "@/lib/import/pending";
import { PdfPasswordError } from "@/lib/import/pdf";
import type { ColumnMapping, ExtractResult, ExtractedRow } from "@/lib/import/types";

type Step =
  | { kind: "pick" }
  | { kind: "reading"; file: File; phase: number }
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

const STEPS = ["Add statement", "Organise", "Review results"];

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
    const phase = (n: number) => setStep({ kind: "reading", file, phase: n });
    const tick = () => new Promise((r) => setTimeout(r, 250));
    phase(0);
    try {
      const result = await extractStatement(file, { homeCurrency: home, ...opts });
      phase(1);
      await tick();
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
      phase(2);
      await tick();
      phase(3);
      await tick();
      setStep({ kind: "review", file, result, rows });
      window.scrollTo(0, 0);
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

  const at = step.kind === "review" ? 2 : step.kind === "reading" ? 1 : 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b rule bg-paper/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <Wordmark className="text-[20px]" />
        <Progress at={at} />
        <Link href="/" className="btn btn-quiet btn-sm" aria-label="Close upload"><Icon name="close" size={16} /><span className="hidden sm:inline">Close</span></Link>
      </header>

      {step.kind === "review" ? (
        <ImportResults fileName={step.file.name} rows={step.rows} home={home} existing={state.transactions} onChange={(rows) => setStep({ ...step, rows })} onCancel={() => setStep({ kind: "pick" })} onImport={save} />
      ) : step.kind === "reading" ? (
        <Organising fileName={step.file.name} phase={step.phase} />
      ) : (
        <div className="mx-auto max-w-[640px] space-y-5 px-4 py-8 sm:px-6 lg:py-12">
          <section>
            <h1 className="title text-[24px] sm:text-[26px]">upload your statement</h1>
            <p className="mt-1 text-[14px] text-ink-2">We&rsquo;ll sort your transactions for you and only ask about anything that&rsquo;s unclear. Nothing is saved until you say so.</p>

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
                  className={`m-2 flex flex-col items-center rounded-[12px] border border-dashed px-5 py-8 text-center transition-colors ${drag ? "border-accent bg-accent-wash" : "border-line-strong bg-paper"}`}
                >
                  <span className="tile mb-3 h-11 w-11 bg-sage"><Icon name="upload" size={20} /></span>
                  <div className="text-[15px] font-semibold">Drop your statement here</div>
                  <p className="mt-1 max-w-sm text-[13px] text-muted">The PDF or CSV you download from your bank. Three months or more works best.</p>
                  <button className="btn btn-primary mt-4 w-full sm:w-auto" onClick={() => input.current?.click()}>Choose a file</button>
                  <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Statement file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
                  {error && <p role="alert" className="mt-4 max-w-md rounded-[12px] bg-alert-wash px-3 py-2 text-[13px] text-alert">{error}</p>}
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
