"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { TaskFormState } from "./actions";
import { Field } from "../../../../../components/admin/ui";

const PRIORITIES = ["low", "medium", "high"] as const;

export function TaskForm({
  action,
  task,
  staff,
  mode,
  linkContext,
}: {
  action: (prev: TaskFormState, fd: FormData) => Promise<TaskFormState>;
  task?: any;
  staff: { id: string; full_name: string }[];
  mode: "create" | "edit";
  /** Present only when opened from a Lead/Opportunity/Quotation's "+ Add Task" link. */
  linkContext?: { label: string; leadId?: string; opportunityId?: string; quotationId?: string };
}) {
  const [state, formAction, pending] = useActionState<TaskFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = task ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 720 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      {linkContext && (
        <div className="ta-alert ta-alert-info" style={{ marginBottom: 16 }}>
          Linked to {linkContext.label}.
        </div>
      )}
      {/* Relations are set only at creation (via linkContext) or already present on the row being edited — this form never offers a picker (Task 9/11: keep it small), so existing links are preserved as hidden fields rather than silently dropped on save. */}
      <input type="hidden" name="lead_metadata_id" value={linkContext?.leadId ?? d.lead_metadata_id ?? ""} />
      <input type="hidden" name="opportunity_id" value={linkContext?.opportunityId ?? d.opportunity_id ?? ""} />
      <input type="hidden" name="quotation_id" value={linkContext?.quotationId ?? d.quotation_id ?? ""} />

      <Field label="Title *" name="title" error={e.title}>
        <input id="title" name="title" defaultValue={d.title ?? ""} required maxLength={200} />
      </Field>

      <Field label="Description" name="description" error={e.description}>
        <textarea id="description" name="description" rows={3} defaultValue={d.description ?? ""} />
      </Field>

      <div className="ta-field-row">
        <Field label="Priority" name="priority" error={e.priority}>
          <select id="priority" name="priority" defaultValue={d.priority ?? "medium"}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date & time" name="due_at" error={e.due_at}>
          <input id="due_at" name="due_at" type="datetime-local" defaultValue={d.due_at ? d.due_at.slice(0, 16) : ""} />
        </Field>
      </div>

      <Field label="Assigned to" name="assigned_to" error={e.assigned_to}>
        <select id="assigned_to" name="assigned_to" defaultValue={d.assigned_to ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </Field>

      <div className="ta-form-actions">
        <Link href="/admin/sales/tasks" className="ta-btn ta-btn-outline">
          Cancel
        </Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create task"}
        </button>
      </div>
    </form>
  );
}
