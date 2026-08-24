/**
 * Invoice Module V1 -- types and display constants only. Money math
 * (round2/computeLineTotal/computeQuotationTotals) lives in lib/sales/crm.ts
 * and is imported directly by callers that need it -- not duplicated here,
 * per the explicit instruction to reuse the exact quotation money
 * convention end-to-end so quotation and invoice can never drift.
 */

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = ["draft", "issued", "partially_paid", "paid", "cancelled"];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Full vocabulary the invoice_payments table supports (sized for Phase 2 ToyyibPay). */
export type InvoicePaymentProvider = "cash" | "bank_transfer" | "cheque" | "toyyibpay" | "other";

/** V1 only offers these through record_manual_payment() -- 'toyyibpay' is Phase 2. */
export const MANUAL_PAYMENT_PROVIDERS: Exclude<InvoicePaymentProvider, "toyyibpay">[] = ["cash", "bank_transfer", "cheque", "other"];

export const PAYMENT_PROVIDER_LABELS: Record<InvoicePaymentProvider, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  toyyibpay: "ToyyibPay",
  other: "Other",
};

export type InvoicePaymentStatus = "pending" | "successful" | "failed" | "cancelled" | "refunded";

export type InvoiceItemUnit = "pax" | "session" | "day" | "lot" | "unit";

/** Row shape of public.invoices. */
export interface InvoiceRow {
  id: string;
  invoice_no: string;
  quotation_id: string;
  opportunity_id: string;
  company_id: string | null;
  billing_name: string;
  billing_company: string | null;
  billing_registration_no: string | null;
  billing_address: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  invoice_date: string;
  due_date: string;
  currency: string;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  status: InvoiceStatus;
  notes: string | null;
  payment_terms: string | null;
  issued_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/** Row shape of public.invoice_items. */
export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit: InvoiceItemUnit;
  unit_price: number;
  discount: number;
  line_total: number;
  sort_order: number;
  source_quotation_item_id: string | null;
}

/** Row shape of public.invoice_payments. */
export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  payment_provider: InvoicePaymentProvider;
  payment_method: string | null;
  amount: number;
  currency: string;
  status: InvoicePaymentStatus;
  provider_bill_code: string | null;
  provider_transaction_id: string | null;
  provider_reference: string | null;
  payment_reference: string | null;
  notes: string | null;
  paid_at: string;
  verified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Overdue is derived, never stored (architecture audit section J/5) -- a
 * cancelled or fully-paid invoice is never overdue regardless of due_date,
 * and a stale due_date with zero balance isn't overdue either.
 */
export function isInvoiceOverdue(invoice: Pick<InvoiceRow, "status" | "due_date" | "balance_due">): boolean {
  if (invoice.status === "cancelled" || invoice.status === "paid") return false;
  if (invoice.balance_due <= 0) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(invoice.due_date) < today;
}

/** What the status Badge should actually show -- "overdue" is a display-time overlay on issued/partially_paid, never a 6th stored status value. */
export function effectiveInvoiceStatus(invoice: Pick<InvoiceRow, "status" | "due_date" | "balance_due">): string {
  return isInvoiceOverdue(invoice) ? "overdue" : invoice.status;
}
