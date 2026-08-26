"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { inactivateBill } from "../../../../lib/payments/toyyibpay";
import {
  invoiceDraftEditSchema,
  recordManualPaymentSchema,
  cancelInvoiceSchema,
  fieldErrors,
} from "../../../../lib/validation/schemas";

export type InvoiceActionState = { message?: string; errors?: Record<string, string> };

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
  already_cancelled: "This invoice is already cancelled.",
  cannot_cancel_invoice_with_payments: "An invoice that has received a payment cannot be cancelled directly.",
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
  await requireRole("admin");
  await requireModuleAccess("invoices");
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
  await requireRole("admin");
  await requireModuleAccess("invoices");
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
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase.from("invoices").select("opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();
  const { error } = await supabase.rpc("issue_invoice", { p_invoice_id: invoiceId });
  if (error) return { message: rpcMessage(error) };

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  return {};
}

/**
 * Task section 10/12: manual payment recording — admin-only. Sales/editor
 * staff have no path to call this: requireRole("admin") redirects to
 * /admin/no-access before the RPC (which also independently re-checks
 * app.is_admin()) is ever reached.
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
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const parsed = recordManualPaymentSchema.safeParse({
    payment_provider: formData.get("payment_provider"),
    payment_method: formData.get("payment_method") ?? "",
    amount: formData.get("amount"),
    payment_date: formData.get("payment_date") ?? "",
    payment_reference: formData.get("payment_reference") ?? "",
    notes: formData.get("notes") ?? "",
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

  const { error } = await supabase.rpc("record_manual_payment", {
    p_invoice_id: invoiceId,
    p_payment_provider: d.payment_provider,
    p_payment_method: d.payment_method || null,
    p_amount: d.amount,
    p_payment_date: d.payment_date,
    p_payment_reference: d.payment_reference || null,
    p_notes: d.notes || null,
  });
  if (error) return { message: rpcMessage(error) };

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  return {};
}

/** Task section 11: controlled cancellation — see cancel_invoice() for the exact draft/issued-only rule. */
export async function cancelInvoiceAction(invoiceId: string, _prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const parsed = cancelInvoiceSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("invoices").select("opportunity_id, quotation_id").eq("id", invoiceId).maybeSingle();
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: invoiceId, p_reason: parsed.data.reason || null });
  if (error) return { message: rpcMessage(error) };

  revalidateInvoice(invoiceId, existing?.opportunity_id, existing?.quotation_id);
  return {};
}
