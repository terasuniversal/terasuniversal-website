"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { CompanyFormState } from "./actions";
import { Field } from "../../../../components/admin/ui";

const TYPES = ["Sdn Bhd", "Bhd", "GLC", "Government", "Enterprise", "Others"];

export function CompanyForm({
  action,
  company,
  mode,
  handoff,
}: {
  action: (prev: CompanyFormState, fd: FormData) => Promise<CompanyFormState>;
  company?: any;
  mode: "create" | "edit";
  /** Sales CRM Phase 4A — present only when opened via a Won Opportunity's "Create Company" action. */
  handoff?: { opportunityId: string; opportunityNo?: string };
}) {
  const [state, formAction, pending] = useActionState<CompanyFormState, FormData>(action, {});
  const e = state.errors ?? {};
  const d = company ?? {};

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 880 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      {handoff && (
        <div className="ta-alert ta-alert-info" style={{ marginBottom: 16 }}>
          Creating from Won Opportunity {handoff.opportunityNo ?? handoff.opportunityId}. Only known Sales details are
          pre-filled — review everything else before saving. This company will be linked back to the opportunity
          automatically.
          <input type="hidden" name="source_opportunity_id" value={handoff.opportunityId} />
        </div>
      )}

      <h3 style={{ fontSize: 15, margin: "4px 0" }}>Company Details</h3>
      <div className="ta-field-row">
        <Field label="Company name *" name="company_name" error={e.company_name}><input id="company_name" name="company_name" defaultValue={d.company_name ?? ""} required /></Field>
        <Field label="Registration No." name="registration_no" error={e.registration_no}><input id="registration_no" name="registration_no" defaultValue={d.registration_no ?? ""} /></Field>
      </div>
      <div className="ta-field-row">
        <Field label="Industry" name="industry"><input id="industry" name="industry" defaultValue={d.industry ?? ""} /></Field>
        <Field label="Company type" name="company_type">
          <select id="company_type" name="company_type" defaultValue={d.company_type ?? ""}>
            <option value="">—</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <div className="ta-field-row">
        <Field label="Status" name="status">
          <select id="status" name="status" defaultValue={d.status ?? "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="prospect">Prospect</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Website" name="website"><input id="website" name="website" defaultValue={d.website ?? ""} placeholder="https://" /></Field>
      </div>

      <h3 style={{ fontSize: 15, margin: "12px 0 4px" }}>Address</h3>
      <Field label="Address" name="address"><textarea id="address" name="address" rows={2} defaultValue={d.address ?? ""} /></Field>
      <div className="ta-field-row">
        <Field label="Postcode" name="postcode"><input id="postcode" name="postcode" defaultValue={d.postcode ?? ""} /></Field>
        <Field label="City" name="city"><input id="city" name="city" defaultValue={d.city ?? ""} /></Field>
      </div>
      <div className="ta-field-row">
        <Field label="State" name="state"><input id="state" name="state" defaultValue={d.state ?? ""} /></Field>
        <Field label="Country" name="country"><input id="country" name="country" defaultValue={d.country ?? "Malaysia"} /></Field>
      </div>
      <div className="ta-field-row">
        <Field label="Phone" name="phone"><input id="phone" name="phone" defaultValue={d.phone ?? ""} /></Field>
        <Field label="Email" name="email" error={e.email}><input id="email" name="email" type="email" defaultValue={d.email ?? ""} /></Field>
      </div>
      <Field label="Billing address" name="billing_address"><textarea id="billing_address" name="billing_address" rows={2} defaultValue={d.billing_address ?? ""} /></Field>

      <h3 style={{ fontSize: 15, margin: "12px 0 4px" }}>Person In Charge (PIC)</h3>
      <div className="ta-field-row">
        <Field label="PIC name" name="person_in_charge"><input id="person_in_charge" name="person_in_charge" defaultValue={d.person_in_charge ?? ""} /></Field>
        <Field label="PIC position" name="pic_position"><input id="pic_position" name="pic_position" defaultValue={d.pic_position ?? ""} /></Field>
      </div>
      <div className="ta-field-row">
        <Field label="PIC phone" name="pic_phone"><input id="pic_phone" name="pic_phone" defaultValue={d.pic_phone ?? ""} /></Field>
        <Field label="PIC email" name="pic_email" error={e.pic_email}><input id="pic_email" name="pic_email" type="email" defaultValue={d.pic_email ?? ""} /></Field>
      </div>

      <Field label="Remarks" name="remarks"><textarea id="remarks" name="remarks" rows={2} defaultValue={d.remarks ?? ""} /></Field>

      <div className="ta-form-actions">
        <Link href={handoff ? `/admin/sales/opportunities/${handoff.opportunityId}` : "/admin/companies"} className="ta-btn ta-btn-outline">
          Cancel
        </Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save company" : "Add company"}</button>
      </div>
    </form>
  );
}
