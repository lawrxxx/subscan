"use client";
import { useState } from "react";
import { AuthFrame, FieldError } from "@/components/auth-frame";
import { browserSupabase } from "@/lib/supabase/browser";
import { passwordProblem } from "@/lib/supabase/validate";

export default function UpdatePassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = passwordProblem(pw) ?? (pw !== pw2 ? "Passwords don’t match." : undefined);
    if (p) return setErr(p);
    const sb = browserSupabase();
    if (!sb) return;
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    window.location.href = "/";
  }
  return (
    <AuthFrame kicker="New password" title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-5">
        <label className="block text-[12px] text-muted">New password
          <input type="password" autoComplete="new-password" className="field mt-1 text-[15px] text-ink" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="block text-[12px] text-muted">Repeat password
          <input type="password" autoComplete="new-password" className="field mt-1 text-[15px] text-ink" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        <FieldError>{err}</FieldError>
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthFrame>
  );
}
