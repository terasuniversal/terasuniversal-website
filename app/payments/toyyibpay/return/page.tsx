import { createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { getBillTransactions, parseToyyibpayTransactionDate } from "../../../../lib/payments/toyyibpay";

export const metadata = { title: "Payment Status — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Public, read-only. attempt/order_id/billcode/status_id URL params are
 * lookup HINTS only -- never trusted to mark anything paid. This page
 * always fetches the attempt's real state from the database (via the
 * service-role client, since an unauthenticated customer has no staff
 * session and invoice_payments' RLS is staff-only SELECT -- the same
 * "narrow, server-only, reviewed need" pattern the callback route already
 * uses, not a general-purpose exposure). If the attempt is still pending,
 * this page makes one best-effort server-side Get Bill Transactions check
 * and finalizes through the exact same callback RPC the webhook itself
 * uses -- never a second, parallel finalization path.
 *
 * Shows only what a paying customer needs: status, amount, invoice
 * number. No billing address, no internal ids beyond the invoice number,
 * no admin-only detail.
 */
export default async function ToyyibpayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string; order_id?: string; billcode?: string; status_id?: string }>;
}) {
  const params = await searchParams;
  const attemptId = params.attempt ?? params.order_id ?? null;

  if (!attemptId) {
    return <StatusShell state="failed" message="We could not find this payment attempt. Please contact the invoice issuer." />;
  }

  const supabase = createSupabaseServiceClient();
  const { data: attempt } = await supabase
    .from("invoice_payments")
    .select("id, status, amount, provider_bill_code, invoice_id")
    .eq("id", attemptId)
    .eq("payment_provider", "toyyibpay")
    .maybeSingle();

  if (!attempt) {
    return <StatusShell state="failed" message="We could not find this payment attempt. Please contact the invoice issuer." />;
  }

  let finalStatus: string = attempt.status;

  // Still pending on load -- make one best-effort live check. Never
  // finalizes here directly; goes through the identical RPC the callback
  // route uses, so there is exactly one finalization code path in the
  // whole system, not two that could ever disagree.
  if (attempt.status === "pending" && attempt.provider_bill_code) {
    try {
      const transactions = await getBillTransactions(attempt.provider_bill_code);
      const tx = transactions.find((t) => t.billCode === attempt.provider_bill_code) ?? transactions[0];

      if (tx?.providerStatus === "successful" && tx.providerTransactionId && tx.amount) {
        // Same timezone-unconfirmed policy as the callback route: never
        // pass the raw provider timestamp as p_provider_transaction_time
        // until ToyyibPay's timezone contract is confirmed -- the RPC's
        // own coalesce(..., now()) falls back to TERAS verification time
        // for paid_at instead. Raw + parsed values still preserved as
        // evidence in raw_response.
        const parsedTime = tx.transactionTime ? parseToyyibpayTransactionDate(tx.transactionTime) : null;
        const rawResponseWithEvidence = {
          ...(tx.raw as object),
          _teras_provider_time_evidence: parsedTime ?? { raw: tx.transactionTime, parseFailed: true },
        };
        const { data: result, error: finalizeError } = await supabase.rpc("finalize_toyyibpay_payment_from_callback", {
          p_attempt_id: attempt.id,
          p_billcode: attempt.provider_bill_code,
          p_verified_amount: tx.amount,
          p_provider_transaction_id: tx.providerTransactionId,
          p_provider_transaction_time: null,
          p_callback_received_at: null, // return-page-triggered verification, not a real callback arrival
          p_raw_response: rawResponseWithEvidence,
        });
        if (finalizeError) {
          // RPC failed -- never claim success. Leave finalStatus as the
          // attempt's real (still-pending) status; a later visit or the
          // real callback can still resolve it.
          console.error("[toyyibpay-return] finalize_toyyibpay_payment_from_callback failed", { attemptId: attempt.id, message: finalizeError.message });
        } else if (result?.outcome === "finalized" || result?.outcome === "duplicate_ignored") {
          finalStatus = "successful";
        }
      } else if (tx?.providerStatus === "unsuccessful") {
        const { error: markFailedError } = await supabase.rpc("mark_toyyibpay_attempt_failed_from_callback", {
          p_attempt_id: attempt.id,
          p_billcode: attempt.provider_bill_code,
          p_callback_received_at: null,
          p_reason: "confirmed unsuccessful via return-page verification",
        });
        if (markFailedError) {
          console.error("[toyyibpay-return] mark_toyyibpay_attempt_failed_from_callback failed", { attemptId: attempt.id, message: markFailedError.message });
        } else {
          finalStatus = "failed";
        }
      }
      // else still pending -- leave as-is, no mutation.
    } catch {
      // Verification attempt failed -- leave attempt exactly as it was; the
      // callback (if it eventually arrives) or a later visit can still
      // resolve it. Never guess.
    }
  }

  const { data: invoice } = await supabase.from("invoices").select("invoice_no").eq("id", attempt.invoice_id).maybeSingle();

  if (finalStatus === "successful") {
    return (
      <StatusShell
        state="successful"
        message={`Payment received for invoice ${invoice?.invoice_no ?? ""}. Thank you.`}
        amount={attempt.amount}
      />
    );
  }
  if (finalStatus === "failed") {
    return <StatusShell state="failed" message={`This payment attempt for invoice ${invoice?.invoice_no ?? ""} was not successful.`} amount={attempt.amount} />;
  }
  if (finalStatus === "superseded") {
    return <StatusShell state="failed" message="This payment link is no longer active. Please request a new payment link." />;
  }
  return <StatusShell state="pending" message={`We are still confirming your payment for invoice ${invoice?.invoice_no ?? ""}. This page will not mark anything paid on its own -- please check back shortly.`} amount={attempt.amount} />;
}

function StatusShell({ state, message, amount }: { state: "verifying" | "successful" | "pending" | "failed"; message: string; amount?: number }) {
  const palette: Record<typeof state, { bg: string; fg: string; label: string }> = {
    verifying: { bg: "#eff6ff", fg: "#1d4ed8", label: "Verifying" },
    successful: { bg: "#f0fdf4", fg: "#15803d", label: "Payment Successful" },
    pending: { bg: "#fefce8", fg: "#a16207", label: "Payment Pending" },
    failed: { bg: "#fef2f2", fg: "#b91c1c", label: "Payment Failed" },
  };
  const c = palette[state];
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.1)", padding: 32, textAlign: "center" }}>
        <div style={{ display: "inline-block", background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, borderRadius: 999, padding: "6px 14px", marginBottom: 16 }}>
          {c.label.toUpperCase()}
        </div>
        <p style={{ fontSize: 15, color: "#1a2233", lineHeight: 1.6, margin: 0 }}>{message}</p>
        {typeof amount === "number" && (
          <p style={{ fontSize: 20, fontWeight: 700, marginTop: 16, color: "#1a2233" }}>RM {amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</p>
        )}
      </div>
    </div>
  );
}
