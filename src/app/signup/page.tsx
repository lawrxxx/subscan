"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthFrame, FieldError } from "@/components/auth-frame";
import { browserSupabase } from "@/lib/supabase/browser";
import { supabaseConfigured } from "@/lib/supabase/env";
import { passwordProblem, validEmail } from "@/lib/supabase/validate";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string | undefined> = {};
    if (name.trim().length > 80) errs.name = "Keep it under 80 characters.";
    if (!validEmail(email)) errs.email = "Enter a valid email address.";
    errs.password = passwordProblem(password);
    if (!agree) errs.agree = "Please confirm you understand how data is handled.";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const sb = browserSupabase();
    if (!sb) return;
    setBusy(true);
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setBusy(false);
    if (error) return setErrors({ form: error.message });
    if (data.session) window.location.href = "/onboarding";
    else setDone(true);
  }

  return (
    <AuthFrame kicker="Create account" title={<>Start with your <span className="italic">statement.</span></>}>
      {!supabaseConfigured ? (
        <div className="space-y-4 text-[14px] text-muted">
          <p>Accounts aren&rsquo;t enabled on this deployment yet. You can use subscan as a guest; data stays on this device.</p>
          <Link href="/" className="btn btn-primary">Continue as guest</Link>
        </div>
      ) : done ? (
        <div className="border-l-2 border-accent pl-4">
          <div className="text-[15px] font-medium">Confirm your email</div>
          <p className="mt-1 text-[14px] text-muted">We sent a confirmation link to {email}. Open it on this device to finish setting up.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <label className="block text-[12px] text-muted">Name <span className="text-faint">(optional)</span>
            <input autoComplete="name" className="field mt-1 text-[15px] text-ink" value={name} onChange={(e) => setName(e.target.value)} />
            <FieldError>{errors.name}</FieldError>
          </label>
          <label className="block text-[12px] text-muted">Email
            <input type="email" autoComplete="email" className="field mt-1 text-[15px] text-ink" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
            <FieldError>{errors.email}</FieldError>
          </label>
          <label className="block text-[12px] text-muted">Password
            <input type="password" autoComplete="new-password" className="field mt-1 text-[15px] text-ink" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
            <span className="mt-1 block text-[11px] text-faint">At least 8 characters, letters and numbers.</span>
            <FieldError>{errors.password}</FieldError>
          </label>
          <label className="flex items-start gap-3 text-[13px] text-ink-2">
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I understand subscan stores my imported transactions and detected subscriptions in my account, and that payments are only ever made from my own wallet with my approval.</span>
          </label>
          <FieldError>{errors.agree}</FieldError>
          <FieldError>{errors.form}</FieldError>
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
          <p className="text-[13px] text-muted">Already have an account? <Link href="/login" className="link text-ink">Sign in</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}
