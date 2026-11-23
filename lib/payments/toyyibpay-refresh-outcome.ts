/**
 * G2: maps every result of the admin "Refresh / Re-check Status" path to the message staff see.
 *
 * Why this exists: finalize_toyyibpay_payment_from_callback and mark_toyyibpay_attempt_failed_from_callback report
 * their decision in the returned jsonb `outcome`, not as an error. The action used to look only at `error`, so a
 * provider-confirmed payment that the database refused to apply (cancelled invoice, closed attempt, amount above the
 * balance) came back as a silent no-op and the attempt simply stayed "pending".
 *
 * Rule: only `finalized` may produce a success tone. Anything unresolved, refused or unrecognised is never shown as paid.
 * Outcome strings are the ones the live RPC bodies return (verified read-only on Production, 2026-11-23).
 */
export type RefreshTone = "success" | "info" | "warning" | "error";
export type ToyyibpayRefreshResult = { message?: string; tone?: RefreshTone };

const CONTACT_ADMIN = "Nothing was changed. Reconciliation is required — please contact an administrator before taking any further action on this invoice.";

function fmt(amount: unknown): string | null {
  const n = typeof amount === "number" ? amount : typeof amount === "string" ? Number(amount) : NaN;
  return Number.isFinite(n) ? `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
}

function outcomeOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { outcome?: unknown }).outcome;
  return typeof value === "string" ? value : null;
}

/** ToyyibPay itself still reports the bill as not paid (status 2/4), or returned no matching transaction. */
export function providerPendingResult(): ToyyibpayRefreshResult {
  return {
    tone: "info",
    message: "ToyyibPay has not confirmed this payment yet, so it is still pending. Nothing was changed — check again later.",
  };
}

/** ToyyibPay returned a status TERAS does not recognise. Never treated as paid or failed. */
export function providerUnknownResult(): ToyyibpayRefreshResult {
  return {
    tone: "warning",
    message: "ToyyibPay returned a payment status TERAS does not recognise. Nothing was changed and the payment is not shown as paid — please check again later or contact an administrator.",
  };
}

/** The attempt is no longer pending locally (it was finalized, failed or superseded since the page loaded). */
export function attemptNotPendingResult(): ToyyibpayRefreshResult {
  return {
    tone: "info",
    message: "This payment attempt is no longer pending. Reload the page to see its latest status.",
  };
}

/** Result of finalize_toyyibpay_payment_from_callback when ToyyibPay reports the bill as paid. */
export function finalizeOutcomeResult(data: unknown, verifiedAmount: string | null): ToyyibpayRefreshResult {
  switch (outcomeOf(data)) {
    case "finalized":
      return { tone: "success", message: "Payment confirmed by ToyyibPay and recorded on this invoice." };
    case "duplicate_ignored":
      return { tone: "info", message: "This ToyyibPay payment was already recorded on this invoice. No change was made." };
    case "reconciliation_required":
      return {
        tone: "warning",
        message: `ToyyibPay confirms this payment${fmt(verifiedAmount) ? ` (${fmt(verifiedAmount)})` : ""}, but it could not be applied to this invoice because the invoice is cancelled or this payment attempt is already closed. ${CONTACT_ADMIN}`,
      };
    case "amount_exceeds_balance":
      return {
        tone: "warning",
        message: `ToyyibPay confirms ${fmt(verifiedAmount) ?? "an amount"}, which is more than this invoice's current balance. The payment was left pending. ${CONTACT_ADMIN}`,
      };
    default:
      return unexpectedResult();
  }
}

/** Result of mark_toyyibpay_attempt_failed_from_callback when ToyyibPay reports the bill as unsuccessful. */
export function markFailedOutcomeResult(data: unknown): ToyyibpayRefreshResult {
  switch (outcomeOf(data)) {
    case "marked_failed":
      return {
        tone: "warning",
        message: "ToyyibPay reports this payment as unsuccessful. No money was received; this payment link is now closed and you can generate a new one.",
      };
    case "duplicate_ignored":
      return { tone: "info", message: "This payment attempt was already closed. No change was made." };
    default:
      return unexpectedResult();
  }
}

/** Any response shape the action does not recognise. Fail closed: never success. */
export function unexpectedResult(): ToyyibpayRefreshResult {
  return {
    tone: "warning",
    message: "ToyyibPay responded, but TERAS could not confirm the result. Nothing is shown as paid — reload the page to check the latest status, or contact an administrator.",
  };
}

/** Maps RPC exception codes (the text before the first ":") to a staff-readable error. Unknown codes stay generic. */
export function rpcErrorResult(error: { message?: string } | null, fallback: string): ToyyibpayRefreshResult {
  const code = String(error?.message ?? "").split(":")[0].trim();
  if (code === "billcode_mismatch") {
    return { tone: "error", message: `ToyyibPay returned a different bill than this payment attempt. ${CONTACT_ADMIN}` };
  }
  return { tone: "error", message: fallback };
}
