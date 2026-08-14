"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ScheduleFormState } from "./actions";
import { Field, Card } from "../../../../components/admin/ui";

interface Option { id: string; label: string }

const MODES = ["Public", "In-house", "Onsite", "Online", "Hybrid"];
const STATUSES = ["open", "full", "in_progress", "completed", "cancelled"];

export function ScheduleForm({
  action,
  schedule,
  courses,
  defaultTrainingMode,
  mode,
  handoff,
}: {
  action: (prev: ScheduleFormState, fd: FormData) => Promise<ScheduleFormState>;
  schedule?: any;
  courses: Option[];
  defaultTrainingMode?: string;
  mode: "create" | "edit";
  /** Sales CRM Phase 3 — present only when opened via a Won Opportunity's "Create Training Schedule" action. */
  handoff?: { opportunityId: string; quotationId?: string; opportunityNo?: string; quotationNo?: string };
}) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = schedule ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      {state.warnings && state.warnings.length > 0 && (
        <div className="ta-alert ta-alert-info" role="status" style={{ marginBottom: 16 }}>
          <strong>Schedule conflict warning</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {state.warnings.map((warning, index) => <li key={`${warning.type}-${index}`}>{warning.message}</li>)}
          </ul>
          <div style={{ marginTop: 8 }}>You may save this schedule if the assignment is intentional.</div>
        </div>
      )}
      <input type="hidden" name="conflict_token" value={state.conflictToken ?? ""} />

      {handoff && (
        <div className="ta-alert ta-alert-info" style={{ marginBottom: 16 }}>
          Creating from Won Opportunity {handoff.opportunityNo ?? handoff.opportunityId}
          {handoff.quotationNo ? ` — ${handoff.quotationNo}` : ""}. Review every field below before saving —
          nothing here has been published or confirmed automatically.
          <input type="hidden" name="source_opportunity_id" value={handoff.opportunityId} />
          {handoff.quotationId && <input type="hidden" name="source_quotation_id" value={handoff.quotationId} />}
        </div>
      )}

      <Card title="Course & trainer">
        <div className="ta-form-pad">
          <Field label="Course" name="course_id" error={e.course_id} required>
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
        </div>
      </Card>

      <Card title="Dates & times">
        <div className="ta-form-pad">
          <div className="ta-field-row">
            <Field label="Start date" name="start_date" error={e.start_date} required>
              <input id="start_date" name="start_date" type="date" defaultValue={d.start_date ?? ""} required />
            </Field>
            <Field label="End date" name="end_date" error={e.end_date} required>
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
          <Field label="Exam date" name="exam_date" hint="Optional. Admin can add or update this later." error={e.exam_date}>
            <input id="exam_date" name="exam_date" type="date" defaultValue={d.exam_date ?? ""} />
          </Field>
        </div>
      </Card>

      <Card title="Publication">
        <div className="ta-form-pad">
          <Field label="Status" name="status">
            <select id="status" name="status" defaultValue={d.status ?? "open"}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </Field>
          <label className="ta-check">
            <input type="checkbox" name="is_published" defaultChecked={d.is_published ?? !handoff} />
            Published (visible/bookable){handoff && !d.is_published ? " — left unpublished; publish once details are confirmed" : ""}
          </label>
        </div>
      </Card>

      <Card title="Notes">
        <div className="ta-form-pad">
          <Field label="Notes" name="notes" error={e.notes}>
            <textarea id="notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
          </Field>
        </div>
      </Card>

      <div className="ta-form-actions">
        <Link href="/admin/schedules" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : state.conflictToken ? "Save anyway" : mode === "edit" ? "Save changes" : "Create schedule"}
        </button>
      </div>
    </form>
  );
}
