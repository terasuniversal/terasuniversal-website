"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { setLeadFollowUp, type SalesActionState } from "../leads/actions";

const INITIAL_STATE: SalesActionState = {};

function Feedback({ state, id }: { state: SalesActionState; id?: string }) {
  if (state.errors?.follow_up_at) {
    return <div id={id} className="ta-alert ta-alert-error" role="alert">{state.errors.follow_up_at}</div>;
  }
  if (!state.message) return null;
  return (
    <div id={id} className={`ta-alert ${state.status === "success" ? "ta-alert-success" : "ta-alert-error"}`} role={state.status === "success" ? "status" : "alert"} aria-live="polite">
      {state.message}
    </div>
  );
}

export function FollowUpInlineForm({ leadMetadataId, followUpAt, returnTo }: { leadMetadataId: string; followUpAt: string | null; returnTo: string }) {
  const formId = useId();
  const dateInputId = `follow-up-at-${formId}`;
  const dateErrorId = `follow-up-error-${formId}`;
  const [saveState, saveAction, savePending] = useActionState(setLeadFollowUp.bind(null, leadMetadataId), INITIAL_STATE);
  const [clearState, clearAction, clearPending] = useActionState(setLeadFollowUp.bind(null, leadMetadataId), INITIAL_STATE);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saveState.errors?.follow_up_at) dateInputRef.current?.focus();
  }, [saveState.errors?.follow_up_at]);

  return (
    <div className="ta-followup-inline">
      <form action={saveAction} aria-busy={savePending}>
        <input type="hidden" name="return_to" value={returnTo} />
        <label className="ta-sr-only" htmlFor={dateInputId}>Follow-up date and time</label>
        <input
          id={dateInputId}
          ref={dateInputRef}
          type="datetime-local"
          name="follow_up_at"
          autoComplete="off"
          defaultValue={followUpAt ? followUpAt.slice(0, 16) : ""}
          required
          aria-invalid={Boolean(saveState.errors?.follow_up_at)}
          aria-describedby={saveState.errors?.follow_up_at ? dateErrorId : undefined}
        />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={savePending || clearPending}>
          {savePending ? "Saving…" : followUpAt ? "Reschedule" : "Set Follow-Up"}
        </button>
        <Feedback state={saveState} id={dateErrorId} />
      </form>
      <form action={clearAction} aria-busy={clearPending}>
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="follow_up_at" value="" />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={clearPending || savePending}>
          {clearPending ? "Clearing…" : "Clear Follow-Up"}
        </button>
        <Feedback state={clearState} />
      </form>
    </div>
  );
}
