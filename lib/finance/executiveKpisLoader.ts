import { requireRole } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";
import { resolveReportDateRange, type ReportDateRange, type ReportRangeKey } from "../sales/reports";
import {
  BILLABLE_INVOICE_STATUSES,
  computeExecutiveKpis,
  type BillableInvoiceRow,
  type BookedQuotationRow,
  type ExecutiveKpis,
  type PaymentRow,
} from "./executiveKpis";

/** Rows per query. A result that fills it is treated as "too large to be exact" and fails, never shown partial. */
const ROW_LIMIT = 5000;

export type ExecutiveKpiResult =
  | { ok: true; range: ReportDateRange; kpis: ExecutiveKpis }
  | { ok: false; reason: "query_failed" | "too_large" };

type Json = Record<string, unknown>;

function one(value: unknown): Json | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && typeof v === "object" ? (v as Json) : null;
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toQuotation(raw: Json): BookedQuotationRow {
  const opp = one(raw.opportunity);
  return {
    id: str(raw.id),
    opportunity_id: str(raw.opportunity_id),
    status: str(raw.status),
    total: raw.total,
    tax: raw.tax,
    accepted_at: strOrNull(raw.accepted_at),
    is_test: raw.is_test === true,
    opportunity: opp ? { stage: str(opp.stage), is_test: opp.is_test === true } : null,
  };
}

function toInvoice(raw: Json): BillableInvoiceRow {
  const q = one(raw.quotation);
  return {
    id: str(raw.id),
    status: str(raw.status),
    grand_total: raw.grand_total,
    tax_amount: raw.tax_amount,
    balance_due: raw.balance_due,
    issued_at: strOrNull(raw.issued_at),
    due_date: strOrNull(raw.due_date),
    quotation: q ? { is_test: q.is_test === true } : null,
  };
}

function toPayment(raw: Json): PaymentRow {
  const inv = one(raw.invoice);
  const q = inv ? one(inv.quotation) : null;
  return {
    id: str(raw.id),
    invoice_id: str(raw.invoice_id),
    status: str(raw.status),
    payment_provider: str(raw.payment_provider),
    amount: raw.amount,
    verified_amount: raw.verified_amount,
    payment_source: strOrNull(raw.payment_source),
    paid_at: strOrNull(raw.paid_at),
    verified_at: strOrNull(raw.verified_at),
    created_at: str(raw.created_at),
    invoice: inv ? { status: str(inv.status), quotation: q ? { is_test: q.is_test === true } : null } : null,
  };
}

/**
 * Loads the four CEO figures with the caller's own RLS-bound session (no
 * service role). Super Admin only: the guard is the first statement here as
 * well as in the page, so the data cannot be reached by any other caller.
 */
export async function loadExecutiveKpis(rangeKey: ReportRangeKey, custom?: { from?: string; to?: string }): Promise<ExecutiveKpiResult> {
  await requireRole("super_admin");

  const range = resolveReportDateRange(rangeKey, custom);
  const supabase = await createSupabaseServerClient();
  const start = range.startUtc;
  const end = range.endUtc;
  const billable = [...BILLABLE_INVOICE_STATUSES];

  const invoiceSelect = "id, status, grand_total, tax_amount, balance_due, issued_at, due_date, quotation:sales_quotations!invoices_quotation_id_fkey(is_test)";

  // Independent queries, started together; no await inside the array literal (CLAUDE.md §5/§13).
  const quotationsQuery = supabase
    .from("sales_quotations")
    .select("id, opportunity_id, status, total, tax, accepted_at, is_test, opportunity:sales_opportunities!sales_quotations_opportunity_id_fkey(stage, is_test)")
    .eq("status", "accepted")
    .eq("is_test", false)
    .gte("accepted_at", start)
    .lt("accepted_at", end)
    .range(0, ROW_LIMIT - 1);
  const billedQuery = supabase.from("invoices").select(invoiceSelect).in("status", billable).gte("issued_at", start).lt("issued_at", end).range(0, ROW_LIMIT - 1);
  const openQuery = supabase.from("invoices").select(invoiceSelect).in("status", billable).gt("balance_due", 0).range(0, ROW_LIMIT - 1);
  // Payment date is coalesce(paid_at, verified_at, created_at); PostgREST cannot filter a coalesce, so each fallback is its own branch.
  // The bounds come from toISOString() of our own Date values, never from user text.
  const paymentsQuery = supabase
    .from("invoice_payments")
    .select(
      "id, invoice_id, status, payment_provider, amount, verified_amount, payment_source, paid_at, verified_at, created_at, invoice:invoices!invoice_payments_invoice_id_fkey(status, quotation:sales_quotations!invoices_quotation_id_fkey(is_test))",
    )
    .in("status", ["successful", "refunded"])
    .or(
      `and(paid_at.gte.${start},paid_at.lt.${end}),and(paid_at.is.null,verified_at.gte.${start},verified_at.lt.${end}),and(paid_at.is.null,verified_at.is.null,created_at.gte.${start},created_at.lt.${end})`,
    )
    .range(0, ROW_LIMIT - 1);

  const [quotations, billed, open, payments] = await Promise.all([quotationsQuery, billedQuery, openQuery, paymentsQuery]);

  for (const [name, result] of [
    ["quotations", quotations],
    ["billed invoices", billed],
    ["open invoices", open],
    ["payments", payments],
  ] as const) {
    if (result.error) {
      // Log the failing query and code only: never the message body or any row data.
      console.error("executive KPI query failed", { query: name, code: result.error.code });
      return { ok: false, reason: "query_failed" };
    }
    if ((result.data ?? []).length >= ROW_LIMIT) {
      console.error("executive KPI query exceeded row limit", { query: name, limit: ROW_LIMIT });
      return { ok: false, reason: "too_large" };
    }
  }

  const kpis = computeExecutiveKpis({
    period: { startUtc: start, endUtc: end },
    quotations: (quotations.data ?? []).map((r: Json) => toQuotation(r)),
    billedInvoices: (billed.data ?? []).map((r: Json) => toInvoice(r)),
    openInvoices: (open.data ?? []).map((r: Json) => toInvoice(r)),
    payments: (payments.data ?? []).map((r: Json) => toPayment(r)),
    now: new Date(),
  });
  return { ok: true, range, kpis };
}
