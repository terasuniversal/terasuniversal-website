"use client";

import { useActionState } from "react";
import { setLeadFollowUp, type SalesActionState } from "../leads/actions";

const INITIAL_STATE: SalesActionState = {};

function Feedback({ state }: { state: SalesActionState }) {
  if (state.errors?.follow_up_at) {
    return <div className="ta-alert ta-alert-error" role="alert">{state.errors.follow_up_at}</div>;
  }
  if (!state.message) return null;
  return (
    <div className={`ta-alert ${state.status === "success" ? "ta-alert-success" : "ta-alert-error"}`} role={state.status === "success" ? "status" : "alert"} aria-live="polite">
      {state.message}
    </div>
  );
}

export function FollowUpInlineForm({ leadMetadataId, followUpAt, returnTo }: { leadMetadataId: string; followUpAt: string | null; returnTo: string }) {
  const [saveState, saveAction, savePending] = useActionState(setLeadFollowUp.bind(null, leadMetadataId), INITIAL_STATE);
  const [clearState, clearAction, clearPending] = useActionState(setLeadFollowUp.bind(null, leadMetadataId), INITIAL_STATE);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={saveAction} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <input type="hidden" name="return_to" value={returnTo} />
        <input
          type="datetime-local"
          name="follow_up_at"
          defaultValue={followUpAt ? followUpAt.slice(0, 16) : ""}
          style={{ fontSize: 12, padding: "4px 6px", maxWidth: "100%", width: 170 }}
          aria-label="Follow-up date and time"
        />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title="Set / reschedule" disabled={savePending || clearPending}>
          {savePending ? "Saving…" : "Save"}
        </button>
      </form>
      <form action={clearAction}>
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="follow_up_at" value="" />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title="Clear follow-up" disabled={clearPending || savePending}>
          {clearPending ? "Clearing…" : "Clear"}
        </button>
      </form>
      <Feedback state={clearState.message || clearState.errors ? clearState : saveState} />
    </div>
  );
}
