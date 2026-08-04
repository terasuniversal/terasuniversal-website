"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../../../lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10) { setMessage("Use at least 10 characters for your new password."); return; }
    if (password !== confirm) { setMessage("The passwords do not match."); return; }
    setPending(true); setMessage("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    setMessage(error ? "This reset link is invalid or has expired. Request a new link." : "Password updated. You can now sign in.");
  }

  return <div className="ta-login"><div className="ta-login-card"><img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" /><h1>Set new password</h1><p className="sub">Choose a secure password for your Admin CMS account.</p>
    <form onSubmit={submit} className="ta-form"><div className="ta-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} required /></div><div className="ta-field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={10} required /></div><button className="ta-btn ta-btn-primary" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>{pending ? "Updating…" : "Update password"}</button></form>
    <p aria-live="polite" style={{ minHeight: 18, color: "var(--ta-muted)", fontSize: 13 }}>{message}</p><Link href="/admin/login" className="ta-btn ta-btn-outline ta-btn-sm">Back to sign in</Link>
  </div></div>;
}
