// Pure helpers for the Sales lead contact correction (overlay) feature. No imports on purpose:
// the contract test loads this file directly, and nothing here touches the database.

/** Lead sources whose contact details may be corrected. Marketing contacts stay in the Marketing module. */
export const CONTACT_EDITABLE_SOURCES = ["enquiry", "proposal_request", "internal"] as const;
export type ContactEditableSource = (typeof CONTACT_EDITABLE_SOURCES)[number];

export function isContactEditableSource(source: string | null | undefined): source is ContactEditableSource {
  return (CONTACT_EDITABLE_SOURCES as readonly string[]).includes(source ?? "");
}

export type LeadContactField = "contact_name" | "company" | "email" | "phone";

export interface LeadContactValues {
  contact_name: string;
  company: string;
  email: string;
  phone: string;
}

export const LEAD_CONTACT_FIELD_LABELS: Record<LeadContactField, string> = {
  contact_name: "Name",
  company: "Company",
  email: "Email",
  phone: "Phone",
};

const FIELDS: LeadContactField[] = ["contact_name", "company", "email", "phone"];

type MaybeText = string | null | undefined;

/** Same normalisation as the RPC: trimmed values, e-mail lower-cased; empty stays empty. */
export function normalizeContactValues(input: Record<LeadContactField, MaybeText>): LeadContactValues {
  return {
    contact_name: (input.contact_name ?? "").trim(),
    company: (input.company ?? "").trim(),
    email: (input.email ?? "").trim().toLowerCase(),
    phone: (input.phone ?? "").trim(),
  };
}

/** Names of the fields that differ after normalisation (never the values themselves). */
export function changedContactFields(current: Record<LeadContactField, MaybeText>, next: Record<LeadContactField, MaybeText>): LeadContactField[] {
  const a = normalizeContactValues(current);
  const b = normalizeContactValues(next);
  return FIELDS.filter((field) => a[field] !== b[field]);
}

export function contactFormDirty(initial: Record<LeadContactField, MaybeText>, current: Record<LeadContactField, MaybeText>): boolean {
  return changedContactFields(initial, current).length > 0;
}

/** The customer's original contact details, read from the untouched source row. */
export function originalContactFromSource(leadSource: string, source: unknown): LeadContactValues | null {
  if (!source || typeof source !== "object") return null;
  const s = source as Record<string, MaybeText>;
  if (leadSource === "enquiry") return normalizeContactValues({ contact_name: s.name, company: s.company, email: s.email, phone: s.phone });
  if (leadSource === "proposal_request") return normalizeContactValues({ contact_name: s.contact_person, company: s.company_name, email: s.email, phone: s.phone });
  if (leadSource === "internal") return normalizeContactValues({ contact_name: s.contact_name, company: s.company_name, email: s.email, phone: s.phone });
  return null;
}

/** The corrected contact record as stored: values and version belong to one row. */
export type ContactOverlayRow = { version: number } & Record<LeadContactField, string | null>;

export interface ContactEditSnapshot {
  version: number | null;
  initial: LeadContactValues;
}

/**
 * Values and version for the edit form. When a correction exists, both come from that one overlay
 * row, so they can never describe different moments. Without one the form starts from the lead's
 * current contact values and sends no version; if somebody creates the first correction meanwhile,
 * the database rejects the missing version as stale instead of overwriting it.
 */
export function contactEditSnapshot(overlay: ContactOverlayRow | null, row: Record<LeadContactField, string | null>): ContactEditSnapshot {
  return overlay
    ? { version: overlay.version, initial: normalizeContactValues(overlay) }
    : { version: null, initial: normalizeContactValues(row) };
}

type ReadResult<T> = { data: T | null; error: unknown };

/**
 * Reads the correction first and the lead afterwards, as two separate awaited reads. The order is
 * what makes the pairing safe: a correction that commits after the first read can only make the
 * second read newer than the version, and a version that is older than the values is rejected by
 * the database (stale_update). Reading the version after the values is the unsafe order.
 * A failed overlay read yields no snapshot at all: it is never treated as "no correction yet".
 */
export async function readLeadContactSnapshot<Lead extends Record<LeadContactField, string | null>>(reads: {
  overlay: () => PromiseLike<ReadResult<ContactOverlayRow>>;
  lead: () => PromiseLike<ReadResult<Lead>>;
}): Promise<{ lead: ReadResult<Lead>; overlayFailed: boolean; snapshot: ContactEditSnapshot | null }> {
  const overlay = await reads.overlay();
  const lead = await reads.lead();
  const overlayFailed = !!overlay.error;
  const snapshot = overlayFailed || !lead.data ? null : contactEditSnapshot(overlay.data, lead.data);
  return { lead, overlayFailed, snapshot };
}

export interface ContactEditSession {
  readonly version: number | null;
  readonly initial: Readonly<LeadContactValues>;
}

/** The baseline of one editing session, captured when the Sheet opens and never replaced while it is open. */
export function captureContactEditSession(version: number | null, initial: LeadContactValues): ContactEditSession {
  return Object.freeze({ version, initial: Object.freeze({ ...initial }) });
}

/**
 * useActionState keeps the last result forever, so a failure from an earlier session would
 * reappear when the Sheet is reopened. The Sheet remembers the result that was current when it
 * was last opened; that same object is hidden, and any newer submission result is shown.
 */
export function visibleSubmissionState<T extends object>(state: T, dismissedAtOpen: T | null, empty: T): T {
  return dismissedAtOpen !== null && state === dismissedAtOpen ? empty : state;
}

export type LeadContactErrorKind =
  | "forbidden"
  | "stale"
  | "no_changes"
  | "invalid"
  | "unsupported"
  | "not_found"
  | "unavailable"
  | "error";

/**
 * Maps a database error to a user-safe message. The database raises short codes only; the
 * raw message is never shown, and nothing here can echo a submitted value.
 */
export function mapContactRpcError(error: { code?: string | null; message?: string | null } | null | undefined): { kind: LeadContactErrorKind; message: string } {
  const code = error?.code ?? "";
  const text = error?.message ?? "";
  if (code === "42501" || text.includes("forbidden")) {
    return { kind: "forbidden", message: "You do not have permission to edit this lead's contact details." };
  }
  if (text.includes("stale_update")) {
    return { kind: "stale", message: "These contact details were changed by someone else. Reload to see the latest version before editing again." };
  }
  if (text.includes("no_changes")) return { kind: "no_changes", message: "No changes to save." };
  if (text.includes("invalid_email")) return { kind: "invalid", message: "Enter a valid email address." };
  if (text.includes("contact_method_required")) return { kind: "invalid", message: "Enter an email address or phone number." };
  if (text.includes("invalid_input")) return { kind: "invalid", message: "Check the contact details and try again." };
  if (text.includes("source_not_supported")) return { kind: "unsupported", message: "This lead's contact details are managed elsewhere." };
  if (text.includes("lead_not_found")) return { kind: "not_found", message: "This lead could not be found. Reload the page." };
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "PGRST205") {
    return { kind: "unavailable", message: "Contact editing is not available yet." };
  }
  return { kind: "error", message: "Unable to save the contact details. Please try again." };
}
