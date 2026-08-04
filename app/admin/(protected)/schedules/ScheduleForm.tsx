"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ScheduleFormState } from "./actions";
import { Field } from "../../../../components/admin/ui";

interface Option { id: string; label: string }

const MODES = ["Public", "In-house", "Onsite", "Online", "Hybrid"];

export function ScheduleForm({
  action,
  schedule,
  courses,
  trainers = [],
  defaultTrainingMode,
  mode,
}: {
  action: (prev: ScheduleFormState, fd: FormData) => Promise<ScheduleFormState>;
  schedule?: any;
  courses: Option[];
  trainers?: { id: string; label: string; name: string }[];
  defaultTrainingMode?: string;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = schedule ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 780 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <div className="ta-field-row">
        <Field label="Course" name="course_id" hint="Picks the name below; you can still edit it">
          <select
            id="course_id"
            name="course_id"
            defaultValue={d.course_id ?? ""}
            onChange={(ev) => {
              const opt = courses.find((c) => c.id === ev.target.value);
              const nameInput = document.getElementById("course_name") as HTMLInputElement | null;
              if (opt && nameInput && !nameInput.value) nameInput.value = opt.label;
            }}
          >
            <option value="">— Select —</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Course name *" name="course_name" error={e.course_name}>
          <input id="course_name" name="course_name" defaultValue={d.course_name ?? ""} required />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Trainer" name="trainer_id" hint="Select a registered trainer, or type a name below">
          <select
            id="trainer_id"
            name="trainer_id"
            defaultValue={d.trainer_id ?? ""}
            onChange={(ev) => {
              const opt = trainers.find((t) => t.id === ev.target.value);
              const txt = document.getElementById("trainer") as HTMLInputElement | null;
              if (opt && txt) txt.value = opt.name;
            }}
          >
            <option value="">— Select trainer —</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Trainer name" name="trainer">
          <input id="trainer" name="trainer" defaultValue={d.trainer ?? ""} />
        </Field>
      </div>
      <Field label="Venue" name="venue">
        <input id="venue" name="venue" defaultValue={d.venue ?? ""} />
      </Field>

      <div className="ta-field-row">
        <Field label="Training mode" name="training_mode">
          <select id="training_mode" name="training_mode" defaultValue={d.training_mode ?? defaultTrainingMode ?? ""}>
            <option value="">—</option>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Max participants" name="max_participants">
          <input id="max_participants" name="max_participants" type="number" min="0" defaultValue={d.max_participants ?? 20} />
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
        <select id="status" name="status" defaultValue={d.status ?? "draft"}>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="full">Full</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="archived">Archived</option>
        </select>
      </Field>

      <Field label="Remarks" name="remarks">
        <textarea id="remarks" name="remarks" rows={3} defaultValue={d.remarks ?? ""} />
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
