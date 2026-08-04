"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const banner = params.get("error");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetting, setResetting] = useState(false);

  async function requestReset() {
    if (!resetEmail.trim()) { setResetMessage("Enter your admin email first."); return; }
    setResetting(true);
    setResetMessage("");
    try {
      const response = await fetch("/api/admin/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: resetEmail }) });
      const body = await response.json();
      setResetMessage(body.message || body.error || "Unable to request a password reset.");
    } catch { setResetMessage("Network error. Please try again."); }
    finally { setResetting(false); }
  }

  return (
    <div className="ta-login">
      <div className="ta-login-card">
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <h1>Admin Sign In</h1>
        <p className="sub">Manage your website content securely.</p>

        {banner === "inactive" && (
          <div className="ta-alert ta-alert-error" style={{ marginBottom: 14 }}>
            Your session ended because the account is inactive.
          </div>
        )}
        {state.error && (
          <div className="ta-alert ta-alert-error" style={{ marginBottom: 14 }}>
            {state.error}
          </div>
        )}

        <form action={formAction} className="ta-form">
          <input type="hidden" name="next" value={next} />
          <div className="ta-field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="ta-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="ta-btn ta-btn-primary" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
            {pending ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div style={{ marginTop: 18, borderTop: "1px solid var(--ta-line)", paddingTop: 14 }}>
          <label htmlFor="reset-email" style={{ fontSize: 13, fontWeight: 600 }}>Forgot password?</label>
          <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
            <input id="reset-email" type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder="Admin email" autoComplete="email" aria-describedby="reset-message" />
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={requestReset} disabled={resetting}>{resetting ? "Sending…" : "Send link"}</button>
          </div>
          <p id="reset-message" aria-live="polite" style={{ minHeight: 18, margin: "7px 0 0", color: "var(--ta-muted)", fontSize: 12 }}>{resetMessage}</p>
        </div>
      </div>
    </div>
  );
}
