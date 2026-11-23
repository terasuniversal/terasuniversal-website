"use client";

import { useActionState } from "react";
import { setPasswordFromEmailLink, type SetPasswordState } from "./actions";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPasswordFromEmailLink, {} as SetPasswordState);
  return (
    <form action={formAction} className="ta-form">
      {state.message && <div className="ta-alert ta-alert-error" role="alert" style={{ marginBottom: 14 }}>{state.message}</div>}
      <div className="ta-field">
        <label htmlFor="new_password">Kata laluan baharu</label>
        <input id="new_password" name="new_password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        {state.errors?.new_password && <span className="ta-field-error">{state.errors.new_password}</span>}
      </div>
      <div className="ta-field">
        <label htmlFor="confirm_password">Sahkan kata laluan</label>
        <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        {state.errors?.confirm_password && <span className="ta-field-error">{state.errors.confirm_password}</span>}
      </div>
      <button className="ta-btn ta-btn-primary" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Sedang menyimpan…" : "Simpan kata laluan"}
      </button>
    </form>
  );
}
