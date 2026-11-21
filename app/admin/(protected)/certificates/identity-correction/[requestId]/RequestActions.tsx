"use client";

import { MutationForm, MutationSubmitButton } from "../../../../../../components/admin/MutationForm";
import { Card, Field, Textarea } from "../../../../../../components/admin/ui";
import {
  applyIdentityCorrection,
  approveIdentityCorrection,
  cancelIdentityCorrection,
  rejectIdentityCorrection,
} from "../actions";

// Four independent forms so one pending action never blocks reading the others. Apply is only offered when the
// database says it can succeed (waiting period over, not stale, controls ready, second approval present if required).
export default function RequestActions({ requestId, canApply, canApprove }: { requestId: string; canApply: boolean; canApprove: boolean }) {
  return (
    <Card title="Actions">
      {canApprove && (
        <MutationForm action={approveIdentityCorrection} pendingLabel="Approving…" idleLabel="Approve">
          <input type="hidden" name="request_id" value={requestId} />
          <MutationSubmitButton>Give second approval</MutationSubmitButton>
        </MutationForm>
      )}

      {canApply ? (
        <MutationForm action={applyIdentityCorrection} pendingLabel="Applying…" idleLabel="Apply">
          <input type="hidden" name="request_id" value={requestId} />
          <p>Applying changes the certificates, snapshots and profile in one step, or none of them if anything fails. It cannot be undone except by a new, documented correction.</p>
          <MutationSubmitButton className="ta-btn ta-btn-primary">Apply correction</MutationSubmitButton>
        </MutationForm>
      ) : (
        <p style={{ color: "var(--ta-muted)" }}>Apply becomes available once the waiting period has finished, the request is not out of date, and any required second approval is in.</p>
      )}

      <hr />
      <MutationForm action={rejectIdentityCorrection} pendingLabel="Rejecting…" idleLabel="Reject">
        <input type="hidden" name="request_id" value={requestId} />
        <Field label="Reject — the evidence or request is not acceptable" name="reject_reason" hint="At least 10 characters.">
          <Textarea name="reason" rows={2} maxLength={500} required />
        </Field>
        <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">Reject request</MutationSubmitButton>
      </MutationForm>

      <hr />
      <MutationForm action={cancelIdentityCorrection} pendingLabel="Cancelling…" idleLabel="Cancel">
        <input type="hidden" name="request_id" value={requestId} />
        <Field label="Cancel — withdraw this request" name="cancel_reason" hint="At least 10 characters.">
          <Textarea name="reason" rows={2} maxLength={500} required />
        </Field>
        <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">Cancel request</MutationSubmitButton>
      </MutationForm>
    </Card>
  );
}
