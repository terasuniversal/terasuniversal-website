/**
 * Staff payment reconciliation (PKG-1d-B): pure rules, no imports and no I/O, so every rule is testable without a
 * database.
 *
 * Since PKG-1c and PKG-1d-A, "paid but not confirmed" is a RECORDED state, not an impossible one:
 *  - paid_unallocated: the payment is kept but no seat was allocated (schedule full under the capacity guard);
 *  - reconciliation_required: a verified payment arrived on a failed/cancelled attempt, or after the registration
 *    ended (late success, or a staff bank transfer on an ended registration);
 *  - amount_mismatch / transaction_conflict / success_after_refund: evidence stored on the attempt, never paid.
 * The evidence lives in a few named keys of public_registration_payments.raw_response. Only those keys are ever
 * selected (see EVIDENCE_SELECT); the rest of raw_response (the provider's row, which may hold personal data) never
 * leaves the database. Nothing here decides money: refunds and seat allocation stay manual and outside this screen.
 */

/** Overview buckets. "registration" buckets are counted on public_registrations, "attempt" buckets on payment attempts. */
export const RECONCILIATION_VIEWS = [
  "paid_confirmed",
  "paid_unconfirmed",
  "payment_pending",
  "failed_cancelled",
  "late_success",
  "manual_transfer",
  "conflict",
] as const;
export type ReconciliationView = (typeof RECONCILIATION_VIEWS)[number];

export const VIEW_META: Record<ReconciliationView, { label: string; unit: "registrations" | "attempts"; hint: string }> = {
  paid_confirmed: { label: "Paid and confirmed", unit: "registrations", hint: "Payment verified and a seat allocated" },
  paid_unconfirmed: { label: "Paid, not confirmed", unit: "registrations", hint: "Money recorded, no seat: needs staff review" },
  payment_pending: { label: "Payment pending", unit: "registrations", hint: "Waiting for the payer or the provider" },
  failed_cancelled: { label: "Failed or cancelled attempts", unit: "attempts", hint: "Provider attempts that did not complete" },
  late_success: { label: "Late successful payments", unit: "attempts", hint: "Verified after the attempt failed or was cancelled" },
  manual_transfer: { label: "Manual bank transfers", unit: "attempts", hint: "Staff-verified transfers recorded as paid" },
  conflict: { label: "Payment conflicts to review", unit: "attempts", hint: "Amount mismatch, transaction conflict or success after refund" },
};

/** Registration-level views filter public_registrations directly; attempt-level views resolve to registration ids. */
export const REGISTRATION_LEVEL_VIEWS: readonly ReconciliationView[] = ["paid_confirmed", "paid_unconfirmed", "payment_pending"];

/**
 * The only parts of raw_response that may be selected. PostgREST JSON-path aliases: each returns one named key, never
 * the whole column.
 */
export const EVIDENCE_SELECT =
  "id, registration_id, late_flag:raw_response->>late_success_reconciliation_required, late_success:raw_response->late_success, amount_mismatch:raw_response->amount_mismatch, transaction_conflicts:raw_response->transaction_conflicts, success_after_refund:raw_response->success_after_refund";

export interface MismatchEvidence {
  transactionId: string;
  providerCents: number | null;
  expectedCents: number | null;
}
export interface ConflictEvidence {
  transactionId: string;
  otherAttemptId: string | null;
}
export interface PaymentEvidence {
  lateSuccess: boolean;
  lateOriginalStatus: string | null;
  mismatches: MismatchEvidence[];
  conflicts: ConflictEvidence[];
  successAfterRefund: boolean;
}

export const NO_EVIDENCE: PaymentEvidence = { lateSuccess: false, lateOriginalStatus: null, mismatches: [], conflicts: [], successAfterRefund: false };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
function cents(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Bounded so a malformed or hostile evidence object cannot flood the screen. */
const MAX_EVIDENCE_ITEMS = 20;

/** Reads one evidence row (the EVIDENCE_SELECT aliases). Anything malformed is ignored rather than guessed. */
export function parseEvidence(row: Obj): PaymentEvidence {
  const late = isObj(row.late_success) ? row.late_success : null;
  const lateSuccess = row.late_flag === "true" || late !== null;
  const mismatches: MismatchEvidence[] = isObj(row.amount_mismatch)
    ? Object.entries(row.amount_mismatch)
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map(([transactionId, v]) => ({
          transactionId,
          providerCents: isObj(v) ? cents(v.provider_amount) : null,
          expectedCents: isObj(v) ? cents(v.expected_amount) : null,
        }))
    : [];
  const conflicts: ConflictEvidence[] = isObj(row.transaction_conflicts)
    ? Object.entries(row.transaction_conflicts)
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map(([transactionId, v]) => ({ transactionId, otherAttemptId: isObj(v) ? text(v.other_attempt_id) : null }))
    : [];
  return {
    lateSuccess,
    lateOriginalStatus: late ? text(late.original_status) : null,
    mismatches,
    conflicts,
    successAfterRefund: isObj(row.success_after_refund) && Object.keys(row.success_after_refund).length > 0,
  };
}

export interface ReconciliationReason {
  code: "late_success" | "amount_mismatch_evidence" | "transaction_conflict" | "success_after_refund";
  severity: "action" | "review";
  label: string;
  detail: string;
}

/** Reasons that come from stored evidence (one entry per kind, however many attempts carry it). */
export function evidenceReasons(evidence: readonly PaymentEvidence[]): ReconciliationReason[] {
  const out: ReconciliationReason[] = [];
  const late = evidence.filter((e) => e.lateSuccess);
  if (late.length > 0) {
    const from = [...new Set(late.map((e) => e.lateOriginalStatus).filter((s): s is string => s !== null))];
    out.push({
      code: "late_success",
      severity: "action",
      label: "Late payment recorded",
      detail: `A verified payment arrived after the attempt was ${from.length > 0 ? from.join(" / ") : "closed"}. That payment did not allocate a seat when it was recorded. Compare it with the registration status and the other payments, and reconcile with the payer; any refund is manual.`,
    });
  }
  if (evidence.some((e) => e.conflicts.length > 0)) {
    out.push({
      code: "transaction_conflict",
      severity: "action",
      label: "Transaction conflict",
      detail: "The provider reported a transaction that already belongs to another attempt, or a second transaction for this one. Nothing was marked paid from it.",
    });
  }
  if (evidence.some((e) => e.successAfterRefund)) {
    out.push({
      code: "success_after_refund",
      severity: "action",
      label: "Success after refund",
      detail: "The provider reported a successful payment on an attempt that was already refunded. It was not re-paid; check the provider.",
    });
  }
  if (evidence.some((e) => e.mismatches.length > 0)) {
    out.push({
      code: "amount_mismatch_evidence",
      severity: "review",
      label: "Provider reported a different amount",
      detail: "The provider reported an amount that differs from the amount due. That transaction was not accepted as payment.",
    });
  }
  return out;
}

/** Exact search on a registration reference, provider transaction id or bill code. Anything else is ignored. */
export function parseSearch(value: string | string[] | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(raw) ? raw : null;
}

export function parseView(value: string | string[] | undefined): ReconciliationView | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return RECONCILIATION_VIEWS.find((v) => v === raw) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export interface CapacityInput {
  capacity: number | null;
  seatsTaken: number | null;
  activeEnrolments: number | null;
  otherActiveHolds: number | null;
}
export interface CapacityView {
  state: "unlimited" | "available" | "full" | "unknown";
  remaining: number | null;
}

/** Same arithmetic as the capacity guard (active enrolments + other active holds), for display only. */
export function capacityView(c: CapacityInput): CapacityView {
  if (c.capacity === null) return { state: "unlimited", remaining: null };
  if (c.activeEnrolments === null || c.otherActiveHolds === null) return { state: "unknown", remaining: null };
  const remaining = c.capacity - c.activeEnrolments - c.otherActiveHolds;
  return { state: remaining > 0 ? "available" : "full", remaining: Math.max(0, remaining) };
}
