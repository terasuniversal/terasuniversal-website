"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { TrainerFormState } from "./actions";
import { Field, Card } from "../../../../components/admin/ui";
import { ImageUpload } from "../../../../components/admin/ImageUpload";

const EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Freelance", "Associate"];

export function TrainerForm({
  action,
  trainer,
  mode,
}: {
  action: (prev: TrainerFormState, fd: FormData) => Promise<TrainerFormState>;
  trainer?: any;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<TrainerFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = trainer ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 880 }}>
      {(state.message || e._form) && <div className="ta-alert ta-alert-error">{state.message || e._form}</div>}

      <Card title="Personal details">
        <div className="ta-form-pad">
          <div className="ta-field-row">
            <Field label="Full name" name="full_name" error={e.full_name} required>
              <input id="full_name" name="full_name" defaultValue={d.full_name ?? ""} required />
            </Field>
            <Field label="IC / Passport No." name="ic_passport_no" error={e.ic_passport_no}>
              <input id="ic_passport_no" name="ic_passport_no" defaultValue={d.ic_passport_no ?? ""} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Email" name="email" error={e.email}><input id="email" name="email" type="email" defaultValue={d.email ?? ""} /></Field>
            <Field label="Phone" name="phone"><input id="phone" name="phone" defaultValue={d.phone ?? ""} /></Field>
          </div>
        </div>
      </Card>

      <Card title="Employment details">
        <div className="ta-form-pad">
          <div className="ta-field-row">
            <Field label="Staff No." name="staff_no" error={e.staff_no}><input id="staff_no" name="staff_no" defaultValue={d.staff_no ?? ""} /></Field>
            <Field label="Position" name="position"><input id="position" name="position" defaultValue={d.position ?? ""} /></Field>
          </div>
          <div className="ta-field-row">
            <Field label="Department" name="department"><input id="department" name="department" defaultValue={d.department ?? ""} /></Field>
            <Field label="Employment type" name="employment_type">
              <select id="employment_type" name="employment_type" defaultValue={d.employment_type ?? ""}>
                <option value="">—</option>
                {EMPLOYMENT.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Status" name="status">
              <select id="status" name="status" defaultValue={d.status ?? "active"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="retired">Retired</option>
                <option value="on_leave">On Leave</option>
              </select>
            </Field>
            <Field label="Joining date" name="joining_date" error={e.joining_date}><input id="joining_date" name="joining_date" type="date" defaultValue={d.joining_date ?? ""} /></Field>
          </div>
        </div>
      </Card>

      <Card title="Competencies & qualifications">
        <div className="ta-form-pad">
          <Field label="Specialisation" name="specialisation"><input id="specialisation" name="specialisation" defaultValue={d.specialisation ?? ""} placeholder="e.g. Working at Height, Scaffolding" /></Field>
          <div className="ta-field-row">
            <Field label="Competencies" name="competencies" hint="One per line">
              <textarea id="competencies" name="competencies" rows={4} defaultValue={(d.competencies ?? []).join("\n")} />
            </Field>
            <Field label="Qualifications" name="qualifications" hint="One per line">
              <textarea id="qualifications" name="qualifications" rows={4} defaultValue={(d.qualifications ?? []).join("\n")} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Photo & signature">
        <div className="ta-form-pad">
          <div className="ta-field-row">
            <ImageUpload name="trainer_photo" label="Trainer photo" defaultUrl={d.trainer_photo ?? ""} folder="trainers/photos" />
            <ImageUpload name="signature_image" label="Signature (used on certificates)" defaultUrl={d.signature_image ?? ""} folder="trainers/signatures" />
          </div>
        </div>
      </Card>

      <div className="ta-form-actions">
        <Link href="/admin/trainers" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save trainer" : "Add trainer"}</button>
      </div>
    </form>
  );
}
