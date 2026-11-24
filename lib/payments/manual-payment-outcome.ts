/**
 * G3: what Finance staff are told after "Record Payment", and when a G1 idempotency key may be reused.
 *
 * Why this exists (G1 Staging UAT, 2026-11-24):
 * - G3-01: a recorded payment returned an empty state, identical to "nothing happened yet", so the panel had no way to
 *   say "recorded" and kept showing the old balance next to an enabled Record button.
 * - G3-03: a confirmed replay (`duplicate_ignored`) shared that same shape apart from a notice that could be overwritten
 *   or unmounted with the payment card, so staff could not tell a replay from a new payment.
 * - A lost response (network drop, unknown database error, unrecognised RPC result) was shown like a definite
 *   rejection, which invites typing the payment again under a new key.
 *
 * Rules:
 * - Only an RPC result with `outcome: "recorded"` is shown as a new payment. `duplicate_ignored` is shown as "already
 *   recorded, nothing new was created". Anything else is "not confirmed": keep the same key and the same values so a
 *   retry can only ever replay, never duplicate.
 * - A key belongs to one payment intent. The database treats invoice + provider + amount + reference as the identity of
 *   a replay (record_manual_payment_unguarded, G1), so the client binds the key to exactly those fields and takes a new
 *   key when any of them changes. Notes, bank detail and date are not part of the identity.
 */
import { INVOICE_STATUS_LABELS, PAYMENT_PROVIDER_LABELS, type InvoicePaymentProvider, type InvoiceStatus } from "../sales/invoices";

export type ManualPaymentOutcome = "recorded" | "duplicate_ignored";

export interface ManualPaymentResult {
  outcome: ManualPaymentOutcome;
  paymentId: string | null;
  provider: string;
  amount: number;
  /** Invoice state read back after the RPC. `refreshed` is false when that read failed; the payment itself is still confirmed. */
  invoiceStatus: string | null;
  amountPaid: number | null;
  balanceDue: number | null;
  refreshed: boolean;
}

export type ManualPaymentTone = "success" | "info" | "warning";

export const UNCONFIRMED_PAYMENT_MESSAGE =
  "The payment could not be confirmed. It may or may not have been saved. Check the payment history before doing anything else. Submitting this same form again is safe: it cannot create a second payment.";

/** Form fields in on-screen order, so focus goes to the first field with an error. */
export const MANUAL_PAYMENT_FIELD_ORDER = ["payment_provider", "payment_method", "amount", "payment_date", "payment_reference", "notes"] as const;

export function firstErrorField(errors: Record<string, string> | undefined): string | undefined {
  if (!errors) return undefined;
  return MANUAL_PAYMENT_FIELD_ORDER.find((field) => Boolean(errors[field]));
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Reads the record_manual_payment jsonb. Returns null for anything that is not one of the two confirmed outcomes. */
export function parseRecordManualPaymentResponse(data: unknown): { outcome: ManualPaymentOutcome; paymentId: string | null; status: string | null; amountPaid: number | null } | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.outcome !== "recorded" && row.outcome !== "duplicate_ignored") return null;
  return {
    outcome: row.outcome,
    paymentId: typeof row.payment_id === "string" ? row.payment_id : null,
    status: typeof row.status === "string" ? row.status : null,
    amountPaid: finiteNumber(row.amount_paid),
  };
}

/** Builds the result shown to staff from the RPC outcome plus the invoice row read back afterwards (null if that read failed). */
export function buildManualPaymentResult(
  rpc: NonNullable<ReturnType<typeof parseRecordManualPaymentResponse>>,
  request: { provider: string; amount: number },
  invoice: { status?: unknown; amount_paid?: unknown; balance_due?: unknown } | null
): ManualPaymentResult {
  const balanceDue = invoice ? finiteNumber(invoice.balance_due) : null;
  const refreshed = balanceDue !== null && typeof invoice?.status === "string";
  return {
    outcome: rpc.outcome,
    paymentId: rpc.paymentId,
    provider: request.provider,
    amount: request.amount,
    invoiceStatus: refreshed ? (invoice!.status as string) : rpc.status,
    amountPaid: refreshed ? finiteNumber(invoice!.amount_paid) ?? rpc.amountPaid : rpc.amountPaid,
    balanceDue: refreshed ? balanceDue : null,
    refreshed,
  };
}

export function fmtRM(n: number): string {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string | null): string | null {
  if (!status) return null;
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? null;
}

/** The banner shown after a confirmed outcome. Never claims a new payment for a replay. */
export function describeManualPaymentResult(result: ManualPaymentResult): { tone: ManualPaymentTone; title: string; detail: string; next?: string } {
  const method = PAYMENT_PROVIDER_LABELS[result.provider as InvoicePaymentProvider] ?? "Manual payment";
  const status = statusLabel(result.invoiceStatus);
  const position = result.refreshed && result.balanceDue !== null
    ? `Balance due is now ${fmtRM(result.balanceDue)}${status ? ` (${status})` : ""}.`
    : null;

  if (result.outcome === "duplicate_ignored") {
    return {
      tone: "info",
      title: "Already recorded — no new payment was created",
      detail: `This ${fmtRM(result.amount)} ${method} payment was saved earlier. Nothing new was recorded.${position ? ` ${position}` : ""}`,
      next: result.refreshed ? "Check the payment history below." : "Reload this page to see the latest balance. Do not record this payment again.",
    };
  }
  if (!result.refreshed) {
    return {
      tone: "warning",
      title: "Payment recorded — invoice details could not be refreshed",
      detail: `The ${fmtRM(result.amount)} ${method} payment was saved.`,
      next: "Reload this page to see the latest balance and payment history. Do not record this payment again.",
    };
  }
  return {
    tone: "success",
    title: "Payment recorded",
    detail: `${fmtRM(result.amount)} by ${method} was recorded. ${position}`,
    next: result.invoiceStatus === "paid"
      ? "The invoice is fully paid. Generate the receipt from the payment history below."
      : "Generate the receipt from the payment history below.",
  };
}

/** Identity of a payment intent, using the same fields the database uses to decide replay vs conflict. */
export function manualPaymentIntent(values: { payment_provider: string; amount: string; payment_reference: string }): string {
  const amount = Number(values.amount);
  return [values.payment_provider, Number.isFinite(amount) ? amount.toFixed(2) : values.amount.trim(), values.payment_reference.trim()].join("|");
}

/** Next.js signals redirect/notFound by throwing; those must reach the router, not be reported as a lost payment response. */
export function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

/**
 * Wraps a server action for useActionState. A rejected promise (dropped connection, crashed request) would otherwise
 * throw into the error boundary, and staff would retype the payment on a fresh page under a fresh key. Here it becomes
 * the caller's "unconfirmed" state, which keeps the form, its values and its key so a retry can only replay.
 */
export function withUnconfirmedOnReject<Bound extends unknown[], S>(
  action: (...args: [...Bound, S, FormData]) => Promise<S>,
  unconfirmed: () => S
): (...args: [...Bound, S, FormData]) => Promise<S> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      if (isNavigationSignal(error)) throw error;
      return unconfirmed();
    }
  };
}

/**
 * Decides the key to send. While nothing is unresolved, a key already sent for a different intent is never reused: a
 * changed amount, method or reference is a different payment.
 *
 * R-1: while an earlier attempt is unresolved (its outcome was never confirmed), the key never changes, whatever the
 * intent. If that attempt was in fact recorded, the database then refuses any different details with
 * idempotency_key_conflict instead of recording a second payment. The panel also locks the fields, so in practice the
 * intent cannot differ; this rule is the second line of defence.
 */
export function keyForSubmission(
  current: { key: string; intent: string | null },
  intent: string,
  newKey: () => string,
  unresolved = false
): { key: string; intent: string } {
  if (unresolved) return { key: current.key, intent: current.intent ?? intent };
  if (current.intent === null || current.intent === intent) return { key: current.key, intent };
  return { key: newKey(), intent };
}

// ---- R-1: unresolved attempts ---------------------------------------------------------------------------------------

/**
 * Database codes that prove the submitted key was NOT recorded. record_manual_payment_unguarded (G1) checks for an
 * existing row with the key under the invoice lock *before* raising any of these, and returns duplicate_ignored if it
 * finds one. So a same-key submission that ends in one of these codes proves the earlier attempt never committed.
 * Codes raised before that check (not_authorized, invalid_*, payment_reference_required, invoice_not_found) prove
 * nothing and leave the attempt unresolved.
 */
export const KEY_NOT_RECORDED_CODES = ["invoice_not_payable", "payment_exceeds_balance", "duplicate_payment_reference"] as const;

/** The key is already attached to a recorded payment (with different details). */
export const KEY_USED_CODE = "idempotency_key_conflict";

export type KeyStatus = "not_recorded" | "used";

export function keyStatusForCode(code: string): KeyStatus | undefined {
  if ((KEY_NOT_RECORDED_CODES as readonly string[]).includes(code)) return "not_recorded";
  if (code === KEY_USED_CODE) return "used";
  return undefined;
}

export type UnresolvedResolution = "confirmed" | "not_recorded" | "key_used" | "unresolved";

/**
 * How a result settles an attempt that is currently unresolved. Only database evidence settles it: a confirmed
 * recorded/replayed payment, a found row, or a refusal raised after the key check. Validation errors, refusals raised
 * before the key check, lost responses and "not found" look-ups all leave it unresolved.
 */
export function resolveUnresolvedAttempt(state: { payment?: unknown; keyStatus?: KeyStatus; unconfirmed?: boolean }): UnresolvedResolution {
  if (state.payment) return "confirmed";
  if (state.keyStatus === "not_recorded") return "not_recorded";
  if (state.keyStatus === "used") return "key_used";
  return "unresolved";
}

export const PENDING_LOCK_TITLE = "Payment not confirmed — details are locked";
export const PENDING_LOCK_MESSAGE =
  "The last attempt may or may not have been saved. Method, amount and reference are locked to that attempt. Retry the original payment (it cannot create a second payment) or check its status. Do not record another payment for this money until this is resolved.";
export const LOOKUP_NOT_FOUND_MESSAGE =
  "No recorded payment was found for this attempt yet. That does not prove it failed. Retry the original payment to settle it safely.";
export const LOOKUP_FAILED_MESSAGE = "The payment status could not be checked. The attempt is still unresolved; try again shortly.";
export const NOT_RECORDED_RESOLVED_NOTE = "The earlier attempt was not recorded, so the payment details are unlocked.";
/** R-1.1: an old attempt is still an unresolved attempt; age is never evidence that it failed. */
export const STALE_PENDING_NOTICE =
  "This unconfirmed payment attempt is more than 7 days old. Its age does not show whether it was recorded, so it stays locked until the payment status is confirmed.";
export const BLOCKED_TITLE = "Payment recording is blocked on this invoice";
export const BLOCKED_CORRUPT_MESSAGE =
  "Details of an earlier unconfirmed payment attempt on this invoice could not be read safely, so it cannot be checked or retried here. Recording payments on this invoice is blocked in this browser session. Contact the Finance administrator to reconcile the payment history before any further payment is recorded.";
export const BLOCKED_MISMATCH_MESSAGE =
  "The key of the unconfirmed attempt is already attached to a recorded payment with different details. No new payment was created. Recording payments on this invoice is blocked in this browser session. Contact the Finance administrator to reconcile it.";
export const KEY_CONFLICT_CHECKING_MESSAGE = "This attempt's key is already in use. Checking the recorded payment before anything else is allowed.";
export const STORAGE_WARNING =
  "This browser could not save the recovery details for this unconfirmed payment. Do not refresh or leave this page until it is resolved, or the lock may be lost.";
export const STORAGE_READ_WARNING =
  "This browser blocked access to saved payment-recovery details, so an earlier unconfirmed attempt on this invoice cannot be detected here. Check the payment history before recording a payment, and do not rely on refresh to keep a lock.";
export const STORAGE_CLEAR_WARNING =
  "This browser could not clear the saved recovery details. If this page is reopened, the earlier attempt will be checked again against the payment history before anything else is allowed.";

/** What is kept so an unresolved attempt survives a refresh: the key and the replay identity, nothing else. */
export interface PendingAttempt {
  key: string;
  provider: string;
  amount: string;
  reference: string;
  paymentDate: string;
  createdAt: number;
}

export const PENDING_STORAGE_VERSION = 1;
/** Age above which a restored attempt carries the "older than 7 days" notice. It is never a reason to unlock. */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_PROVIDERS = ["cash", "bank_transfer", "cheque", "other"];

/** Scoped to the signed-in staff member and the invoice, so neither another user nor another invoice can pick it up. */
export function pendingStorageKey(userId: string, invoiceId: string): string {
  return `teras:crm:pending-manual-payment:v${PENDING_STORAGE_VERSION}:${userId}:${invoiceId}`;
}

export function serializePending(userId: string, invoiceId: string, attempt: PendingAttempt): string {
  return JSON.stringify({ v: PENDING_STORAGE_VERSION, u: userId, i: invoiceId, k: attempt.key, p: attempt.provider, a: attempt.amount, r: attempt.reference, d: attempt.paymentDate, t: attempt.createdAt });
}

export type ParsedPending =
  | { state: "none" }
  /** The full replay identity was recovered. `stale` marks age only; it never changes what is allowed. */
  | { state: "ok"; attempt: PendingAttempt; stale: boolean }
  /** Something is stored but the identity cannot be trusted. `key` is the readable idempotency key, if any. */
  | { state: "corrupt"; key: string | null };

/**
 * R-1.1: nothing stored is ever silently dropped. A record whose replay identity (owner, invoice, key, method, amount,
 * reference) is intact is restored, however old. Anything else is "corrupt": payment recording stays blocked, and a
 * readable key is only used for a read-only status check (never to retry or to unlock, because the details it would
 * have to match are not known).
 */
export function parsePending(raw: string | null, userId: string, invoiceId: string, now: number): ParsedPending {
  if (raw === null) return { state: "none" };
  let o: Record<string, unknown>;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "corrupt", key: null };
    o = value as Record<string, unknown>;
  } catch {
    return { state: "corrupt", key: null };
  }
  const key = typeof o.k === "string" && UUID_RE.test(o.k) ? o.k : null;
  const identityIntact =
    o.v === PENDING_STORAGE_VERSION &&
    o.u === userId &&
    o.i === invoiceId &&
    key !== null &&
    typeof o.p === "string" && MANUAL_PROVIDERS.includes(o.p) &&
    typeof o.a === "string" && /^\d{1,10}(\.\d{1,2})?$/.test(o.a) && Number(o.a) > 0 &&
    typeof o.r === "string" && o.r.length <= 200;
  if (!identityIntact) return { state: "corrupt", key };
  // Date and time are not part of the replay identity: a bad date falls back to "" (the form uses today), and a
  // missing, invalid or future time counts as old rather than invalidating the record.
  const paymentDate = typeof o.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.d) ? o.d : "";
  const createdAt = typeof o.t === "number" && Number.isFinite(o.t) && o.t <= now + 60_000 ? o.t : 0;
  return {
    state: "ok",
    stale: now - createdAt > PENDING_TTL_MS,
    attempt: { key, provider: o.p as string, amount: o.a as string, reference: o.r as string, paymentDate, createdAt },
  };
}

/** G1's normalisation of a payment reference (record_manual_payment_unguarded): upper case, letters and digits only. */
export function normalizeReference(reference: string | null | undefined): string {
  return String(reference ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface RecordedPayment {
  invoiceId: string;
  idempotencyKey: string;
  provider: string;
  amount: number;
  reference: string | null;
  status: string;
}

/**
 * R-1.1 (Gate B): a recorded payment settles an unresolved attempt only if it is exactly that attempt: same invoice,
 * same key, a successful status, and the same method, amount (to the cent) and normalised reference.
 */
export function matchRecordedPayment(
  recorded: RecordedPayment,
  expected: { invoiceId: string; attempt: PendingAttempt }
): "match" | "mismatch" {
  const a = expected.attempt;
  const same =
    recorded.invoiceId === expected.invoiceId &&
    recorded.idempotencyKey.toLowerCase() === a.key.toLowerCase() &&
    recorded.status === "successful" &&
    recorded.provider === a.provider &&
    Number.isFinite(recorded.amount) && recorded.amount.toFixed(2) === Number(a.amount).toFixed(2) &&
    normalizeReference(recorded.reference) === normalizeReference(a.reference);
  return same ? "match" : "mismatch";
}

/** The replay identity of a stored attempt, comparable with manualPaymentIntent(values). */
export function pendingIntent(attempt: PendingAttempt): string {
  return manualPaymentIntent({ payment_provider: attempt.provider, amount: attempt.amount, payment_reference: attempt.reference });
}
