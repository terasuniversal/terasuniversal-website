"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleCapability } from "../../../../lib/auth/session";
import { inactivateBill } from "../../../../lib/payments/toyyibpay";
import {
  invoiceDraftEditSchema,
  recordManualPaymentSchema,
  cancelInvoiceSchema,
  fieldErrors,
} from "../../../../lib/validation/schemas";

import {
  LOOKUP_FAILED_MESSAGE,
  LOOKUP_NOT_FOUND_MESSAGE,
  UNCONFIRMED_PAYMENT_MESSAGE,
  buildManualPaymentResult,
  keyStatusForCode,
  parseRecordManualPaymentResponse,
  type KeyStatus,
  type ManualPaymentResult,
  type RecordedPayment,
} from "../../../../lib/payments/manual-payment-outcome";

/**
 * `payment` is set only for a confirmed record_manual_payment outcome (recorded or duplicate_ignored).
 * `unconfirmed` means the payment may or may not exist: the form keeps its values and its G1 key so a retry can only replay.
 * `keyStatus` (R-1) is database evidence about the submitted key: "not_recorded" for a refusal raised after the key
 * check, "used" for idempotency_key_conflict (which still has to be checked against the recorded payment).
 * `lookup`/`recordedPayment`/`recordedResult` (R-1.1) come only from the read-only attempt check. They are evidence to
 * compare, never a confirmed outcome on their own: the client settles only on an exact match.
 */
export type InvoiceActionState = {
  message?: string;
  errors?: Record<string, string>;
  notice?: string;
  payment?: ManualPaymentResult;
  unconfirmed?: boolean;
  keyStatus?: KeyStatus;
  lookup?: "found" | "not_found" | "failed";
  recordedPayment?: RecordedPayment;
  recordedResult?: ManualPaymentResult;
};

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidateInvoice(id: string, opportunityId?: string, quotationId?: string) {
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  if (opportunityId) revalidatePath(`/admin/sales/opportunities/${opportunityId}`);
  if (quotationId) revalidatePath(`/admin/sales/quotations/${quotationId}`);
}

/**
 * Error codes raised by the RPCs (create_invoice_from_quotation,
 * issue_invoice, record_manual_payment, cancel_invoice) mapped to
 * readable messages — mirrors quotations/actions.ts's convention of
 * surfacing the RPC's own raised exception text rather than a generic
 * "something went wrong".
 */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You are not authorized to perform this action.",
  quotation_not_found: "Quotation not found.",
  quotation_not_accepted: "Only an accepted quotation can be converted to an invoice.",
  invoice_already_exists: "This quotation already has an invoice.",
  opportunity_not_found: "The quotation's opportunity could not be found.",
  quotation_totals_inconsistent: "The quotation's totals do not reconcile — cannot create an invoice from it. Please review the quotation.",
  invoice_not_found: "Invoice not found.",
  invoice_not_draft: "Only a draft invoice can be issued.",
  due_date_required: "A due date is required before this invoice can be issued.",
  invalid_grand_total: "This invoice has no payable amount.",
  no_items: "An invoice must have at least one line item before it can be issued.",
  totals_mismatch: "The invoice's totals do not reconcile with its line items — cannot issue. Please review before issuing.",
  invalid_payment_provider: "Invalid payment method.",
  invalid_amount: "Payment amount must be greater than 0.",
  invoice_not_payable: "Only an issued or partially paid invoice can receive a payment.",
  payment_exceeds_balance: "This payment amount exceeds the outstanding balance.",
  idempotency_key_required: "This payment form has expired. Reload the page and try again.",
  idempotency_key_conflict: "This form was already used to record a different payment. Reload the page before recording another payment.",
  payment_reference_required: "A bank transaction reference or cheque number is required for this payment method.",
  duplicate_payment_reference: "A successful payment with this reference is already recorded on this invoice. Check the payment history before recording it again.",
  already_cancelled: "This invoice is already cancelled.",
  cannot_cancel_invoice_with_payments: "An invoice that has received a payment cannot be cancelled directly.",
  active_toyyibpay_attempt: "A ToyyibPay payment link is still active for this invoice. Deactivate it before cancelling.",
  payment_not_found: "Payment not found.",
  payment_not_successful: "A receipt can only be generated for a successful payment.",
  toyyibpay_payment_not_verified: "This ToyyibPay payment has not completed verification.",
  successful_payment_missing_paid_at: "This successful payment has no received date and cannot produce a receipt.",
  hrdf_receipt_unavailable: "HRDF receipt generation is not available in Receipt V1.",
  receipt_snapshot_overpayment: "The payment history exceeds the invoice total; receipt generation requires reconciliation.",
  receipt_snapshot_negative_balance: "The receipt balance could not be validated.",
  receipt_currency_mismatch: "The payment and invoice currencies do not match; receipt generation was rejected.",
  receipt_payment_history_invalid: "The invoice has an incomplete verified ToyyibPay payment history; receipt generation requires reconciliation.",
};

function rpcMessage(error: { message: string } | null): string | undefined {
  if (!error) return undefined;
  const code = error.message.split(":")[0].trim();
  return RPC_ERROR_MESSAGES[code] ?? "Could not complete this action.";
}

/**
 * Task section 3/12: creates a Draft Invoice from an accepted quotation.
 * Admin-only (same as every sales_quotations mutation) — Sales/editor staff
 * can view invoices but not create them, matching the existing
 * sales_quotations RLS precedent (INSERT requires app.is_admin()) exactly.
 * All snapshot/validation logic lives in create_invoice_from_quotation();
 * this action is a thin auth+redirect shim, same shape as
 * acceptQuotationAction.
 */
export async function createInvoiceFromQuotationAction(
  quotationId: string,
  _prev: InvoiceActionState,
  _formData: FormData
): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  const supabase = await createSupabaseServerClient();

  const { data: quotation } = await supabase.from("sales_quotations").select("opportunity_id").eq("id", quotationId).maybeSingle();
  const { data: invoiceId, error } = await supabase.rpc("create_invoice_from_quotation", { p_quotation_id: quotationId });
  if (error) return { message: rpcMessage(error) };

  revalidateInvoice(invoiceId as string, quotation?.opportunity_id, quotationId);
  revalidatePath("/admin/sales/quotations");
  redirect(`/admin/invoices/${invoiceId}`);
}

/**
 * Draft-only edit — invoice_date/due_date/billing snapshot fields/notes/
 * payment_terms. Commercial fields and items are never touched here; there
 * is no path in this action that can write subtotal/tax/grand_total/items,
 * by construction, not just by convention.
 */
export async function updateInvoiceDraft(
  invoiceId: string,
  _prev: InvoiceActionState,
  formData: FormData
): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  const parsed = invoiceDraftEditSchema.safeParse({
    invoice_date: formData.get("invoice_date") ?? "",
    due_date: formData.get("due_date") ?? "",
    billing_name: formData.get("billing_name") ?? "",
    billing_company: formData.get("billing_company") ?? "",
    billing_registration_no: formData.get("billing_registration_no") ?? "",
    billing_address: formData.get("billing_address") ?? "",
    billing_email: formData.get("billing_email") ?? "",
    billing_phone: formData.get("billing_phone") ?? "",
    notes: formData.get("notes") ?? "",
    payment_terms: formData.get("payment_terms") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("invoices").select("status, opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();
  if (!existing) return { message: "Invoice not found." };
  if (existing.status !== "draft") return { message: "Only a draft invoice can be edited." };

  const { error } = await supabase
    .from("invoices")
    .update({
      invoice_date: d.invoice_date,
      due_date: d.due_date,
      billing_name: d.billing_name,
      billing_company: d.billing_company || null,
      billing_registration_no: d.billing_registration_no || null,
      billing_address: d.billing_address || null,
      billing_email: d.billing_email || null,
      billing_phone: d.billing_phone || null,
      notes: d.notes || null,
      payment_terms: d.payment_terms || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (error) return { message: error.message };

  revalidateInvoice(invoiceId, existing.opportunity_id, existing.quotation_id);
  return {};
}

/** Task section 9: freezes the invoice — see issue_invoice() for the full validation this delegates to. */
export async function issueInvoiceAction(invoiceId: string, _prev: InvoiceActionState, _formData: FormData): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase.from("invoices").select("opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();
  const { error } = await supabase.rpc("issue_invoice", { p_invoice_id: invoiceId });
  if (error) return { message: rpcMessage(error) };

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  return {};
}

/**
 * Task section 10/12: manual payment recording. Only staff holding the invoices
 * capability (admin, or Finance Staff with Custom Module Access and Invoices
 * edit) can call this: requireModuleCapability("invoices", "edit") redirects to
 * /admin/no-access before the RPC (which also independently re-checks
 * app.can_module('invoices', 'edit')) is ever reached.
 *
 * Phase 2E fix (MANUAL_PAYMENT_ACTIVE_TOYYIBPAY_ORCHESTRATION_MISSING):
 * before this action ever calls record_manual_payment(), it must resolve
 * any active pending ToyyibPay attempt on the invoice, exactly per the
 * design note in the Phase 2A migration -- get_active_toyyibpay_attempt to
 * detect it, inactivateBill() (provider HTTP call, Next.js-side, never
 * inside Postgres) to deactivate it server-to-server, and only on a
 * CONFIRMED provider success does mark_toyyibpay_attempt_superseded()
 * flip the local row before the manual payment proceeds. If the provider
 * call fails, times out, or its result can't be confirmed, this action
 * returns without ever calling record_manual_payment() -- the invoice's
 * financial state is untouched and the still-active bill remains payable,
 * exactly as before. The previous Phase 2D UI warning banner was
 * informational only; this is the actual enforcement.
 */
export async function recordManualPaymentAction(
  invoiceId: string,
  _prev: InvoiceActionState,
  formData: FormData
): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  const parsed = recordManualPaymentSchema.safeParse({
    payment_provider: formData.get("payment_provider"),
    payment_method: formData.get("payment_method") ?? "",
    amount: formData.get("amount"),
    payment_date: formData.get("payment_date") ?? "",
    payment_reference: formData.get("payment_reference") ?? "",
    notes: formData.get("notes") ?? "",
    idempotency_key: formData.get("idempotency_key") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("invoices").select("opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();

  const { data: activeCheck, error: activeError } = await supabase.rpc("get_active_toyyibpay_attempt", {
    p_invoice_id: invoiceId,
  });
  if (activeError) return { message: "Could not check for an active ToyyibPay payment link before recording this payment. Please try again." };
  const active = activeCheck as { has_active_attempt: boolean; attempt_id?: string; billcode?: string } | null;

  if (active?.has_active_attempt && active.attempt_id && active.billcode) {
    let inactivateSucceeded = false;
    try {
      const result = await inactivateBill(active.billcode);
      inactivateSucceeded = result.success;
    } catch {
      inactivateSucceeded = false;
    }

    if (!inactivateSucceeded) {
      await supabase.rpc("log_toyyibpay_conflict", {
        p_invoice_id: invoiceId,
        p_attempt_id: active.attempt_id,
        p_conflict_type: "in_progress",
      });
      return {
        message: "A ToyyibPay payment link is currently active for this invoice and could not be safely deactivated. The manual payment was NOT recorded — please try again shortly, or reconcile the existing ToyyibPay attempt before retrying.",
      };
    }

    const { error: supersedeError } = await supabase.rpc("mark_toyyibpay_attempt_superseded", {
      p_attempt_id: active.attempt_id,
    });
    if (supersedeError) {
      // Provider confirmed deactivation but the local row could not be
      // updated to match -- a real inconsistency, not a retryable "in
      // progress" state. Never proceed to record_manual_payment while the
      // two are out of sync.
      await supabase.rpc("log_toyyibpay_conflict", {
        p_invoice_id: invoiceId,
        p_attempt_id: active.attempt_id,
        p_conflict_type: "reconciliation_required",
      });
      return {
        message: "The ToyyibPay payment link was deactivated on ToyyibPay's side, but its local status could not be updated. The manual payment was NOT recorded — please contact an administrator before retrying.",
      };
    }
  }

  const { data, error } = await supabase.rpc("record_manual_payment", {
    p_invoice_id: invoiceId,
    p_payment_provider: d.payment_provider,
    p_payment_method: d.payment_method || null,
    p_amount: d.amount,
    p_payment_date: d.payment_date,
    p_payment_reference: d.payment_reference || null,
    p_notes: d.notes || null,
    p_idempotency_key: d.idempotency_key,
  });
  if (error) {
    // G3: a known code is a definite refusal (nothing was written). Anything else (timeout, dropped connection,
    // unexpected database error) may have committed, so it must not read like a rejection that invites re-entry.
    const code = error.message.split(":")[0].trim();
    if (RPC_ERROR_MESSAGES[code]) {
      const keyStatus = keyStatusForCode(code);
      return keyStatus ? { message: RPC_ERROR_MESSAGES[code], keyStatus } : { message: RPC_ERROR_MESSAGES[code] };
    }
    return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };
  }

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  const confirmed = parseRecordManualPaymentResponse(data);
  if (!confirmed) return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };

  // G3-01: read the invoice back so staff see the new balance at once. A failed read never turns a confirmed payment
  // into an error; the result just says the details could not be refreshed.
  const { data: fresh, error: freshError } = await supabase
    .from("invoices")
    .select("status, amount_paid, balance_due")
    .eq("id", invoiceId)
    .maybeSingle();
  const payment = buildManualPaymentResult(confirmed, { provider: d.payment_provider, amount: d.amount }, freshError ? null : fresh);

  // G1: a replay (double submit, retry after a lost response) returns the original payment and writes nothing.
  if (confirmed.outcome === "duplicate_ignored") {
    return { notice: "This payment was already recorded. No second payment was created.", payment };
  }
  return { payment };
}

/**
 * R-1: read-only look-up of an unresolved manual-payment attempt by its G1 key, through the existing
 * invoice_payments SELECT policy (no new database contract). Same guards as recording a payment.
 * A found row settles the attempt as recorded. "Not found" never settles it: the attempt stays unresolved and staff
 * are told to retry the original payment, which can only replay or record it once.
 */
export async function checkManualPaymentAttemptAction(invoiceId: string, idempotencyKey: string): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  if (!IDEMPOTENCY_KEY_RE.test(invoiceId) || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return { message: LOOKUP_FAILED_MESSAGE, unconfirmed: true, lookup: "failed" };
  }
  const supabase = await createSupabaseServerClient();
  // Scoped to this invoice and key, under the caller's RLS: nothing from another invoice can come back.
  const { data: row, error } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, idempotency_key, amount, payment_provider, payment_reference, status")
    .eq("invoice_id", invoiceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) return { message: LOOKUP_FAILED_MESSAGE, unconfirmed: true, lookup: "failed" };
  if (!row || row.status !== "successful") return { message: LOOKUP_NOT_FOUND_MESSAGE, unconfirmed: true, lookup: "not_found" };

  const recordedPayment: RecordedPayment = {
    invoiceId: String(row.invoice_id),
    idempotencyKey: String(row.idempotency_key),
    provider: String(row.payment_provider),
    amount: Number(row.amount),
    reference: row.payment_reference == null ? null : String(row.payment_reference),
    status: String(row.status),
  };
  const { data: fresh, error: freshError } = await supabase
    .from("invoices")
    .select("status, amount_paid, balance_due")
    .eq("id", invoiceId)
    .maybeSingle();
  const recordedResult = buildManualPaymentResult(
    { outcome: "duplicate_ignored", paymentId: row.id, status: null, amountPaid: null },
    { provider: recordedPayment.provider, amount: recordedPayment.amount },
    freshError ? null : fresh
  );
  // Evidence only: the client compares it with the locked attempt and settles on an exact match.
  return { unconfirmed: true, lookup: "found", recordedPayment, recordedResult };
}

export async function generateReceiptAction(formData: FormData): Promise<never> {
  await requireModuleCapability("invoices", "edit");
  const paymentId = String(formData.get("payment_id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) redirect("/admin/no-access");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("generate_receipt_for_payment", { p_payment_id: paymentId });
  if (error) return redirect(`/admin/invoices?error=${encodeURIComponent(rpcMessage(error) ?? "Could not generate receipt.")}`);
  const result = data as { receipt_id?: string } | null;
  if (!result?.receipt_id) return redirect("/admin/invoices?error=Could%20not%20generate%20receipt.");
  revalidatePath(`/admin/invoices/${String(formData.get("invoice_id") ?? "")}`);
  redirect(`/admin/receipt-pdf/${result.receipt_id}`);
}

/**
 * Task section 11: controlled cancellation — see cancel_invoice() for the exact draft/issued-only rule.
 *
 * F-PAY-1: cancel_invoice() does not touch ToyyibPay, and the callback finalizer does not check the
 * invoice status, so cancelling while a pending ToyyibPay bill exists left that bill payable against a
 * cancelled invoice. Before cancelling, resolve the active attempt exactly like recordManualPaymentAction:
 * inactivate the bill server-to-server, and only after a CONFIRMED provider success mark the local attempt
 * superseded. Any check error, provider error, timeout or unconfirmed result stops here and leaves the
 * invoice, the attempt and the bill exactly as they were.
 */
export async function cancelInvoiceAction(invoiceId: string, _prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  await requireModuleCapability("invoices", "edit");
  const parsed = cancelInvoiceSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("invoices").select("opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();

  const { data: activeCheck, error: activeError } = await supabase.rpc("get_active_toyyibpay_attempt", {
    p_invoice_id: invoiceId,
  });
  if (activeError) {
    return { message: "Could not check for an active ToyyibPay payment link before cancelling this invoice. The invoice was NOT cancelled — please try again." };
  }
  const active = activeCheck as { has_active_attempt: boolean; attempt_id?: string; billcode?: string } | null;

  if (active?.has_active_attempt) {
    // An active attempt without its identifiers cannot be inactivated safely: never cancel around it.
    if (!active.attempt_id || !active.billcode) {
      return { message: "A ToyyibPay payment link is active for this invoice but could not be identified. The invoice was NOT cancelled — please contact an administrator." };
    }

    let inactivateSucceeded = false;
    try {
      const result = await inactivateBill(active.billcode);
      inactivateSucceeded = result.success === true;
    } catch {
      inactivateSucceeded = false;
    }

    if (!inactivateSucceeded) {
      await supabase.rpc("log_toyyibpay_conflict", {
        p_invoice_id: invoiceId,
        p_attempt_id: active.attempt_id,
        p_conflict_type: "in_progress",
      });
      return {
        message: "A ToyyibPay payment link is active for this invoice and could not be safely deactivated. The invoice was NOT cancelled — please try again shortly, or reconcile the ToyyibPay attempt first.",
      };
    }

    // If a payment completed before the bill was inactivated, the attempt is no longer pending and this
    // fails (terminal attempts are immutable): the invoice is then not cancelled and needs reconciliation.
    const { error: supersedeError } = await supabase.rpc("mark_toyyibpay_attempt_superseded", {
      p_attempt_id: active.attempt_id,
    });
    if (supersedeError) {
      await supabase.rpc("log_toyyibpay_conflict", {
        p_invoice_id: invoiceId,
        p_attempt_id: active.attempt_id,
        p_conflict_type: "reconciliation_required",
      });
      return {
        message: "The ToyyibPay payment link was deactivated on ToyyibPay's side, but its local status could not be updated. The invoice was NOT cancelled — please contact an administrator before retrying.",
      };
    }
  }

  const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: invoiceId, p_reason: parsed.data.reason || null });
  if (error) {
    if (active?.has_active_attempt) {
      // The bill is already inactive and the attempt superseded, so nothing is payable; say so plainly.
      revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
      return { message: `The ToyyibPay payment link was deactivated, but the invoice could not be cancelled: ${rpcMessage(error)}` };
    }
    return { message: rpcMessage(error) };
  }

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  return {};
}
