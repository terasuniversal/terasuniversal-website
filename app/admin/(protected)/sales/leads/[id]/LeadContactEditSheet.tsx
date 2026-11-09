"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "../../../../../../components/admin/ui";
import { Button } from "../../../../../../components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "../../../../../../components/ui/sheet";
import { updateLeadContact, type LeadContactActionState } from "../actions";
import {
  LEAD_CONTACT_FIELD_LABELS,
  captureContactEditSession,
  contactFormDirty,
  visibleSubmissionState,
  type ContactEditSession,
  type LeadContactField,
  type LeadContactValues,
} from "../../../../../../lib/sales/lead-contact";

const INITIAL: LeadContactActionState = {};
const FIELD_ORDER: LeadContactField[] = ["contact_name", "company", "email", "phone"];

// Every control is at least 44px tall: the practical minimum touch target on a phone.
const CONTROL_STYLE = { minHeight: 44 } as const;

/**
 * Corrects a lead's contact details. The correction is saved as a separate record, so the
 * customer's original submission stays unchanged (shown here for reference once corrected).
 * `expectedVersion` is null until a first correction exists; the database rejects a save whose
 * version is stale, and this form then offers a reload instead of overwriting.
 */
export function LeadContactEditSheet({
  leadMetadataId,
  expectedVersion,
  initial,
  original,
}: {
  leadMetadataId: string;
  expectedVersion: number | null;
  initial: LeadContactValues;
  original: LeadContactValues | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Baseline of the current editing session (values and the version they belong to). It is captured
  // when the Sheet opens and replaced only by the next fresh open, so a page refresh that delivers
  // newer props while the Sheet is open can never attach a newer version to older values.
  const [session, setSession] = useState<ContactEditSession>(() => captureContactEditSession(expectedVersion, initial));
  const [values, setValues] = useState<LeadContactValues>(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(updateLeadContact.bind(null, leadMetadataId, session.version), INITIAL);
  const handledState = useRef<LeadContactActionState>(INITIAL);
  const [dismissedAtOpen, setDismissedAtOpen] = useState<LeadContactActionState | null>(null);

  const dirty = contactFormDirty(session.initial, values);
  // A result left over from before this Sheet was last opened is not shown again.
  const shown = visibleSubmissionState(state, dismissedAtOpen, INITIAL);
  const errors = shown.errors ?? {};
  const failure = shown.status === "error" ? shown : null;

  // A successful save closes the sheet and leaves a polite status message next to the trigger.
  useEffect(() => {
    if (state.status === "success" && handledState.current !== state) {
      handledState.current = state;
      setSavedMessage(state.message ?? "Contact details updated.");
      setConfirmDiscard(false);
      setOpen(false);
    }
  }, [state]);

  // Warn before the tab is closed or reloaded while there are unsaved edits.
  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);

  function requestOpenChange(next: boolean) {
    if (next) {
      setSession(captureContactEditSession(expectedVersion, initial));
      setValues(initial);
      setConfirmDiscard(false);
      setSavedMessage(null);
      setDismissedAtOpen(state);
      setOpen(true);
      return;
    }
    if (pending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
  }

  function discardAndClose() {
    setConfirmDiscard(false);
    setValues(session.initial);
    setOpen(false);
  }

  function reloadLatest() {
    setConfirmDiscard(false);
    setOpen(false);
    router.refresh();
  }

  function set(field: LeadContactField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="ta-contact-edit">
      <Sheet open={open} onOpenChange={requestOpenChange}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" className="h-11">
            Edit contact
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full max-w-[480px] overflow-y-auto" aria-describedby="lead-contact-edit-description">
          <div className="flex flex-col gap-1 border-b p-4">
            <SheetTitle className="text-lg">Edit contact details</SheetTitle>
            <SheetDescription id="lead-contact-edit-description">
              Corrections are saved separately. The original submission is kept unchanged.
            </SheetDescription>
          </div>

          <form action={formAction} className="flex flex-1 flex-col gap-3 p-4" aria-busy={pending}>
            {failure?.message && (
              <div className="ta-alert ta-alert-error" role="alert">
                {failure.message}
                {failure.kind === "stale" && (
                  <div style={{ marginTop: 8 }}>
                    <Button type="button" variant="outline" className="h-11" onClick={reloadLatest}>
                      Reload latest details
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Field label={LEAD_CONTACT_FIELD_LABELS.contact_name} name="contact_name" error={errors.contact_name} required controlId="lead-contact-name">
              <input
                name="contact_name"
                value={values.contact_name}
                onChange={(event) => set("contact_name", event.target.value)}
                maxLength={120}
                autoComplete="off"
                style={CONTROL_STYLE}
              />
            </Field>
            <Field label={LEAD_CONTACT_FIELD_LABELS.company} name="company" error={errors.company} controlId="lead-contact-company">
              <input
                name="company"
                value={values.company}
                onChange={(event) => set("company", event.target.value)}
                maxLength={160}
                autoComplete="off"
                style={CONTROL_STYLE}
              />
            </Field>
            <Field label={LEAD_CONTACT_FIELD_LABELS.email} name="email" error={errors.email} hint="Email or phone is required." controlId="lead-contact-email">
              <input
                name="email"
                type="email"
                inputMode="email"
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
                maxLength={254}
                autoComplete="off"
                style={CONTROL_STYLE}
              />
            </Field>
            <Field label={LEAD_CONTACT_FIELD_LABELS.phone} name="phone" error={errors.phone} controlId="lead-contact-phone">
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                maxLength={40}
                autoComplete="off"
                style={CONTROL_STYLE}
              />
            </Field>

            {original && (
              <details className="ta-contact-original">
                <summary style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}>As originally submitted</summary>
                <dl className="ta-kv">
                  {FIELD_ORDER.map((field) => (
                    <div key={field} style={{ display: "contents" }}>
                      <dt>{LEAD_CONTACT_FIELD_LABELS[field]}</dt>
                      <dd>{original[field] || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}

            {confirmDiscard && (
              <div className="ta-alert ta-alert-error" role="alert">
                <p style={{ margin: "0 0 8px" }}>Discard your unsaved changes?</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmDiscard(false)}>
                    Keep editing
                  </Button>
                  <Button type="button" variant="destructive" className="h-11" onClick={discardAndClose}>
                    Discard changes
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <Button type="submit" size="lg" disabled={pending || !dirty}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => requestOpenChange(false)}>
                Cancel
              </Button>
            </div>
            {!dirty && <p className="ta-muted-sub" style={{ margin: 0 }}>Change at least one field to save.</p>}
          </form>
        </SheetContent>
      </Sheet>
      <p role="status" aria-live="polite" className="ta-muted-sub" style={{ margin: "8px 0 0" }}>
        {savedMessage}
      </p>
    </div>
  );
}
