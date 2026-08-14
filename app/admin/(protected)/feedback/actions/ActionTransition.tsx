"use client";

import { useActionState, useState } from "react";
import { transitionAction, type FeedbackActionState } from "../actions";

const INITIAL: FeedbackActionState = {};

const NEXT: Record<string, string[]> = {
  open: ["assigned"],
  assigned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["verified"],
  verified: ["closed"],
};

export function ActionTransition({ actionId, currentStatus }: { actionId: string; currentStatus: string }) {
  const [state, action, pending] = useActionState(transitionAction.bind(null, actionId), INITIAL);
  const [status, setStatus] = useState("");
  const options = NEXT[currentStatus] ?? [];

  return (
    <form action={action} className="ta-card-pad" style={{ display: "grid", gap: 8, padding: 0 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      {options.length > 0 ? (
        <>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="ta-filter-select" aria-label="Next status" required>
            <option value="" disabled>Next status…</option>
            {options.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          {status === "resolved" && (
            <div className="ta-field">
              <label htmlFor={`corrective-${actionId}`}>Corrective action taken</label>
              <textarea id={`corrective-${actionId}`} name="corrective_action" rows={2} placeholder="What was done to resolve this?" />
            </div>
          )}
          {status === "verified" && (
            <div className="ta-field">
              <label htmlFor={`verify-${actionId}`}>Verification note</label>
              <textarea id={`verify-${actionId}`} name="verification_note" rows={2} placeholder="How was the corrective action verified?" />
            </div>
          )}
          <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={pending || !status}>{pending ? "Saving…" : "Update"}</button>
          {currentStatus === "resolved" && (
            <p className="ta-fb-transition-note">Resolved actions must be verified before they can be closed.</p>
          )}
        </>
      ) : (
        <span className="ta-lead-sub">No further transitions (closed).</span>
      )}
    </form>
  );
}
