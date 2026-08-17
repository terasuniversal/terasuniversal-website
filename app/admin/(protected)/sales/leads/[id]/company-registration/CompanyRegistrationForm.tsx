"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { CompanyRegState } from "./actions";
import { registerCompanyFromLead } from "./actions";
import { Field } from "../../../../../../../components/admin/ui";
import type { EligibleScheduleOption } from "../../registration-schedules";

interface CompanyOption { id: string; label: string }
interface Row { key: number; full_name: string; ic_passport_no: string; email: string; phone: string }

export function CompanyRegistrationForm({
  leadMetadataId,
  lead,
  schedules,
  companies,
}: {
  leadMetadataId: string;
  lead: { company: string; name: string };
  schedules: EligibleScheduleOption[];
  companies: CompanyOption[];
}) {
  const [state, formAction, pending] = useActionState<CompanyRegState, FormData>(
    registerCompanyFromLead.bind(null, leadMetadataId),
    {}
  );
  const [rows, setRows] = useState<Row[]>([{ key: 1, full_name: "", ic_passport_no: "", email: "", phone: "" }]);
  const e = state.errors ?? {};
  const result = state.result;

  function addRow() {
    setRows((r) => [...r, { key: Math.max(0, ...r.map((x) => x.key)) + 1, full_name: "", ic_passport_no: "", email: "", phone: "" }]);
  }
  function removeRow(key: number) {
    setRows((r) => r.filter((x) => x.key !== key));
  }

  if (result) {
    return (
      <div className="ta-stack">
        <div className="ta-alert ta-alert-success">
          <strong>Company Registration Completed</strong>
        </div>
        <dl className="ta-kv" style={{ maxWidth: 480 }}>
          <dt>Company</dt>
          <dd>{result.company_name ?? "—"}</dd>
          <dt>Schedule</dt>
          <dd>{result.schedule_label}</dd>
          <dt>Enrolled</dt>
          <dd>{result.enrolled_count} participant(s)</dd>
        </dl>
        {result.already_enrolled_count > 0 && (
          <p style={{ color: "var(--ta-muted)", fontSize: 13, margin: 0 }}>
            {result.already_enrolled_count} participant(s) were already enrolled in this schedule — no duplicates created.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <Link href={`/admin/schedules/${result.schedule_id}`} className="ta-btn ta-btn-outline">View Schedule</Link>
          <Link href={`/admin/sales/leads/${leadMetadataId}`} className="ta-btn ta-btn-primary">Back to Lead</Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="ta-form">
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <h4 className="ta-subhead">Company</h4>
      <div className="ta-field-row">
        <Field label="Linked company (master record)" name="company_id" error={e.company_id} hint="Optional — reuse an existing company">
          <select id="company_id" name="company_id" defaultValue="">
            <option value="">— Select existing company —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Company name" name="company_name" error={e.company_name} hint={lead.company ? `Lead suggests: ${lead.company}` : undefined}>
          <input id="company_name" name="company_name" defaultValue={lead.company} />
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

      <h4 className="ta-subhead" style={{ marginTop: 18 }}>Participants</h4>
      {rows.map((row, idx) => (
        <div key={row.key} style={{ border: "1px solid var(--ta-line)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div className="ta-field-row">
            <Field label="Full name" name="participant_full_name" required>
              <input id={`participant_full_name_${row.key}`} name="participant_full_name" defaultValue={row.full_name} required />
            </Field>
            <Field label="IC / Passport" name="participant_ic_passport_no">
              <input id={`participant_ic_${row.key}`} name="participant_ic_passport_no" defaultValue={row.ic_passport_no} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Email" name="participant_email">
              <input id={`participant_email_${row.key}`} name="participant_email" type="email" defaultValue={row.email} />
            </Field>
            <Field label="Phone" name="participant_phone">
              <input id={`participant_phone_${row.key}`} name="participant_phone" defaultValue={row.phone} />
            </Field>
          </div>
          {rows.length > 1 && (
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => removeRow(row.key)}>
              Remove participant
            </button>
          )}
        </div>
      ))}
      <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={addRow}>
        + Add participant
      </button>

      <div className="ta-form-actions">
        <Link href={`/admin/sales/leads/${leadMetadataId}`} className="ta-btn ta-btn-outline">Cancel</Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending || schedules.length === 0}>
          {pending ? "Registering…" : "Register Participants"}
        </button>
      </div>
      <input type="hidden" name="row_count" value={rows.length} />
    </form>
  );
}
