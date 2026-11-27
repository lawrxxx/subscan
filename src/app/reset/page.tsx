"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthFrame, FieldError } from "@/components/auth-frame";
import { browserSupabase } from "@/lib/supabase/browser";
import { validEmail } from "@/lib/supabase/validate";

export default function Reset() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validEmail(email)) return setErr("Enter a valid email address.");
    const sb = browserSupabase();
    if (!sb) return setErr("Accounts are not enabled on this deployment.");
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/reset/update` });
    setBusy(false);
    if (error) return setErr(error.message);
    setSent(true);
  }
  return (
    <AuthFrame kicker="Reset password" title="Forgot your password?">
      {sent ? (
        <div className="border-l-2 border-accent pl-4 text-[14px]">If an account exists for {email}, a reset link is on its way.</div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <label className="block text-[12px] text-muted">Email
            <input type="email" autoComplete="email" className="field mt-1 text-[15px] text-ink" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FieldError>{err}</FieldError>
          </label>
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <Link href="/login" className="block text-[13px] text-muted link">Back to sign in</Link>
        </form>
      )}
    </AuthFrame>
  );
}
