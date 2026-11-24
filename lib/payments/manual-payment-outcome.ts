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
 * Decides the key to send. A key already sent for a different intent is never reused: a changed amount, method or
 * reference is a different payment, and resending the old key would be refused as a conflict (or, worse, be mistaken
 * for a replay of a payment the user no longer means).
 */
export function keyForSubmission(current: { key: string; intent: string | null }, intent: string, newKey: () => string): { key: string; intent: string } {
  if (current.intent === null || current.intent === intent) return { key: current.key, intent };
  return { key: newKey(), intent };
}
