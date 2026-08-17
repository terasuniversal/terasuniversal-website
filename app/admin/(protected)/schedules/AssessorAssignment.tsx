"use client";

import { useActionState } from "react";
import { setScheduleAssessor } from "./actions";
import type { ScheduleFormState } from "./actions";

interface Option { id: string; label: string }

/** Inline primary-assessor control for the schedule detail page. Assigns,
 *  replaces or removes via the single setScheduleAssessor server action. */
export function AssessorAssignment({
  scheduleId,
  assessors,
  currentAssessorId,
}: {
  scheduleId: string;
  assessors: Option[];
  currentAssessorId: string | null;
}) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(
    setScheduleAssessor.bind(null, scheduleId),
    {}
  );

  return (
    <form action={formAction} className="ta-form">
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      <div className="ta-field-row">
        <select name="assessor_id" defaultValue={currentAssessorId ?? ""} className="ta-select" aria-label="Primary assessor">
          <option value="">— None —</option>
          {assessors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save assessor"}
        </button>
      </div>
    </form>
  );
}
