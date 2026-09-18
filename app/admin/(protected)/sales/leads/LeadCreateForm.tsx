"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Card } from "../../../../../components/admin/ui";
import { createLead, type SalesActionState } from "./actions";

const INITIAL: SalesActionState = {};

const SOURCE_OPTIONS = [
  ["", "Manual / Direct CRM Entry"],
  ["website", "Website"],
  ["whatsapp", "WhatsApp"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["referral", "Referral"],
  ["other", "Other"],
] as const;

export function LeadCreateForm({ campaigns }: { campaigns: { id: string; name: string; status: string }[] }) {
  const [state, formAction, pending] = useActionState(createLead, INITIAL);
  const errors = state.errors ?? {};

  return (
    <Card title="Lead details">
      <form action={formAction} className="ta-form-pad" style={{ maxWidth: 900 }}>
        {state.message && <div className="ta-alert ta-alert-error" role="alert">{state.message}</div>}
        <div className="ta-field-row">
          <Field label="Contact / Lead name" name="contact_name" error={errors.contact_name} required>
            <input id="contact_name" name="contact_name" required maxLength={120} />
          </Field>
          <Field label="Company" name="company_name" error={errors.company_name}>
            <input id="company_name" name="company_name" maxLength={160} />
          </Field>
        </div>
        <div className="ta-field-row">
          <Field label="Email" name="email" error={errors.email} hint="Email or phone is required.">
            <input id="email" name="email" type="email" maxLength={254} />
          </Field>
          <Field label="Phone" name="phone" error={errors.phone}>
            <input id="phone" name="phone" maxLength={40} />
          </Field>
        </div>
        <div className="ta-field-row">
          <Field label="Source channel" name="source_channel" error={errors.source_channel} hint="Manual / Direct CRM Entry is the default internal source.">
            <select id="source_channel" name="source_channel" defaultValue="">
              {SOURCE_OPTIONS.map(([value, label]) => <option key={value || "manual"} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Campaign / Programme" name="campaign_id" error={errors.campaign_id} hint="Optional existing campaign.">
            <select id="campaign_id" name="campaign_id" defaultValue="">
              <option value="">No campaign</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Course / Interest" name="course_interest" error={errors.course_interest}>
          <input id="course_interest" name="course_interest" placeholder="e.g. Basic Scaffolding Erector" maxLength={160} />
        </Field>
        <Field label="Notes" name="notes" error={errors.notes}>
          <textarea id="notes" name="notes" rows={7} maxLength={3000} placeholder="Add context, programme, or follow-up notes." />
        </Field>
        <Field label="Attribution notes" name="attribution_notes" error={errors.attribution_notes} hint="Optional note for the selected external channel.">
          <textarea id="attribution_notes" name="attribution_notes" rows={3} maxLength={3000} />
        </Field>
        <div className="ta-form-actions">
          <Link href="/admin/sales/leads" className="ta-btn ta-btn-outline">Cancel</Link>
          <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
            {pending ? "Creating…" : "Create Lead"}
          </button>
        </div>
      </form>
    </Card>
  );
}
