"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const REQUEST_COOLDOWN_SECONDS = 60;
const GENERIC_CODE_ERROR = "The code is invalid or has expired. Request a new code and try again.";
const CODE_FORMAT_ERROR = "Enter the full verification code from your email.";

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(params.get("email") ? REQUEST_COOLDOWN_SECONDS : 0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function resendCode() {
    const cleanEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setMessage("Enter your admin email first.");
      return;
    }
    if (cooldown > 0) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const body = await response.json();
      setMessage(body.message || body.error || "Unable to request a password reset.");
      setCooldown(REQUEST_COOLDOWN_SECONDS);
    } catch {
      setMessage("Unable to request a password reset.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanEmail = email.trim();
    const cleanToken = token.replace(/\s/g, "");
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) { setMessage("Enter your admin email first."); return; }
    if (!/^(?:\d{6}|\d{8})$/.test(cleanToken)) { setMessage(CODE_FORMAT_ERROR); return; }
    if (password.length < 10) { setMessage("Use at least 10 characters for your new password."); return; }
    if (password !== confirm) { setMessage("The passwords do not match."); return; }

    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, token: cleanToken, password }),
      });
      const body = await response.json().catch(() => ({}));
      setPending(false);
      if (!response.ok) {
        setMessage(body.error || GENERIC_CODE_ERROR);
        return;
      }
      window.location.assign("/admin/login?reset=1");
    } catch {
      setPending(false);
      setMessage("Unable to reach the password reset service. Try again shortly.");
    }
  }

  return <div className="ta-login"><div className="ta-login-card">
    <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
    <h1>Reset your password</h1>
    <p className="sub">Enter the verification code from your TERAS password reset email.</p>
    <form onSubmit={submit} className="ta-form">
      <div className="ta-field"><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <div className="ta-field"><label htmlFor="recovery-code">Recovery code</label><input id="recovery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" maxLength={8} value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 8))} required /></div>
      <div className="ta-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required /></div>
      <div className="ta-field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={10} required /></div>
      <p style={{ margin: 0, color: "var(--ta-muted)", fontSize: 12 }}>Password must contain at least 10 characters.</p>
      <button className="ta-btn ta-btn-primary" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>{pending ? "Verifying…" : "Verify code & update password"}</button>
    </form>
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
      <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={resendCode} disabled={pending || cooldown > 0}>{pending ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button>
      <Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Back to sign in</Link>
    </div>
    <p aria-live="polite" style={{ minHeight: 18, color: "var(--ta-muted)", fontSize: 13 }}>{message}</p>
  </div></div>;
}
