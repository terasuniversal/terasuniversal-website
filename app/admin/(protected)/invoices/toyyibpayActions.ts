"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { createBill, inactivateBill, ringgitStringToSen, getBillTransactions, parseToyyibpayTransactionDate } from "../../../../lib/payments/toyyibpay";
import { canonicalSiteOrigin } from "../../../../lib/site-origin";

/**
 * Phase 2B only: creates a ToyyibPay sandbox bill and records it as a
 * pending invoice_payments row. Never marks anything paid -- that is
 * Phase 2C's callback-verified job, not this action's. Admin-only, same
 * gate as every other invoice mutation.
 */
export type ToyyibpayLinkState = {
  message?: string;
  billcode?: string;
  paymentUrl?: string;
  amount?: number;
  reused?: boolean;
};

const RECORD_RETRY_ATTEMPTS = 3;
const RECORD_RETRY_BASE_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function generateToyyibpayPaymentLinkAction(
  invoiceId: string,
  _prev: ToyyibpayLinkState,
  _formData: FormData
): Promise<ToyyibpayLinkState> {
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const supabase = await createSupabaseServerClient();

  // ---------------------------------------------------------------------
  // 1. Fresh server-side eligibility read. Plain SELECT -- both tables are
  // already SELECT-granted to authenticated, no dedicated RPC needed for
  // this step (per the approved Phase 2B/orphan-compensation design).
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_no, status, balance_due, billing_name, billing_email, billing_phone")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { message: "Could not load this invoice." };
  if (!invoice) return { message: "Invoice not found." };
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") {
    return { message: "Only an issued or partially paid invoice can generate a ToyyibPay payment link." };
  }
  const balanceDue = Number(invoice.balance_due);
  if (!(balanceDue > 0)) {
    return { message: "This invoice has no outstanding balance." };
  }

  // ---------------------------------------------------------------------
  // 2. Idempotency: reuse an existing pending attempt if its amount still
  // matches the current balance. If the balance has drifted since the
  // attempt was created, Phase 2B does not auto-supersede it (that's the
  // Inactive Bill manual-payment-race policy, deferred to the next
  // hardening phase) -- stop and surface for manual reconciliation instead.
  const { data: activeCheck, error: activeError } = await supabase.rpc("get_active_toyyibpay_attempt", {
    p_invoice_id: invoiceId,
  });
  if (activeError) return { message: "Could not check for an existing payment attempt." };
  const active = activeCheck as { has_active_attempt: boolean; attempt_id?: string } | null;

  if (active?.has_active_attempt && active.attempt_id) {
    const { data: attemptRow, error: attemptError } = await supabase
      .from("invoice_payments")
      .select("amount, payment_url, provider_bill_code")
      .eq("id", active.attempt_id)
      .maybeSingle();
    if (attemptError || !attemptRow) return { message: "Could not load the existing payment attempt." };

    const attemptAmount = Number(attemptRow.amount);
    if (attemptAmount.toFixed(2) === balanceDue.toFixed(2)) {
      return {
        billcode: attemptRow.provider_bill_code ?? undefined,
        paymentUrl: attemptRow.payment_url ?? undefined,
        amount: attemptAmount,
        reused: true,
      };
    }

    return {
      message: `A pending ToyyibPay attempt already exists for RM ${attemptAmount.toFixed(2)}, but the invoice balance is now RM ${balanceDue.toFixed(2)}. This requires manual reconciliation before a new payment link can be generated -- please contact an administrator.`,
    };
  }

  // ---------------------------------------------------------------------
  // 3. Create the bill. amountSen is computed server-side, decimal-string
  // safe, from the invoice's own balance_due -- never from any client input.
  const attemptId = crypto.randomUUID();
  const amountSen = ringgitStringToSen(balanceDue.toFixed(2));
  const origin = await canonicalSiteOrigin();

  let billResult: { billCode: string; paymentUrl: string };
  try {
    billResult = await createBill({
      invoiceNo: invoice.invoice_no,
      description: `Invoice ${invoice.invoice_no}`,
      amountSen,
      // Phase 2B does not build the return page or callback route yet --
      // these URLs are stored on the ToyyibPay side for Phase 2C/2D to
      // wire up; visiting them today 404s, which is expected.
      returnUrl: `${origin}/payments/toyyibpay/return?attempt=${attemptId}`,
      callbackUrl: `${origin}/api/payments/toyyibpay/callback`,
      externalReferenceNo: attemptId,
      billTo: invoice.billing_name,
      billEmail: invoice.billing_email,
      billPhone: invoice.billing_phone,
    });
  } catch (err) {
    return { message: err instanceof Error ? err.message : "Could not create the ToyyibPay bill." };
  }

  // ---------------------------------------------------------------------
  // 4. Record it locally, with bounded retry (closes most of the
  // provider-orphan window without needing compensation at all -- a plain
  // INSERT is safe to retry against the same attemptId/billcode).
  let recordErrorMessage: string | null = null;
  for (let attempt = 1; attempt <= RECORD_RETRY_ATTEMPTS; attempt++) {
    const { error } = await supabase.rpc("record_toyyibpay_bill", {
      p_invoice_id: invoiceId,
      p_attempt_id: attemptId,
      p_billcode: billResult.billCode,
      p_payment_url: billResult.paymentUrl,
      p_amount: balanceDue,
    });
    if (!error) {
      recordErrorMessage = null;
      break;
    }
    recordErrorMessage = error.message;
    if (attempt < RECORD_RETRY_ATTEMPTS) await sleep(RECORD_RETRY_BASE_DELAY_MS * attempt);
  }

  if (recordErrorMessage) {
    // ---------------------------------------------------------------------
    // 5. Provider-orphan compensation: a real ToyyibPay bill now exists
    // with no local record of it. Never return the payment URL past this
    // point -- the customer must not be able to pay a bill TERAS has no
    // record of.
    let compensationSucceeded = false;
    try {
      const result = await inactivateBill(billResult.billCode);
      compensationSucceeded = result.success;
    } catch {
      compensationSucceeded = false;
    }

    await supabase.rpc("log_toyyibpay_orphan_bill_event", {
      p_invoice_id: invoiceId,
      p_billcode: billResult.billCode,
      p_compensation_status: compensationSucceeded ? "deactivated" : "deactivation_failed",
      p_detail: recordErrorMessage,
    });

    if (compensationSucceeded) {
      return { message: "Could not save this payment attempt. It has been safely deactivated on ToyyibPay's side -- please try again." };
    }
    return {
      message: "Could not save this payment attempt, and it could NOT be deactivated on ToyyibPay's side. This requires manual reconciliation -- please contact support before retrying.",
    };
  }

  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { billcode: billResult.billCode, paymentUrl: billResult.paymentUrl, amount: balanceDue, reused: false };
}

/**
 * Phase 2D: admin-triggered "Refresh Payment Status" for a pending
 * ToyyibPay attempt. Reuses the EXACT same verification path the callback
 * route and public return page already use -- Get Bill Transactions, then
 * the same two narrowly-scoped callback RPCs -- never a new financial
 * architecture. Those RPCs are revoked from `authenticated` by design
 * (Phase 2C), so this call site uses the service-role client, exactly like
 * the public return page's own justified exception: narrow, server-only,
 * reached only after requireRole("admin") has already run. p_callback_received_at
 * is null -- this is an admin-triggered recheck, not a real callback arrival,
 * and must never be recorded as one.
 */
export type ToyyibpayRefreshState = { message?: string };

export async function refreshToyyibpayStatusAction(
  attemptId: string,
  _prev: ToyyibpayRefreshState,
  _formData: FormData
): Promise<ToyyibpayRefreshState> {
  await requireRole("admin");
  await requireModuleAccess("invoices");

  const supabase = await createSupabaseServerClient();
  const { data: attempt, error: attemptError } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, status, provider_bill_code")
    .eq("id", attemptId)
    .eq("payment_provider", "toyyibpay")
    .maybeSingle();
  if (attemptError) return { message: "Could not load this payment attempt." };
  if (!attempt) return { message: "Payment attempt not found." };
  if (attempt.status !== "pending" || !attempt.provider_bill_code) {
    // Nothing to refresh -- not an error, just a no-op the caller doesn't need to see.
    return {};
  }

  let transactions;
  try {
    transactions = await getBillTransactions(attempt.provider_bill_code);
  } catch {
    return { message: "Could not reach ToyyibPay to check this payment's status. Please try again shortly." };
  }
  const tx = transactions.find((t) => t.billCode === attempt.provider_bill_code) ?? transactions[0];
  if (!tx || (tx.providerStatus !== "successful" && tx.providerStatus !== "unsuccessful")) {
    // Still pending on ToyyibPay's side, or an unrecognized transaction --
    // nothing to change locally.
    revalidatePath(`/admin/invoices/${attempt.invoice_id}`);
    return {};
  }

  const service = createSupabaseServiceClient();

  if (tx.providerStatus === "successful") {
    if (!tx.providerTransactionId || !tx.amount) {
      return { message: "ToyyibPay reports this payment as successful but did not return a transaction reference -- please try again shortly." };
    }
    const parsedTime = tx.transactionTime ? parseToyyibpayTransactionDate(tx.transactionTime) : null;
    const rawResponseWithEvidence = {
      ...(tx.raw as object),
      _teras_provider_time_evidence: parsedTime ?? { raw: tx.transactionTime, parseFailed: true },
    };
    const { error: finalizeError } = await service.rpc("finalize_toyyibpay_payment_from_callback", {
      p_attempt_id: attempt.id,
      p_billcode: attempt.provider_bill_code,
      p_verified_amount: tx.amount,
      p_provider_transaction_id: tx.providerTransactionId,
      p_provider_transaction_time: null,
      p_callback_received_at: null,
      p_raw_response: rawResponseWithEvidence,
    });
    if (finalizeError) return { message: "Could not confirm this payment. Please try again shortly." };
  } else {
    const { error: markFailedError } = await service.rpc("mark_toyyibpay_attempt_failed_from_callback", {
      p_attempt_id: attempt.id,
      p_billcode: attempt.provider_bill_code,
      p_callback_received_at: null,
      p_reason: "confirmed unsuccessful via admin-triggered status refresh",
    });
    if (markFailedError) return { message: "Could not update this payment's status. Please try again shortly." };
  }

  revalidatePath(`/admin/invoices/${attempt.invoice_id}`);
  return {};
}
