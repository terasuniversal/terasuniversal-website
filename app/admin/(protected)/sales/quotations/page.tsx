import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination, ListToolbar, ReadErrorState } from "../../../../../components/admin/ui";
import { FOLLOW_UP_STATE_LABELS, QUOTATION_STATUS_ORDER, QUOTATION_STATUS_LABELS, revisionLabel, sanitizeSearchTerm, type SalesQuotationRow, type SalesTaskRow } from "../../../../../lib/sales/crm";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../lib/date-time";
import { dueDateState } from "../../../../../lib/sales/crm";
import { invoiceStatusLabel, paymentVisibilityLabel, pickNextQuotationTask, QUOTATION_EXPIRY_LABELS, quotationExpiryState } from "../../../../../lib/sales/quotation-workflow";
import { buildQuotationSearchFilter } from "../../../../../lib/sales/search";
import { clampPage, normalizePage, pageCountFor, pageRange } from "../../../../../lib/sales/pagination";

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
  let page = normalizePage(sp.page);
  const supabase = await createSupabaseServerClient();

  const term = sp.q ? sanitizeSearchTerm(sp.q) : "";
  let matchingOpportunityIds: string[] = [];
  let opportunitySearchError: unknown = null;
  if (term) {
    const { data: matchingOpportunities, error } = await supabase
      .from("sales_opportunities")
      .select("id")
      .or(`company_name.ilike.%${term}%,contact_person.ilike.%${term}%`);
    opportunitySearchError = error;
    matchingOpportunityIds = (matchingOpportunities ?? []).map((opportunity: { id: string }) => opportunity.id);
  }

  let query = supabase
    .from("sales_quotations")
    .select("*, sales_opportunities(opportunity_no, company_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (term) query = query.or(buildQuotationSearchFilter(term, matchingOpportunityIds));
  if (sp.status) query = query.eq("status", sp.status);

  const requestedRange = pageRange(page, PAGE_SIZE);
  let { data: rows, count, error: quotationReadError } = await query.range(requestedRange.from, requestedRange.to);
  let pageCount = pageCountFor(count ?? 0, PAGE_SIZE);
  const clampedPage = clampPage(page, pageCount);
  if (clampedPage !== page) {
    page = clampedPage;
    const correctedRange = pageRange(page, PAGE_SIZE);
    const correctedResult = await query.range(correctedRange.from, correctedRange.to);
    rows = correctedResult.data;
    count = correctedResult.count;
    quotationReadError = correctedResult.error;
    pageCount = pageCountFor(count ?? 0, PAGE_SIZE);
  }
  const quotationRows = (rows ?? []) as (SalesQuotationRow & { sales_opportunities: { opportunity_no: string; company_name: string | null } | null })[];
  const quotationIds = quotationRows.map((row) => row.id);
  const [{ data: taskRows, error: taskReadError }, { data: invoiceRows, error: invoiceReadError }] = quotationIds.length > 0
    ? await Promise.all([
        supabase.from("sales_tasks").select("*").in("quotation_id", quotationIds).is("deleted_at", null).not("status", "in", "(completed,cancelled)"),
        supabase.from("invoices").select("id, quotation_id, invoice_no, status, grand_total, amount_paid, balance_due").in("quotation_id", quotationIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
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
  const { data: paymentRows, error: paymentReadError } = invoiceIds.length > 0
    ? await supabase.from("invoice_payments").select("invoice_id, status").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  const paymentStatusesByInvoice = new Map<string, string[]>();
  for (const payment of (paymentRows ?? []) as { invoice_id: string; status: string }[]) {
    const statuses = paymentStatusesByInvoice.get(payment.invoice_id) ?? [];
    statuses.push(payment.status);
    paymentStatusesByInvoice.set(payment.invoice_id, statuses);
  }
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const filtersApplied = Object.keys(qsBase).length > 0;
  const activeFilterCount = Object.keys(qsBase).length;
  const hasReadError = Boolean(opportunitySearchError || quotationReadError || taskReadError || invoiceReadError || paymentReadError);

  return (
    <>
      <PageHead title="Quotations" subtitle="All quotations across every opportunity. Create new ones from an Opportunity's detail page." />

      <ListToolbar style={{ alignItems: "flex-end" }}>
        <div className="ta-search">
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" aria-label="Search quotations" defaultValue={sp.q ?? ""} placeholder="Search quotation no, company, contact…" />
        </div>
        <div className="ta-filter-group" role="group" aria-label="Quotation filters">
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status filter">
            <option value="">All statuses</option>
            {QUOTATION_STATUS_ORDER.map((s) => <option key={s} value={s}>{QUOTATION_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </ListToolbar>
      {activeFilterCount > 0 && <div className="ta-filter-summary" aria-live="polite"><span>{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}</span><Link href="/admin/sales/quotations" className="ta-link">Clear all</Link></div>}

      <Card>
        {hasReadError ? <ReadErrorState message="Quotation records or related customer, task, invoice, or payment context could not be loaded. Retry the page; read failures are not shown as an empty list." /> : rows && rows.length > 0 ? (
          <>
            <div className="ta-table-wrap ta-q-table">
              <table className="ta-table">
                <thead>
                  <tr><th>Quotation / Revision</th><th>Customer / Opportunity</th><th>Status / Expiry</th><th>Total</th><th>Issue / Validity</th><th>Invoice / Next Action</th><th></th></tr>
                </thead>
                <tbody>
                  {quotationRows.map((q) => {
                    const task = pickNextQuotationTask(tasksByQuotation.get(q.id) ?? []);
                    const invoice = invoiceByQuotation.get(q.id);
                    const expiry = quotationExpiryState(q.valid_until);
                    const taskState = task ? dueDateState(task.due_at) : "none";
                    return (
                    <tr key={q.id}>
                      <td><Link href={`/admin/sales/quotations/${q.id}`} className="ta-sales-record-link"><code style={{ fontSize: 12 }}>{q.quotation_no}</code></Link><div className="ta-lead-sub">{revisionLabel(q.revision_no)}{q.superseded_at ? " · Superseded" : ""}</div></td>
                      <td>{q.sales_opportunities?.company_name ?? "—"}<div className="ta-lead-sub">{q.sales_opportunities?.opportunity_no ? <Link href={`/admin/sales/opportunities/${q.opportunity_id}`}>{q.sales_opportunities.opportunity_no}</Link> : "Opportunity context unavailable"}</div></td>
                      <td><div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}><Badge status={q.status} />{q.superseded_at && <span className="ta-badge-pill ta-badge-muted">Superseded revision</span>}<span style={{ fontSize: 11, color: expiry === "expired" ? "var(--ta-danger)" : "var(--ta-muted)" }}>{QUOTATION_EXPIRY_LABELS[expiry]}</span></div></td>
                      <td>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                      <td><div>Issued {formatMalaysiaDate(q.issue_date)}</div><div className="ta-lead-sub">Valid to {q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry"}</div>{q.sent_at && <div className="ta-lead-sub">Sent {formatMalaysiaDate(q.sent_at)}</div>}</td>
                      <td>{invoice ? <div><strong>{invoice.invoice_no}</strong><div className="ta-lead-sub">{invoiceStatusLabel(invoice.status)} · {paymentVisibilityLabel(invoice.status, paymentStatusesByInvoice.get(invoice.id) ?? [])}</div></div> : task ? <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 190, overflowWrap: "anywhere" }}><strong>{task.title}</strong><span className="ta-lead-sub" style={{ color: taskState === "overdue" ? "var(--ta-danger)" : undefined }}>{task.due_at ? `${FOLLOW_UP_STATE_LABELS[taskState]} · ${formatMalaysiaDateTime(task.due_at)}` : "No due date"}</span></div> : <span className="ta-lead-sub">No invoice or active follow-up</span>}</td>
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
                    <Link href={`/admin/sales/quotations/${q.id}`} className="ta-sales-record-link"><code style={{ fontSize: 12 }}>{q.quotation_no}</code></Link>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}><Badge status={q.status} />{q.superseded_at && <span className="ta-badge-pill ta-badge-muted">Superseded</span>}<span style={{ fontSize: 11, color: expiry === "expired" ? "var(--ta-danger)" : "var(--ta-muted)" }}>{QUOTATION_EXPIRY_LABELS[expiry]}</span></div>
                  </div>
                  <div className="ta-lead-card-company">
                    <strong>{q.sales_opportunities?.company_name ?? "—"}</strong>
                    {q.sales_opportunities?.opportunity_no && <div className="ta-lead-sub"><Link href={`/admin/sales/opportunities/${q.opportunity_id}`}>{q.sales_opportunities.opportunity_no}</Link></div>}
                  </div>
                  <div className="ta-lead-card-grid">
                    <span>Revision</span>
                    <span>{revisionLabel(q.revision_no)}{q.superseded_at ? " · Superseded; view history only" : ""}</span>
                    <span>Total</span>
                    <span>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                    <span>Valid Until</span>
                    <span>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "—"}</span>
                    <span>Issued</span><span>{formatMalaysiaDate(q.issue_date)}</span>
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
          <EmptyState icon="📄" kind={filtersApplied ? "no-results" : "empty"} message={filtersApplied ? "No quotations match these filters." : "No quotations yet. Create one from an Opportunity's detail page."} />
        )}
      </Card>

      {!hasReadError && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} quotation(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/quotations" query={qsBase} />
      </div>}
    </>
  );
}
