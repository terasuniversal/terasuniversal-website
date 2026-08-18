"use client";

import { useActionState, useState } from "react";
import { createGroup, updateGroup, removeGroup, type GroupFormState } from "./actions";

interface Option { id: string; label: string }
interface Group {
  id: string;
  name: string;
  trainer_id: string | null;
  trainer_name: string | null;
  assessor_id: string | null;
  assessor_name: string | null;
  capacity: number | null;
  start_time: string | null;
  end_time: string | null;
  participant_count: number;
}

const initial: GroupFormState = {};

function GroupFields({
  group,
  trainers,
  assessors,
  scheduleAssessorName,
  errors,
}: {
  group?: Group;
  trainers: Option[];
  assessors: Option[];
  scheduleAssessorName: string | null;
  errors?: Record<string, string>;
}) {
  return (
    <>
      <div className="ta-field-row">
        <label style={{ display: "grid", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Group name</span>
          <input name="name" defaultValue={group?.name ?? ""} required maxLength={80} className="ta-input" />
          {errors?.name && <span style={{ color: "var(--ta-danger, #c0392b)", fontSize: 12 }}>{errors.name}</span>}
        </label>
        <label style={{ display: "grid", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Trainer</span>
          <select name="trainer_id" defaultValue={group?.trainer_id ?? ""} className="ta-select">
            <option value="">— None —</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {errors?.trainer_id && <span style={{ color: "var(--ta-danger, #c0392b)", fontSize: 12 }}>{errors.trainer_id}</span>}
        </label>
      </div>
      <div className="ta-field-row">
        <label style={{ display: "grid", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Assessor override</span>
          <select name="assessor_id" defaultValue={group?.assessor_id ?? ""} className="ta-select">
            <option value="">— Use class assessor{scheduleAssessorName ? ` (${scheduleAssessorName})` : ""} —</option>
            {assessors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {errors?.assessor_id && <span style={{ color: "var(--ta-danger, #c0392b)", fontSize: 12 }}>{errors.assessor_id}</span>}
        </label>
        <label style={{ display: "grid", gap: 4, width: 110 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Capacity</span>
          <input name="capacity" type="number" min={0} defaultValue={group?.capacity ?? ""} className="ta-input" />
        </label>
      </div>
      <div className="ta-field-row">
        <label style={{ display: "grid", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>Start time <span style={{ fontWeight: 400 }}>(optional — falls back to class time)</span></span>
          <input name="start_time" type="time" defaultValue={group?.start_time ?? ""} className="ta-input" />
        </label>
        <label style={{ display: "grid", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>End time</span>
          <input name="end_time" type="time" defaultValue={group?.end_time ?? ""} className="ta-input" />
        </label>
      </div>
    </>
  );
}

function GroupRow({
  scheduleId,
  group,
  trainers,
  assessors,
  scheduleAssessorName,
}: {
  scheduleId: string;
  group: Group;
  trainers: Option[];
  assessors: Option[];
  scheduleAssessorName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(updateGroup.bind(null, scheduleId, group.id), initial);

  if (!editing) {
    const hasAnyAssessor = !!(group.assessor_name ?? scheduleAssessorName);
    const effectiveAssessor = group.assessor_name ?? scheduleAssessorName ?? "Not assigned";
    return (
      <div style={{ padding: "10px 12px", border: "1px solid var(--ta-line)", borderRadius: 9, marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <strong>{group.name}</strong>
            <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>
              Trainer: {group.trainer_name ?? "— none —"} · Assessor: {effectiveAssessor}
              {hasAnyAssessor ? ` (${group.assessor_name ? "Override" : "Class Assessor"})` : ""}
              {group.start_time ? ` · ${group.start_time}–${group.end_time ?? ""}` : ""}
              {group.capacity != null ? ` · ${group.participant_count}/${group.capacity} seats` : ` · ${group.participant_count} assigned`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <form action={removeGroup.bind(null, scheduleId, group.id)}>
              <button type="submit" className="ta-btn ta-btn-danger ta-btn-sm" title="Remove group">Remove</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ padding: "10px 12px", border: "1px solid var(--ta-line)", borderRadius: 9, marginBottom: 8, display: "grid", gap: 8 }}
    >
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      <GroupFields group={group} trainers={trainers} assessors={assessors} scheduleAssessorName={scheduleAssessorName} errors={state.errors} />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Training Schedule Groups V1 panel — rendered on the schedule detail page,
 * not inside the create/edit form, because a group needs schedule_id to
 * exist first (same reason Assessor reassignment and Enroll Participants
 * are separate detail-page controls, not part of the single-submit
 * ScheduleForm).
 */
export function GroupsPanel({
  scheduleId,
  groups,
  trainers,
  assessors,
  scheduleAssessorName,
}: {
  scheduleId: string;
  groups: Group[];
  trainers: Option[];
  assessors: Option[];
  scheduleAssessorName: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(createGroup.bind(null, scheduleId), initial);

  return (
    <div>
      {groups.length === 0 && !adding && (
        <p style={{ color: "var(--ta-muted)", margin: "0 0 10px" }}>
          No groups yet — this schedule uses its trainer/venue fields directly. Add a group only if you need multiple trainers under this class.
        </p>
      )}
      {groups.map((g) => (
        <GroupRow key={g.id} scheduleId={scheduleId} group={g} trainers={trainers} assessors={assessors} scheduleAssessorName={scheduleAssessorName} />
      ))}

      {adding ? (
        <form action={formAction} style={{ padding: "10px 12px", border: "1px dashed var(--ta-line)", borderRadius: 9, display: "grid", gap: 8 }}>
          {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
          <GroupFields trainers={trainers} assessors={assessors} scheduleAssessorName={scheduleAssessorName} errors={state.errors} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending}>{pending ? "Adding…" : "Add group"}</button>
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setAdding(true)}>+ Add Group</button>
      )}
    </div>
  );
}
