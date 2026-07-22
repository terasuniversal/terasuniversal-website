"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const banner = params.get("error");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );

  return (
    <div className="ta-login">
      <div className="ta-login-card">
        <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={220} height={140} priority sizes="220px" />
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
      </div>
    </div>
  );
}
