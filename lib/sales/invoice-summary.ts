import type { createSupabaseServerClient } from "../supabase/server";

/**
 * Quotation screens must not read invoices/invoice_payments directly (M-S5b, Owner Option B): full finance rows
 * are Invoices-module only. This wraps public.get_quotation_invoice_summaries, which returns summary columns for
 * the given quotation ids. invoice_id is null unless the caller can open Invoices, so links are rendered only then.
 */
export interface QuotationInvoiceSummary {
  quotation_id: string;
  invoice_id: string | null;
  invoice_no: string;
  status: string;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  invoice_date: string;
  due_date: string;
  payment_states: { status: string; payment_provider: string }[];
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function getQuotationInvoiceSummaries(
  supabase: ServerClient,
  quotationIds: string[],
): Promise<{ data: QuotationInvoiceSummary[]; error: unknown }> {
  if (quotationIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc("get_quotation_invoice_summaries", { p_quotation_ids: quotationIds });
  if (error) return { data: [], error };
  return { data: (data ?? []) as QuotationInvoiceSummary[], error: null };
}
