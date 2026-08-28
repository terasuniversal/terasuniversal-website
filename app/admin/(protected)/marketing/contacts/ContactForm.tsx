"use client";

import { useActionState, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import type { ContactFormState } from "./actions";
import { Field, Input, Select, fieldA11y } from "../../../../../components/admin/ui";
import { SOURCE_LABELS, CONSENT_LABELS } from "../../../../../lib/marketing/contacts";
import { MARKETING_CONTACT_SOURCES, MARKETING_CONTACT_CONSENT_STATUSES } from "../../../../../lib/validation/schemas";
import type { MarketingContact } from "../../../../../lib/supabase/database.types";

const INITIAL: ContactFormState = {};

/**
 * Shared create/edit form (same `contact?` inference pattern CampaignForm
 * uses). Consent fields (consent_status/consent_source/consented_at) only
 * render in CREATE mode — historical consent capture at manual entry time.
 * Editing an existing contact's consent goes through the dedicated
 * ConsentPanel/updateContactConsent action on the detail page instead, not
 * this form (see actions.ts's own header comment on the split). Status is
 * never exposed here in either mode — lifecycle changes are dedicated
 * quick actions on the detail page, matching Campaign's "Edit" vs "Stage"
 * split.
 */
export function ContactForm({
  action,
  staff,
  campaigns,
  contact,
}: {
  action: (prev: ContactFormState, fd: FormData) => Promise<ContactFormState>;
  staff: { id: string; full_name: string }[];
  campaigns: { id: string; label: string }[];
  contact?: MarketingContact;
}) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(action, INITIAL);
  const [consentStatus, setConsentStatus] = useState("not_set");
  const e = state.errors ?? {};
  const utmA11y = fieldA11y("consent_source", { hasHint: false, hasError: Boolean(e.consent_source) });
  const cancelHref = contact ? `/admin/marketing/contacts/${contact.id}` : "/admin/marketing/contacts";

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 720 }}>
      {state.message && (
        <div className={`ta-alert ${state.duplicateFound ? "ta-alert-info" : "ta-alert-error"}`}>{state.message}</div>
      )}
      {state.duplicateFound && <input type="hidden" name="confirmDuplicate" value="1" />}

      <Field label="Full name" name="full_name" error={e.full_name} required>
        <Input id="full_name" name="full_name" defaultValue={contact?.full_name ?? ""} required maxLength={160} />
      </Field>

      <div className="ta-field-row">
        <Field label="Email" name="email" error={e.email} hint="At least one of email or phone is required">
          <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} />
        </Field>
        <Field label="Phone" name="phone" error={e.phone}>
          <Input id="phone" name="phone" defaultValue={contact?.phone ?? ""} maxLength={40} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Company" name="company" error={e.company}>
          <Input id="company" name="company" defaultValue={contact?.company ?? ""} maxLength={160} />
        </Field>
        <Field label="Source" name="source" error={e.source} required>
          <Select id="source" name="source" defaultValue={contact?.source ?? ""} required>
            <option value="" disabled>
              Select a source
            </option>
            {MARKETING_CONTACT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Source campaign" name="source_campaign_id" error={e.source_campaign_id}>
          <Select id="source_campaign_id" name="source_campaign_id" defaultValue={contact?.source_campaign_id ?? ""}>
            <option value="">No specific campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" name="owner_id" error={e.owner_id}>
          <Select id="owner_id" name="owner_id" defaultValue={contact?.owner_id ?? ""}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Next follow-up" name="next_follow_up_at" error={e.next_follow_up_at}>
        <Input
          id="next_follow_up_at"
          name="next_follow_up_at"
          type="datetime-local"
          defaultValue={contact?.next_follow_up_at ? contact.next_follow_up_at.slice(0, 16) : ""}
        />
      </Field>

      {!contact && (
        <>
          <Field
            label="Consent status"
            name="consent_status"
            error={e.consent_status}
            hint="Only asked at creation — record what the contact already agreed to, if known"
          >
            <Select
              id="consent_status"
              name="consent_status"
              defaultValue="not_set"
              onChange={(ev: ChangeEvent<HTMLSelectElement>) => setConsentStatus(ev.target.value)}
            >
              {MARKETING_CONTACT_CONSENT_STATUSES.map((c) => (
                <option key={c} value={c}>
                  {CONSENT_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>

          {consentStatus === "opted_in" && (
            <div className="ta-field-row">
              <Field
                label="Consent source"
                name="consent_source"
                error={e.consent_source}
                hint="e.g. newsletter form, event signup sheet"
                controlId="consent_source"
              >
                <Input
                  id="consent_source"
                  name="consent_source"
                  maxLength={120}
                  aria-describedby={utmA11y.describedBy}
                  aria-invalid={utmA11y.invalid}
                />
              </Field>
              <Field label="Consented at" name="consented_at" error={e.consented_at}>
                <Input id="consented_at" name="consented_at" type="datetime-local" />
              </Field>
            </div>
          )}
        </>
      )}

      <div className="ta-form-actions">
        <Link href={cancelHref} className="ta-btn ta-btn-outline">
          Cancel
        </Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending
            ? "Saving…"
            : state.duplicateFound
              ? contact
                ? "Save Anyway"
                : "Create Anyway"
              : contact
                ? "Save changes"
                : "Create Contact"}
        </button>
      </div>
    </form>
  );
}
