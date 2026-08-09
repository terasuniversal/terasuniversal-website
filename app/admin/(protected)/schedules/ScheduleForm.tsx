"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ScheduleFormState } from "./actions";
import { Field } from "../../../../components/admin/ui";

interface Option { id: string; label: string }

const MODES = ["Public", "In-house", "Onsite", "Online", "Hybrid"];
const STATUSES = ["open", "full", "in_progress", "completed", "cancelled"];

export function ScheduleForm({
  action,
  schedule,
  courses,
  defaultTrainingMode,
  mode,
}: {
  action: (prev: ScheduleFormState, fd: FormData) => Promise<ScheduleFormState>;
  schedule?: any;
  courses: Option[];
  defaultTrainingMode?: string;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = schedule ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 780 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <Field label="Course *" name="course_id" error={e.course_id}>
        <select id="course_id" name="course_id" defaultValue={d.course_id ?? ""} required>
          <option value="">— Select —</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>

      <div className="ta-field-row">
        <Field label="Trainer name" name="trainer_name" hint="Free text until Trainers is normalized" error={e.trainer_name}>
          <input id="trainer_name" name="trainer_name" defaultValue={d.trainer_name ?? ""} />
        </Field>
        <Field label="Venue" name="venue" error={e.venue}>
          <input id="venue" name="venue" defaultValue={d.venue ?? ""} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Training mode" name="training_mode" error={e.training_mode}>
          <select id="training_mode" name="training_mode" defaultValue={d.training_mode ?? defaultTrainingMode ?? ""}>
            <option value="">—</option>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Capacity" name="capacity" error={e.capacity}>
          <input id="capacity" name="capacity" type="number" min="0" defaultValue={d.capacity ?? 20} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Start date *" name="start_date" error={e.start_date}>
          <input id="start_date" name="start_date" type="date" defaultValue={d.start_date ?? ""} required />
        </Field>
        <Field label="End date *" name="end_date" error={e.end_date}>
          <input id="end_date" name="end_date" type="date" defaultValue={d.end_date ?? ""} required />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Start time" name="start_time">
          <input id="start_time" name="start_time" type="time" defaultValue={d.start_time ?? ""} />
        </Field>
        <Field label="End time" name="end_time">
          <input id="end_time" name="end_time" type="time" defaultValue={d.end_time ?? ""} />
        </Field>
      </div>

      <Field label="Status" name="status">
        <select id="status" name="status" defaultValue={d.status ?? "open"}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </Field>

      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 16px" }}>
        <input type="checkbox" name="is_published" defaultChecked={d.is_published ?? true} />
        Published (visible/bookable)
      </label>

      <Field label="Notes" name="notes" error={e.notes}>
        <textarea id="notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
      </Field>

      <div className="ta-form-actions">
        <Link href="/admin/schedules" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create schedule"}
        </button>
      </div>
    </form>
  );
}
