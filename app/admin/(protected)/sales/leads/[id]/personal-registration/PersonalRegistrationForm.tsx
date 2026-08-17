"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { PersonalRegState } from "./actions";
import { registerPersonalFromLead } from "./actions";
import { Field } from "../../../../../../../components/admin/ui";
import type { EligibleScheduleOption } from "../../registration-schedules";

export function PersonalRegistrationForm({
  leadMetadataId,
  lead,
  schedules,
}: {
  leadMetadataId: string;
  lead: { name: string; email: string; phone: string; company: string };
  schedules: EligibleScheduleOption[];
}) {
  const [state, formAction, pending] = useActionState<PersonalRegState, FormData>(
    registerPersonalFromLead.bind(null, leadMetadataId),
    {}
  );
  const e = state.errors ?? {};
  const result = state.result;

  if (result) {
    return (
      <div className="ta-stack">
        <div className="ta-alert ta-alert-success">
          <strong>Personal Registration Completed</strong>
        </div>
        <dl className="ta-kv" style={{ maxWidth: 480 }}>
          <dt>Participant</dt>
          <dd>{result.participant_name}</dd>
          <dt>Schedule</dt>
          <dd>{result.schedule_label}</dd>
        </dl>
        {result.already_enrolled && (
          <p style={{ color: "var(--ta-muted)", fontSize: 13, margin: 0 }}>
            This participant was already enrolled in this schedule — no duplicate was created.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <Link href={`/admin/participants/${result.participant_id}`} className="ta-btn ta-btn-outline">View Participant</Link>
          <Link href={`/admin/schedules/${result.schedule_id}`} className="ta-btn ta-btn-outline">View Schedule</Link>
          <Link href={`/admin/sales/leads/${leadMetadataId}`} className="ta-btn ta-btn-primary">Back to Lead</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="ta-form">
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <h4 className="ta-subhead">Lead</h4>
      <dl className="ta-kv" style={{ marginBottom: 16 }}>
        <dt>Name</dt><dd>{lead.name || "—"}</dd>
        <dt>Email</dt><dd>{lead.email || "—"}</dd>
        <dt>Phone</dt><dd>{lead.phone || "—"}</dd>
      </dl>

      <Field label="Full name" name="full_name" error={e.full_name} required>
        <input id="full_name" name="full_name" defaultValue={lead.name} required />
      </Field>
      <div className="ta-field-row">
        <Field label="IC / Passport" name="ic_passport_no" error={e.ic_passport_no} hint="Used to match an existing participant">
          <input id="ic_passport_no" name="ic_passport_no" defaultValue="" />
        </Field>
        <Field label="Phone" name="phone" error={e.phone}>
          <input id="phone" name="phone" defaultValue={lead.phone} />
        </Field>
      </div>
      <div className="ta-field-row">
        <Field label="Email" name="email" error={e.email}>
          <input id="email" name="email" type="email" defaultValue={lead.email} />
        </Field>
        <Field label="Company" name="company" error={e.company}>
          <input id="company" name="company" defaultValue={lead.company} />
        </Field>
      </div>

      <Field label="Training schedule" name="schedule_id" error={e.schedule_id} required>
        <select id="schedule_id" name="schedule_id" required defaultValue="">
          <option value="" disabled>— Select an eligible schedule —</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.start_date}–{s.end_date} · {s.venue || "No venue"} · {s.used}/{s.capacity} used ({s.remaining} remaining)
            </option>
          ))}
        </select>
      </Field>
      {schedules.length === 0 && (
        <p style={{ color: "var(--ta-muted)", fontSize: 13, margin: "4px 0 0" }}>
          No eligible open schedules are available right now.
        </p>
      )}

      <div className="ta-form-actions">
        <Link href={`/admin/sales/leads/${leadMetadataId}`} className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending || schedules.length === 0}>
          {pending ? "Registering…" : "Register Participant"}
        </button>
      </div>
    </form>
  );
}
