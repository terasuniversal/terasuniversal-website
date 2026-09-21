"use client";

import { lockAssessments, unlockAssessments } from "../actions";
import { MutationForm, MutationSubmitButton } from "../../../../../components/admin/MutationForm";

export function AssessmentScheduleActions({
  scheduleId,
  assessmentIds,
  isSuperAdmin,
}: {
  scheduleId: string;
  assessmentIds: string[];
  isSuperAdmin: boolean;
}) {
  return (
    <>
      <MutationForm action={lockAssessments.bind(null, scheduleId)} pendingLabel="Locking…" idleLabel="Lock all assessed">
        {assessmentIds.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
        <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">🔒 Lock all assessed</MutationSubmitButton>
      </MutationForm>
      {isSuperAdmin && (
        <MutationForm action={unlockAssessments.bind(null, scheduleId)} pendingLabel="Unlocking…" idleLabel="Unlock all">
          {assessmentIds.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">🔓 Unlock all</MutationSubmitButton>
        </MutationForm>
      )}
    </>
  );
}
