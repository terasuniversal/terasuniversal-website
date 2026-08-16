"use client";

import { useActionState } from "react";
import type { StaffActionState } from "./actions";

export function ToggleStaffActiveForm({
  userId,
  isActive,
  action,
}: {
  userId: string;
  isActive: boolean;
  action: (prev: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {} as StaffActionState);
  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="user_id" value={userId} readOnly />
      <input type="hidden" name="active" value={String(!isActive)} readOnly />
      <button
        type="submit"
        className="ta-btn ta-btn-outline ta-btn-sm"
        disabled={pending}
        style={isActive ? { color: "#b3261e", borderColor: "rgba(179,38,30,.4)" } : { color: "#146c43", borderColor: "rgba(20,108,67,.4)" }}
      >
        {pending ? "…" : isActive ? "Deactivate" : "Activate"}
      </button>
      {state?.message && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ta-muted)" }}>{state.message}</span>}
    </form>
  );
}
