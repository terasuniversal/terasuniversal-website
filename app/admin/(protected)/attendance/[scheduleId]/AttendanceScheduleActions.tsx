"use client";

import { markAllPresent, resetAttendance } from "../actions";
import { MutationForm, MutationSubmitButton } from "../../../../../components/admin/MutationForm";

export function AttendanceScheduleActions({
  scheduleId,
  sessionDate,
  participantIds,
}: {
  scheduleId: string;
  sessionDate: string;
  participantIds: string[];
}) {
  return (
    <div className="ta-toolbar">
      <MutationForm
        action={markAllPresent.bind(null, scheduleId, sessionDate)}
        pendingLabel="Applying…"
        idleLabel="Mark all present"
      >
        {participantIds.map((id) => <input key={id} type="hidden" name="participant_ids" value={id} />)}
        <MutationSubmitButton className="ta-btn ta-btn-gold ta-btn-sm">✓ Mark all present ({sessionDate})</MutationSubmitButton>
      </MutationForm>
      <MutationForm
        action={resetAttendance.bind(null, scheduleId, sessionDate)}
        pendingLabel="Reverting…"
        idleLabel="Undo all for this date"
      >
        {participantIds.map((id) => <input key={id} type="hidden" name="participant_ids" value={id} />)}
        <MutationSubmitButton className="ta-btn ta-btn-outline ta-btn-sm">↩ Undo all for this date</MutationSubmitButton>
      </MutationForm>
    </div>
  );
}
