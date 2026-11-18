"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { correctParticipantName, type ParticipantNameCorrectionState } from "../actions";

const INITIAL: ParticipantNameCorrectionState = {};

/**
 * Admin-only full-name correction. Only the name is submitted; the current name
 * travels as expected_full_name so a concurrent change is rejected, not overwritten.
 */
export function NameCorrectionCard({ participantId, currentFullName }: { participantId: string; currentFullName: string }) {
  const [state, action, pending] = useActionState(correctParticipantName.bind(null, participantId), INITIAL);

  return (
    <Card title="Correct Full Name">
      <form action={action} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="ta-alert ta-alert-info" role="note">
          Changes the participant&apos;s full name only. Certificates already issued keep the name they were issued with; replace them separately if the name on a certificate must change.
        </div>
        {state.saved && !state.message && <div className="ta-alert ta-alert-success" role="status">Full name corrected.</div>}
        {state.message && <div className="ta-alert ta-alert-error" role="alert">{state.message}</div>}
        <input type="hidden" name="expected_full_name" value={currentFullName} />
        <Field label="Correct full name" name="full_name" error={state.errors?.full_name} required>
          <input id="correct_full_name" name="full_name" defaultValue={currentFullName} required minLength={2} maxLength={160} autoComplete="off" />
        </Field>
        {state.errors?.expected_full_name && <div className="ta-alert ta-alert-error" role="status">Reload the page and try again.</div>}
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending} style={{ alignSelf: "flex-start", minHeight: 44 }}>
          {pending ? "Saving…" : "Save full name"}
        </button>
      </form>
    </Card>
  );
}
