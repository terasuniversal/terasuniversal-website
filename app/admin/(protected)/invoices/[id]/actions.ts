"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { recordHrdfPaymentSchema } from "../../../../../lib/validation/schemas";

function payload(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["grant_reference", "grant_approved_date", "grant_amount", "rejection_reason", "training_schedule_id", "claim_reference", "claim_submitted_date", "claim_amount", "claim_approved_date", "approved_amount"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) result[key] = value;
  }
  return result;
}

function fail(invoiceId: string, message: string): never {
  redirect(`/admin/invoices/${invoiceId}?hrdf_error=${encodeURIComponent(message.split(":")[0])}`);
}

export async function createHrdfClaimAction(invoiceId: string) {
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_hrdf_claim_for_invoice", { p_invoice_id: invoiceId });
  if (error) fail(invoiceId, error.message);
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/hrdf-claims");
  redirect(`/admin/invoices/${invoiceId}`);
}

export async function transitionHrdfClaimAction(claimId: string, invoiceId: string, formData: FormData) {
  await requireRole("admin");
  await requireModuleAccess("hrdf_claims");
  const supabase = await createSupabaseServerClient();
  const toStatus = String(formData.get("to_status") ?? "");
  const { error } = await supabase.rpc("transition_hrdf_claim", {
    p_claim_id: claimId,
    p_to_status: toStatus,
    p_payload: payload(formData),
  });
  if (error) fail(invoiceId, error.message);
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/hrdf-claims");
  redirect(`/admin/invoices/${invoiceId}`);
}

export async function recordHrdfPaymentAction(claimId: string, invoiceId: string, formData: FormData) {
  await requireRole("admin");
  await requireModuleAccess("invoices");
  const supabase = await createSupabaseServerClient();
  const parsed = recordHrdfPaymentSchema.safeParse({
    payment_provider: formData.get("payment_provider"),
    payment_method: formData.get("payment_method") ?? "",
    amount: formData.get("amount"),
    payment_date: formData.get("payment_date") ?? "",
    payment_reference: formData.get("payment_reference") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) fail(invoiceId, "invalid_payment_details");
  const payment = parsed.data;
  const { error } = await supabase.rpc("record_hrdf_payment", {
    p_claim_id: claimId,
    p_amount: payment.amount,
    p_payment_provider: payment.payment_provider,
    p_payment_method: payment.payment_method || null,
    p_payment_date: payment.payment_date || null,
    p_payment_reference: payment.payment_reference,
    p_notes: payment.notes || null,
  });
  if (error) fail(invoiceId, error.message);
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/hrdf-claims");
  redirect(`/admin/invoices/${invoiceId}`);
}
