"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ParticipantFormState } from "./actions";
import { Field } from "../../../../components/admin/ui";

interface Option { id: string; label: string }

export function ParticipantForm({
  action,
  participant,
  schedules,
  companies = [],
  mode,
}: {
  action: (prev: ParticipantFormState, fd: FormData) => Promise<ParticipantFormState>;
  participant?: any;
  schedules: Option[];
  companies?: Option[];
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<ParticipantFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = participant ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>
      {(state.message || e._form) && <div className="ta-alert ta-alert-error">{state.message || e._form}</div>}

      <h3 style={{ fontSize: 15, margin: "4px 0" }}>Personal Details</h3>
      <div className="ta-field-row">
        <Field label="Full name *" name="full_name" error={e.full_name}>
          <input id="full_name" name="full_name" defaultValue={d.full_name ?? ""} required />
        </Field>
        <Field label="IC / Passport No. *" name="ic_passport_no" error={e.ic_passport_no}>
          <input id="ic_passport_no" name="ic_passport_no" defaultValue={d.ic_passport_no ?? ""} required />
        </Field>
      </div>
      <div className="ta-field-row">
        <Field label="Nationality" name="nationality">
          <input id="nationality" name="nationality" defaultValue={d.nationality ?? "Malaysian"} />
        </Field>
        <Field label="Gender" name="gender">
          <select id="gender" name="gender" defaultValue={d.gender ?? ""}>
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </Field>
      </div>
      <div className="ta-field-row">
        <Field label="Date of birth" name="date_of_birth" error={e.date_of_birth}>
          <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={d.date_of_birth ?? ""} />
        </Field>
        <Field label="Registration date" name="registration_date">
          <input id="registration_date" name="registration_date" type="date" defaultValue={d.registration_date ?? ""} />
        </Field>
      </div>

      <h3 style={{ fontSize: 15, margin: "12px 0 4px" }}>Employment Information</h3>
      <div className="ta-field-row">
        <Field label="Company *" name="company" error={e.company}>
          <input id="company" name="company" defaultValue={d.company ?? ""} required />
        </Field>
        <Field label="Position" name="position">
          <input id="position" name="position" defaultValue={d.position ?? ""} />
        </Field>
      </div>
      <Field label="Linked company (master record)" name="company_id" hint="Links this participant to the company database">
        <select
          id="company_id"
          name="company_id"
          defaultValue={d.company_id ?? ""}
          onChange={(ev) => {
            const opt = companies.find((c) => c.id === ev.target.value);
            const txt = document.getElementById("company") as HTMLInputElement | null;
            if (opt && txt && !txt.value) txt.value = opt.label;
          }}
        >
          <option value="">— Not linked —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>

      <h3 style={{ fontSize: 15, margin: "12px 0 4px" }}>Contact Information</h3>
      <div className="ta-field-row">
        <Field label="Phone *" name="phone" error={e.phone}>
          <input id="phone" name="phone" defaultValue={d.phone ?? ""} required />
        </Field>
        <Field label="Email" name="email" error={e.email}>
          <input id="email" name="email" type="email" defaultValue={d.email ?? ""} />
        </Field>
      </div>
      <Field label="Address" name="address">
        <textarea id="address" name="address" rows={2} defaultValue={d.address ?? ""} />
      </Field>
      <div className="ta-field-row">
        <Field label="Emergency contact name" name="emergency_contact_name">
          <input id="emergency_contact_name" name="emergency_contact_name" defaultValue={d.emergency_contact_name ?? ""} />
        </Field>
        <Field label="Emergency contact phone" name="emergency_contact_phone">
          <input id="emergency_contact_phone" name="emergency_contact_phone" defaultValue={d.emergency_contact_phone ?? ""} />
        </Field>
      </div>

      <h3 style={{ fontSize: 15, margin: "12px 0 4px" }}>Registration</h3>
      <div className="ta-field-row">
        <Field label="Course / Schedule (optional)" name="schedule_id">
          <select id="schedule_id" name="schedule_id" defaultValue={d.schedule_id ?? ""}>
            <option value="">— Not assigned —</option>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Status" name="status">
          <select id="status" name="status" defaultValue={d.status ?? "registered"}>
            <option value="registered">Registered</option>
            <option value="confirmed">Confirmed</option>
            <option value="attended">Attended</option>
            <option value="no_show">No show</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
      </div>

      <div className="ta-form-actions">
        <Link href="/admin/participants" className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add participant"}
        </button>
      </div>
    </form>
  );
}
