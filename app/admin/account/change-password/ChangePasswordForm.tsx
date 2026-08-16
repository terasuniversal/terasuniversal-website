"use client";

import { useActionState, useState } from "react";
import { changePassword, type ChangePasswordState } from "../actions";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePassword, {} as ChangePasswordState);
  const [show, setShow] = useState<Record<string, boolean>>({ current: false, next: false, confirm: false });

  const toggle = (key: string) => setShow((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <form action={formAction}>
      {forced && (
        <p role="status" style={{ color: "var(--ta-muted)", fontSize: 13, marginBottom: 12 }}>
          Set a new password to finish setting up your account. It will be needed from now on to sign in.
        </p>
      )}
      <div style={{ display: "grid", gap: 14 }}>
        <label className="ta-field">
          <span>Current / temporary password</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input name="current_password" type={show.current ? "text" : "password"} autoComplete="current-password" required style={{ flex: 1 }} />
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => toggle("current")}>{show.current ? "Hide" : "Show"}</button>
          </span>
        </label>
        <label className="ta-field">
          <span>New password (minimum 10 characters)</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input name="new_password" type={show.next ? "text" : "password"} autoComplete="new-password" required minLength={10} style={{ flex: 1 }} />
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => toggle("next")}>{show.next ? "Hide" : "Show"}</button>
          </span>
        </label>
        <label className="ta-field">
          <span>Confirm new password</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input name="confirm_password" type={show.confirm ? "text" : "password"} autoComplete="new-password" required style={{ flex: 1 }} />
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => toggle("confirm")}>{show.confirm ? "Hide" : "Show"}</button>
          </span>
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="submit" className="ta-btn ta-btn-gold" disabled={pending}>
          {pending ? "Updating…" : "Update password"}
        </button>
        {state?.message && <span style={{ marginLeft: 10, color: "var(--ta-muted)" }}>{state.message}</span>}
        {state?.errors &&
          Object.entries(state.errors).map(([key, value]) => (
            <span key={key} role="alert" style={{ display: "block", color: "#b3261e", fontSize: 12 }}>
              {value}
            </span>
          ))}
      </div>
    </form>
  );
}
