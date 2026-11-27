"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthFrame, FieldError } from "@/components/auth-frame";
import { browserSupabase } from "@/lib/supabase/browser";
import { supabaseConfigured } from "@/lib/supabase/env";
import { validEmail } from "@/lib/supabase/validate";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"password" | "link">("password");
  const [sent, setSent] = useState(false);
  const callbackError = params.get("error");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!validEmail(email)) errs.email = "Enter a valid email address.";
    if (mode === "password" && !password) errs.password = "Enter your password.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const sb = browserSupabase();
    if (!sb) return;
    setBusy(true);
    if (mode === "password") {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setErrors({ form: error.message === "Invalid login credentials" ? "That email and password don’t match an account." : error.message });
        setBusy(false);
        return;
      }
      window.location.href = next;
    } else {
      const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false } });
      setBusy(false);
      if (error) return setErrors({ form: error.message });
      setSent(true);
    }
  }

  if (!supabaseConfigured)
    return (
      <div className="space-y-4 text-[14px] text-muted">
        <p>Accounts aren&rsquo;t enabled on this deployment yet, so subscan runs in guest mode and keeps data on this device only.</p>
        <Link href="/" className="btn btn-primary">Continue as guest</Link>
      </div>
    );

  if (sent)
    return (
      <div className="border-l-2 border-accent pl-4">
        <div className="text-[15px] font-medium">Check your inbox</div>
        <p className="mt-1 text-[14px] text-muted">We sent a sign-in link to {email}. It expires in an hour.</p>
        <button className="mt-4 text-[13px] link" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {callbackError && <p className="border-l-2 border-alert pl-3 text-[13px] text-alert">That link is invalid or has expired. Sign in again.</p>}
      <label className="block text-[12px] text-muted">Email
        <input type="email" autoComplete="email" className="field mt-1 text-[15px] text-ink" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
        <FieldError>{errors.email}</FieldError>
      </label>
      {mode === "password" && (
        <label className="block text-[12px] text-muted">
          <span className="flex justify-between">Password <Link href="/reset" className="link">Forgot?</Link></span>
          <input type="password" autoComplete="current-password" className="field mt-1 text-[15px] text-ink" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
          <FieldError>{errors.password}</FieldError>
        </label>
      )}
      <FieldError>{errors.form}</FieldError>
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : mode === "password" ? "Sign in" : "Email me a sign-in link"}</button>
      <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted">
        <button type="button" className="link" onClick={() => setMode(mode === "password" ? "link" : "password")}>{mode === "password" ? "Use a sign-in link instead" : "Use a password instead"}</button>
        <span>New here? <Link href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="link text-ink">Create an account</Link></span>
      </div>
    </form>
  );
}

export default function Login() {
  return (
    <AuthFrame kicker="Sign in" title={<>Welcome <span className="italic">back.</span></>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
