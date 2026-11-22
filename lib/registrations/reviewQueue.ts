/**
 * Public Registration Review Queue: pure rules (no imports, no I/O) so every
 * state and exception can be tested without a database.
 *
 * Ground rules, taken from the live schema and RPC source (PKG-1c + PKG-1d-A):
 *  - Payment success at Toyyibpay is never treated as registration completion.
 *  - "Paid but not confirmed" is a RECORDED state that always needs staff
 *    review: the payment is kept without a seat when the schedule is full
 *    (paid_unallocated), or when it arrived after the attempt failed or the
 *    registration ended (reconciliation_required). It is flagged as an action,
 *    and the label says which of the two it is.
 *  - Stored evidence (late success, amount mismatch, transaction conflict,
 *    success after refund) is turned into reasons by
 *    lib/registrations/reconciliation.ts and passed in as `extra`; this module
 *    never sees raw_response.
 *  - A transaction recorded on an ended registration whose attempt is not paid
 *    is still reported as a possible late payment (older rows).
 *  - Anything that cannot be confirmed from these rows is reported as UNKNOWN,
 *    not guessed.
 *
 * Amounts arrive as integer cents (null when missing or not a finite number).
 */

export const REGISTRATION_STATUSES = ["pending_payment", "payment_pending", "confirmed", "failed", "cancelled", "expired"] as const;
export const PAYMENT_STATUSES = ["pending", "processing", "paid", "failed", "cancelled", "refunded"] as const;
/** Filters that the database can answer for ALL pages in one query (no cross-table logic). */
export const ATTENTION_FILTERS = ["expired_hold", "paid_unconfirmed"] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

export const PAGE_SIZE = 25;
export const MAX_PAGE = 10000;

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending_payment: "Pending payment",
  payment_pending: "Payment in progress",
  confirmed: "Confirmed",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};
export const ATTENTION_FILTER_LABELS: Record<AttentionFilter, string> = {
  expired_hold: "Hold expired, still open (all pages)",
  paid_unconfirmed: "Paid, not confirmed (all pages)",
};

export interface QueueParams {
  page: number;
  status: RegistrationStatus | null;
  payment: PaymentStatus | null;
  attention: AttentionFilter | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | null {
  return allowed.find((item) => item === value) ?? null;
}

/** Whitelists every input: unknown or malformed values fall back to "no filter" / page 1. Nothing is passed to a database filter unvalidated. */
export function parseQueueParams(sp: { page?: string | string[]; status?: string | string[]; payment?: string | string[]; attention?: string | string[] }): QueueParams {
  const rawPage = first(sp.page);
  const page = rawPage && /^\d{1,5}$/.test(rawPage) ? Math.min(Math.max(Number.parseInt(rawPage, 10), 1), MAX_PAGE) : 1;
  return {
    page,
    status: oneOf(REGISTRATION_STATUSES, first(sp.status)),
    payment: oneOf(PAYMENT_STATUSES, first(sp.payment)),
    attention: oneOf(ATTENTION_FILTERS, first(sp.attention)),
  };
}

/** Total pages for a count, never below 1. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));
}

/** PostgREST answers HTTP 416 with this code when a counted range starts past the last row (for example page 2 of an empty list). */
export const RANGE_NOT_SATISFIABLE = "PGRST103";

export interface PageQueryResult<T> {
  data: T[] | null;
  count: number | null;
  error: { code?: string } | null;
}
export interface CountQueryResult {
  count: number | null;
  error: { code?: string } | null;
}
export type RecoveredPage<T> =
  | { ok: true; page: number; rows: T[]; count: number }
  | { ok: false; code: string | undefined; query: "list" | "count" | "list retry" };

/**
 * Loads one page and, when the requested page lies beyond the end (a stale link, or search/filters that shrank the
 * list), shows the last valid page instead (page 1 when the list is empty). It retries at most ONCE: one exact count
 * and one re-fetch, never a loop. Every other error is returned unchanged for the caller to report.
 */
export async function fetchPageWithRecovery<T>(
  requested: number,
  fetchPage: (page: number) => PromiseLike<PageQueryResult<T>>,
  countRows: () => PromiseLike<CountQueryResult>,
): Promise<RecoveredPage<T>> {
  const first = await fetchPage(requested);
  let target: number;
  let knownCount: number | null = null;
  if (first.error) {
    if (first.error.code !== RANGE_NOT_SATISFIABLE || requested <= 1) return { ok: false, code: first.error.code, query: "list" };
    const counted = await countRows();
    // No exact count is a failure, never "empty": an empty screen must not hide registrations that exist.
    if (counted.error || counted.count === null) return { ok: false, code: counted.error?.code, query: "count" };
    knownCount = Math.max(0, counted.count);
    target = pageCount(knownCount);
    // A count that still covers the requested page means the 416 was not "past the end": report it, never loop.
    if (target >= requested) return { ok: false, code: first.error.code, query: "list" };
  } else {
    const rows = first.data ?? [];
    const total = Math.max(0, first.count ?? 0);
    target = pageCount(total);
    if (rows.length > 0 || requested <= target) return { ok: true, page: requested, rows, count: total };
    knownCount = total;
  }
  // Nothing matches: page 1, empty, without another query.
  if (knownCount === 0) return { ok: true, page: 1, rows: [], count: 0 };
  const retry = await fetchPage(target);
  if (retry.error) return { ok: false, code: retry.error.code, query: "list retry" };
  return { ok: true, page: target, rows: retry.data ?? [], count: Math.max(0, retry.count ?? knownCount ?? 0) };
}

export interface RegistrationInput {
  id: string;
  registration_reference: string;
  created_at: string;
  schedule_id: string;
  course_id: string;
  attendee_count: number;
  amount_due_cents: number | null;
  registration_status: string;
  payment_status: string;
  hold_expires_at: string | null;
}

export interface AttendeeInput {
  id: string;
  registration_id: string;
  full_name: string;
  company: string | null;
  participant_id: string | null;
}

export interface PaymentInput {
  id: string;
  registration_id: string;
  payment_provider: string;
  status: string;
  /** Attempt amount. */
  amount_cents: number | null;
  verified_cents: number | null;
  bill_creation_state: string;
  has_transaction_id: boolean;
  callback_received: boolean;
}

/** Active enrolments for the registration's schedule. known=false when the enrolment lookup was too large to be exact. */
export interface EnrolmentInput {
  known: boolean;
  participantIds: ReadonlySet<string>;
}

export type ExceptionCode =
  | "hold_expired_active"
  | "late_payment_signal"
  | "bill_creation_failed"
  | "paid_not_confirmed"
  | "confirmed_not_paid"
  | "participant_link_missing"
  | "enrolment_missing"
  | "enrolment_unknown"
  | "amount_mismatch"
  | "duplicate_paid_payments"
  | "payment_status_inconsistent"
  | "provider_outcome_unknown"
  // Evidence-based reasons (reconciliation.ts evidenceReasons()).
  | "late_success"
  | "amount_mismatch_evidence"
  | "transaction_conflict"
  | "success_after_refund";

export type ExceptionSeverity = "action" | "review" | "unknown";

export interface RegistrationException {
  code: ExceptionCode;
  severity: ExceptionSeverity;
  label: string;
  detail: string;
}

export type RegistrationStage = "new" | "awaiting_payment" | "payment_received" | "confirmed" | "failed" | "cancelled" | "expired" | "unknown";

export const STAGE_LABELS: Record<RegistrationStage, string> = {
  new: "New",
  awaiting_payment: "Awaiting payment",
  payment_received: "Payment received, not confirmed",
  confirmed: "Confirmed",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  unknown: "Unknown",
};

export interface ClassifiedRegistration {
  stage: RegistrationStage;
  stageLabel: string;
  paidCents: number | null;
  dueCents: number | null;
  crm: { state: "not_applicable" | "complete" | "incomplete" | "unknown"; attendees: number; linked: number; enrolled: number | null };
  primaryAttendee: string | null;
  company: string | null;
  exceptions: RegistrationException[];
  needsAttention: boolean;
}

const OPEN = ["pending_payment", "payment_pending"];
const ENDED = ["cancelled", "expired"];
const SEVERITY_ORDER: Record<ExceptionSeverity, number> = { action: 0, review: 1, unknown: 2 };

function isPast(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now.getTime();
}

export function classifyRegistration(
  reg: RegistrationInput,
  attendees: readonly AttendeeInput[],
  payments: readonly PaymentInput[],
  enrolment: EnrolmentInput,
  now: Date,
  extra: readonly RegistrationException[] = [],
): ClassifiedRegistration {
  const exceptions = new Map<ExceptionCode, RegistrationException>();
  const flag = (code: ExceptionCode, severity: ExceptionSeverity, label: string, detail: string) => {
    if (!exceptions.has(code)) exceptions.set(code, { code, severity, label, detail });
  };

  const status = reg.registration_status;
  const due = reg.amount_due_cents;
  const paid = payments.filter((p) => p.status === "paid");
  const holdPassed = isPast(reg.hold_expires_at, now);

  // Stage: what the registration is, read only from its own status and payments.
  let stage: RegistrationStage;
  if (status === "confirmed") stage = "confirmed";
  else if (reg.payment_status === "paid" || paid.length > 0) stage = "payment_received";
  else if (status === "pending_payment") stage = payments.length === 0 ? "new" : "awaiting_payment";
  else if (status === "payment_pending") stage = "awaiting_payment";
  else if (status === "failed" || status === "cancelled" || status === "expired") stage = status;
  else stage = "unknown";

  // 1. Registration should have expired by itself.
  if (OPEN.includes(status) && holdPassed) {
    flag("hold_expired_active", "action", "Hold expired, still open", "The hold ended but the registration is still open. Registrations are meant to expire on their own; this one has not.");
  }

  // 2. A provider transaction was recorded after the registration ended.
  if (ENDED.includes(status) && payments.some((p) => p.has_transaction_id && p.callback_received && p.status !== "paid" && p.status !== "refunded")) {
    flag("late_payment_signal", "action", "Possible late payment", "A provider transaction was recorded after this registration ended. Check Toyyibpay and reconcile manually.");
  }

  // 3. Bill creation did not complete cleanly.
  if (status !== "confirmed" && payments.some((p) => p.payment_provider === "toyyibpay" && (p.bill_creation_state === "failed" || p.bill_creation_state === "orphaned"))) {
    flag("bill_creation_failed", "review", "Bill creation failed", "A payment bill was not created or attached cleanly. A bill may exist at the provider.");
  }

  // 4. Paid but not confirmed: a recorded state (PKG-1c / PKG-1d-A) that always needs staff review.
  if ((reg.payment_status === "paid" || paid.length > 0) && status !== "confirmed") {
    if (ENDED.includes(status) || status === "failed") {
      flag("paid_not_confirmed", "action", "Paid after the registration ended", "A verified payment is recorded but the registration had already ended or failed, so no seat was allocated. Reconcile with the payer; any refund or re-registration is manual.");
    } else {
      flag("paid_not_confirmed", "action", "Paid, seat not allocated", "Payment is recorded but no seat was allocated (for example the schedule was full). Review the schedule capacity; refunds and seat changes are manual.");
    }
  }

  // 4b. Reasons from stored payment evidence, computed by the loader. Late-success evidence stays on the attempt for
  // good; once the registration is confirmed (a seat was allocated later) it is a review item, not an open action.
  for (const reason of extra) {
    if (reason.code === "late_success" && status === "confirmed") {
      flag(reason.code, "review", "Late payment recorded (registration now confirmed)", `${reason.detail} The registration has since been confirmed: check that the payer was not charged twice.`);
    } else {
      flag(reason.code, reason.severity, reason.label, reason.detail);
    }
  }

  // 5. Confirmed without a recorded payment (free registrations, amount 0, are excluded).
  if (status === "confirmed" && due !== null && due > 0 && reg.payment_status !== "paid") {
    flag("confirmed_not_paid", "review", "Confirmed, payment not recorded as paid", "The registration is confirmed but its payment status is not paid.");
  }

  // 6. Amount verified against the amount due.
  for (const p of paid) {
    if (due !== null && (p.verified_cents === null || p.verified_cents !== due || (p.amount_cents !== null && p.amount_cents !== due))) {
      flag("amount_mismatch", "action", "Paid amount differs", "The verified amount does not match the amount due for this registration.");
    }
  }

  // 7. More than one paid attempt: possible double charge.
  if (paid.length > 1) {
    flag("duplicate_paid_payments", "action", "Multiple paid payments", "More than one payment attempt is marked paid for this registration.");
  }

  // 8. Registration-level and attempt-level payment states disagree.
  const refunded = payments.some((p) => p.status === "refunded");
  if (
    (reg.payment_status === "paid" && paid.length === 0) ||
    (paid.length > 0 && reg.payment_status !== "paid" && reg.payment_status !== "refunded") ||
    (refunded && reg.payment_status !== "refunded" && reg.payment_status !== "paid") ||
    (reg.payment_status === "refunded" && status === "confirmed")
  ) {
    flag("payment_status_inconsistent", "review", "Payment status inconsistent", "The registration payment status does not agree with its payment attempts.");
  }

  // 9. The provider side cannot be confirmed from our rows.
  if (
    payments.some((p) => p.payment_provider === "toyyibpay" && (p.status === "pending" || p.status === "processing") && p.bill_creation_state === "attached" && !p.callback_received) &&
    (ENDED.includes(status) || status === "failed" || holdPassed)
  ) {
    flag("provider_outcome_unknown", "unknown", "Provider outcome unknown", "No provider callback was received. UNKNOWN whether the customer paid; check Toyyibpay.");
  }

  // CRM state (only meaningful once confirmed).
  const linked = attendees.filter((a) => a.participant_id).length;
  let enrolled: number | null = null;
  if (status === "confirmed" && enrolment.known) {
    enrolled = attendees.filter((a) => a.participant_id && enrolment.participantIds.has(a.participant_id)).length;
  }
  let crmState: ClassifiedRegistration["crm"]["state"] = "not_applicable";
  if (status === "confirmed") {
    if (attendees.length === 0 || linked < attendees.length) {
      crmState = "incomplete";
      flag("participant_link_missing", "action", "Participant link missing", "A confirmed registration has an attendee with no linked participant record.");
    } else if (!enrolment.known) {
      crmState = "unknown";
      flag("enrolment_unknown", "unknown", "Enrolment not checked", "Too many enrolments to check exactly for this schedule. UNKNOWN whether every attendee is enrolled.");
    } else if ((enrolled ?? 0) < linked) {
      crmState = "incomplete";
      flag("enrolment_missing", "review", "Not enrolled in the schedule", "A linked participant has no active enrolment in this schedule (it may have been cancelled by staff).");
    } else {
      crmState = "complete";
    }
  }

  const sorted = [...exceptions.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const paidCents = paid.length === 0 ? null : paid.every((p) => p.verified_cents !== null) ? paid.reduce((sum, p) => sum + (p.verified_cents ?? 0), 0) : null;

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    paidCents,
    dueCents: due,
    crm: { state: crmState, attendees: attendees.length, linked, enrolled },
    primaryAttendee: attendees[0]?.full_name ?? null,
    company: attendees.find((a) => a.company)?.company ?? null,
    exceptions: sorted,
    needsAttention: sorted.length > 0,
  };
}
