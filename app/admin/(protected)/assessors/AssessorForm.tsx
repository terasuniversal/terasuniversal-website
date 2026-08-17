"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AssessorFormState } from "./actions";
import { Field, Card } from "../../../../components/admin/ui";

export function AssessorForm({
  action,
  assessor,
  mode,
}: {
  action: (prev: AssessorFormState, fd: FormData) => Promise<AssessorFormState>;
  assessor?: any;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<AssessorFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = assessor ?? {};
  const status = d.is_active === undefined ? "active" : d.is_active ? "active" : "inactive";

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 760 }}>
      {(state.message || e._form) && <div className="ta-alert ta-alert-error">{state.message || e._form}</div>}

      <Card title="Assessor details">
        <div className="ta-form-pad">
          <Field label="Full name" name="full_name" error={e.full_name} required>
            <input id="full_name" name="full_name" defaultValue={d.full_name ?? ""} required />
          </Field>
          <div className="ta-field-row">
            <Field label="IC / Passport No." name="ic_passport_no" error={e.ic_passport_no}>
              <input id="ic_passport_no" name="ic_passport_no" defaultValue={d.ic_passport_no ?? ""} />
            </Field>
            <Field label="Phone" name="phone">
              <input id="phone" name="phone" defaultValue={d.phone ?? ""} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Email" name="email" error={e.email}>
              <input id="email" name="email" type="email" defaultValue={d.email ?? ""} />
            </Field>
            <Field label="Organization" name="organization">
              <input id="organization" name="organization" defaultValue={d.organization ?? ""} />
            </Field>
          </div>
          <Field label="Qualification" name="qualification">
            <input id="qualification" name="qualification" defaultValue={d.qualification ?? ""} placeholder="e.g. Registered Assessor, Certification Body…" />
          </Field>
          <Field label="Notes" name="notes">
            <textarea id="notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
          </Field>
          <Field label="Status" name="status" hint="Deactivate instead of delete — historical assignments stay intact.">
            <select id="status" name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
      </Card>

      <div className="ta-form-actions">
        <Link href="/admin/assessors" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save assessor" : "Add assessor"}
        </button>
      </div>
    </form>
  );
}
