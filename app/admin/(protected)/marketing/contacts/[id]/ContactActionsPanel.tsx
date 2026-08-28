"use client";

import { useActionState } from "react";
import { Card, Field, Input, Select, Textarea } from "../../../../../../components/admin/ui";
import { CONSENT_LABELS } from "../../../../../../lib/marketing/contacts";
import { MARKETING_CONTACT_CONSENT_STATUSES } from "../../../../../../lib/validation/schemas";
import { updateContactConsent, addContactNote, type ContactFormState } from "../actions";
import type { MarketingContactConsentStatus } from "../../../../../../lib/supabase/database.types";

const INITIAL: ContactFormState = {};

/**
 * The two interactive detail-page panels (Consent update, Add Note) that
 * can return field errors — both need useActionState to actually surface
 * those errors, unlike the plain `<form action={...}>` lifecycle buttons on
 * the (server) detail page, which are void-returning and have nothing to
 * display. Matches OpportunityActionsPanel's exact reasoning for bundling
 * several stateful action forms into one client component.
 */
export function ContactActionsPanel({
  contactId,
  consentStatus,
  consentSource,
}: {
  contactId: string;
  consentStatus: MarketingContactConsentStatus;
  consentSource: string | null;
}) {
  const [consentState, consentAction, consentPending] = useActionState(updateContactConsent.bind(null, contactId), INITIAL);
  const [noteState, noteAction, notePending] = useActionState(addContactNote.bind(null, contactId), INITIAL);

  return (
    <>
      <Card title="Consent">
        <form action={consentAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {consentState.message && <div className="ta-alert ta-alert-error">{consentState.message}</div>}
          <Field label="Update consent" name="consent_status" error={consentState.errors?.consent_status}>
            <Select id="consent_status" name="consent_status" defaultValue={consentStatus}>
              {MARKETING_CONTACT_CONSENT_STATUSES.map((cs) => (
                <option key={cs} value={cs}>
                  {CONSENT_LABELS[cs]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Consent source" name="consent_source" error={consentState.errors?.consent_source}>
            <Input id="consent_source" name="consent_source" defaultValue={consentSource ?? ""} maxLength={120} />
          </Field>
          <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ alignSelf: "flex-start" }} disabled={consentPending}>
            {consentPending ? "Saving…" : "Update Consent"}
          </button>
        </form>
      </Card>

      <Card title="Add Note">
        <form action={noteAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {noteState.message && <div className="ta-alert ta-alert-error">{noteState.message}</div>}
          <Field label="Note" name="note" error={noteState.errors?.note}>
            <Textarea id="note" name="note" rows={4} maxLength={3000} placeholder="Log a call, an email exchange, or any internal context…" />
          </Field>
          <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" style={{ alignSelf: "flex-start" }} disabled={notePending}>
            {notePending ? "Saving…" : "Add Note"}
          </button>
        </form>
      </Card>
    </>
  );
}
