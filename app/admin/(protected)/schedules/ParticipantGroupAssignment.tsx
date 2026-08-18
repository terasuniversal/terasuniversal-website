"use client";

import { useActionState } from "react";
import { assignParticipantGroup, type GroupFormState } from "./actions";

interface GroupOption { id: string; name: string }

/** Inline per-participant group picker on the schedule detail page's
 *  Enrolled Participants table. Submitting re-runs assignParticipantGroup,
 *  which only ever updates this participant's existing schedule_participants
 *  row (never creates a new one). */
export function ParticipantGroupAssignment({
  scheduleId,
  assignmentId,
  groups,
  currentGroupId,
}: {
  scheduleId: string;
  assignmentId: string;
  groups: GroupOption[];
  currentGroupId: string | null;
}) {
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(
    assignParticipantGroup.bind(null, scheduleId, assignmentId),
    {}
  );

  if (groups.length === 0) return <span style={{ color: "var(--ta-muted)", fontSize: 12 }}>—</span>;

  return (
    <form action={formAction} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <select
        name="schedule_group_id"
        defaultValue={currentGroupId ?? ""}
        className="ta-select ta-select-sm"
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Group"
      >
        <option value="">Ungrouped</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {state.message && <span style={{ color: "var(--ta-danger, #c0392b)", fontSize: 11 }}>{state.message}</span>}
    </form>
  );
}
