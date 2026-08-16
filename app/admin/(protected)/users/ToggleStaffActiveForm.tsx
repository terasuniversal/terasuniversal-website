"use client";

import { useActionState } from "react";
import type { StaffActionState } from "./actions";

export function ToggleStaffActiveForm({
  userId,
  isActive,
  isLastActiveSuperAdmin = false,
  action,
}: {
  userId: string;
  isActive: boolean;
  /** True when this account is the last active Super Admin — deactivation is backend-blocked, so hide the affordance. */
  isLastActiveSuperAdmin?: boolean;
  action: (prev: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {} as StaffActionState);

  const showDeactivate = isActive && !isLastActiveSuperAdmin;
  const showActivate = !isActive;

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="user_id" value={userId} readOnly />
      <input type="hidden" name="active" value={String(!isActive)} readOnly />
      {showDeactivate ? (
        <button
          type="submit"
          className="ta-btn ta-btn-outline ta-btn-sm"
          disabled={pending}
          style={{ color: "#b3261e", borderColor: "rgba(179,38,30,.4)" }}
        >
          {pending ? "…" : "Deactivate"}
        </button>
      ) : showActivate ? (
        <button
          type="submit"
          className="ta-btn ta-btn-outline ta-btn-sm"
          disabled={pending}
          style={{ color: "#146c43", borderColor: "rgba(20,108,67,.4)" }}
        >
          {pending ? "…" : "Activate"}
        </button>
      ) : (
        <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Last active Super Admin cannot be deactivated.</span>
      )}
      {state?.message && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ta-muted)" }}>{state.message}</span>}
    </form>
  );
}
