import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { FOLLOW_UP_STATE_LABELS, QUOTATION_STATUS_ORDER, QUOTATION_STATUS_LABELS, revisionLabel, sanitizeSearchTerm, type SalesQuotationRow, type SalesTaskRow } from "../../../../../lib/sales/crm";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../lib/date-time";
import { dueDateState } from "../../../../../lib/sales/crm";
import { invoiceStatusLabel, paymentVisibilityLabel, pickNextQuotationTask, QUOTATION_EXPIRY_LABELS, quotationExpiryState } from "../../../../../lib/sales/quotation-workflow";

export const metadata = { title: "Quotations — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * Real quotation list, replacing the Phase 1D demo page at this same
 * route. Not explicitly requested by Phase 2's task list (which only asks
 * for /quotations/new and /quotations/[id]) but required so the "Quotations"
 * nav entry doesn't land staff on demo data — quotations are still always
 * created from an Opportunity, this is a read-only index across all of them.
 */
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("sales_quotations")
    .select("*, sales_opportunities(opportunity_no, company_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.ilike("quotation_no", `%${term}%`);
  }
  if (sp.status) query = query.eq("status", sp.status);

  const { data: rows, count } = await query;
  const quotationRows = (rows ?? []) as (SalesQuotationRow & { sales_opportunities: { opportunity_no: string; company_name: string | null } | null })[];
  const quotationIds = quotationRows.map((row) => row.id);
  const [{ data: taskRows }, { data: invoiceRows }] = quotationIds.length > 0
    ? await Promise.all([
        supabase.from("sales_tasks").select("*").in("quotation_id", quotationIds).is("deleted_at", null).not("status", "in", "(completed,cancelled)"),
        supabase.from("invoices").select("id, quotation_id, invoice_no, status, grand_total, amount_paid, balance_due").in("quotation_id", quotationIds),
      ])
    : [{ data: [] }, { data: [] }];
  const tasksByQuotation = new Map<string, SalesTaskRow[]>();
  for (const task of (taskRows ?? []) as SalesTaskRow[]) {
    if (!task.quotation_id) continue;
    const list = tasksByQuotation.get(task.quotation_id) ?? [];
    list.push(task);
    tasksByQuotation.set(task.quotation_id, list);
  }
  type InvoiceListRow = {
    id: string;
    quotation_id: string;
    invoice_no: string;
    status: string;
    grand_total: number;
    amount_paid: number;
    balance_due: number;
  };
  const invoiceByQuotation = new Map<string, InvoiceListRow>();
  for (const invoice of (invoiceRows ?? []) as InvoiceListRow[]) invoiceByQuotation.set(invoice.quotation_id, invoice);
  const invoiceIds = Array.from(invoiceByQuotation.values()).map((invoice) => invoice.id).filter(Boolean);
  const { data: paymentRows } = invoiceIds.length > 0
    ? await supabase.from("invoice_payments").select("invoice_id, status").in("invoice_id", invoiceIds)
    : { data: [] };
  const paymentStatusesByInvoice = new Map<string, string[]>();
  for (const payment of (paymentRows ?? []) as { invoice_id: string; status: string }[]) {
    const statuses = paymentStatusesByInvoice.get(payment.invoice_id) ?? [];
    statuses.push(payment.status);
    paymentStatusesByInvoice.set(payment.invoice_id, statuses);
  }
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead title="Quotations" subtitle="All quotations across every opportunity. Create new ones from an Opportunity's detail page." />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search quotation no…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Status filter">
          <option value="">All statuses</option>
          {QUOTATION_STATUS_ORDER.map((s) => <option key={s} value={s}>{QUOTATION_STATUS_LABELS[s]}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/sales/quotations">Reset filters</Link>}
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <>
            <div className="ta-table-wrap ta-q-table">
              <table className="ta-table">
                <thead>
                  <tr><th>Quotation No</th><th>Revision</th><th>Company</th><th>Status</th><th>Total</th><th>Valid Until</th><th>Next Action</th><th></th></tr>
                </thead>
                <tbody>
                  {quotationRows.map((q) => {
                    const task = pickNextQuotationTask(tasksByQuotation.get(q.id) ?? []);
                    const invoice = invoiceByQuotation.get(q.id);
                    const expiry = quotationExpiryState(q.valid_until);
                    const taskState = task ? dueDateState(task.due_at) : "none";
                    return (
                    <tr key={q.id}>
                      <td><code style={{ fontSize: 12 }}>{q.quotation_no}</code></td>
                      <td>{revisionLabel(q.revision_no)}</td>
                      <td>{q.sales_opportunities?.company_name ?? "—"}</td>
                      <td><div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}><Badge status={q.status} /><span style={{ fontSize: 11, color: expiry === "expired" ? "var(--ta-danger)" : "var(--ta-muted)" }}>{QUOTATION_EXPIRY_LABELS[expiry]}</span></div></td>
                      <td>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                      <td><div>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "—"}</div>{task && <div style={{ fontSize: 11, color: taskState === "overdue" ? "var(--ta-danger)" : "var(--ta-muted)", maxWidth: 190, overflowWrap: "anywhere" }}>{task.title} · {task.due_at ? formatMalaysiaDateTime(task.due_at) : "No due date"}</div>}{invoice && <div style={{ fontSize: 11, color: "var(--ta-muted)" }}>Invoice: {invoiceStatusLabel(invoice.status)} · {paymentVisibilityLabel(invoice.status, paymentStatusesByInvoice.get(invoice.id) ?? [])}</div>}</td>
                      <td>{task ? <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 190, overflowWrap: "anywhere" }}><strong>{task.title}</strong><span style={{ fontSize: 11, color: taskState === "overdue" ? "var(--ta-danger)" : "var(--ta-muted)" }}>{task.due_at ? `${FOLLOW_UP_STATE_LABELS[taskState]} · ${formatMalaysiaDateTime(task.due_at)}` : "No due date"}</span></div> : <span style={{ color: "var(--ta-muted)" }}>No Follow-up</span>}</td>
                      <td style={{ textAlign: "right" }}><Link href={`/admin/sales/quotations/${q.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="ta-lead-cards">
              {quotationRows.map((q) => {
                const task = pickNextQuotationTask(tasksByQuotation.get(q.id) ?? []);
                const invoice = invoiceByQuotation.get(q.id);
                const expiry = quotationExpiryState(q.valid_until);
                const taskState = task ? dueDateState(task.due_at) : "none";
                return (
                <li className="ta-card ta-lead-card" key={q.id}>
                  <div className="ta-lead-card-top">
                    <code style={{ fontSize: 12 }}>{q.quotation_no}</code>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}><Badge status={q.status} /><span style={{ fontSize: 11, color: expiry === "expired" ? "var(--ta-danger)" : "var(--ta-muted)" }}>{QUOTATION_EXPIRY_LABELS[expiry]}</span></div>
                  </div>
                  <div className="ta-lead-card-company">
                    <strong>{q.sales_opportunities?.company_name ?? "—"}</strong>
                  </div>
                  <div className="ta-lead-card-grid">
                    <span>Revision</span>
                    <span>{revisionLabel(q.revision_no)}</span>
                    <span>Total</span>
                    <span>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                    <span>Valid Until</span>
                    <span>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "—"}</span>
                    <span>Next Action</span>
                    <span style={{ overflowWrap: "anywhere", color: taskState === "overdue" ? "var(--ta-danger)" : undefined }}>{task ? `${task.title} · ${task.due_at ? `${FOLLOW_UP_STATE_LABELS[taskState]} · ${formatMalaysiaDateTime(task.due_at)}` : "No due date"}` : "No Follow-up"}</span>
                    {invoice && <><span>Invoice</span><span>{invoice.invoice_no} · {invoiceStatusLabel(invoice.status)} · {paymentVisibilityLabel(invoice.status, paymentStatusesByInvoice.get(invoice.id) ?? [])}</span></>}
                  </div>
                  <div className="ta-lead-card-action">
                    <Link href={`/admin/sales/quotations/${q.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View quotation →</Link>
                  </div>
                </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState icon="📄" message="No quotations yet. Create one from an Opportunity's detail page." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} quotation(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/quotations" query={qsBase} />
      </div>
    </>
  );
}
