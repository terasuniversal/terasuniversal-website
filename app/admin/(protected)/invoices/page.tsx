import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";
import { sanitizeSearchTerm } from "../../../../lib/sales/crm";
import { INVOICE_STATUS_ORDER, INVOICE_STATUS_LABELS, effectiveInvoiceStatus, type InvoiceRow } from "../../../../lib/sales/invoices";

export const metadata = { title: "Invoices — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type InvoiceListRow = InvoiceRow & { sales_opportunities: { opportunity_no: string; company_name: string | null } | null };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("invoices");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("invoices")
    .select("*, sales_opportunities(opportunity_no, company_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.ilike("invoice_no", `%${term}%`);
  }
  if (sp.status) query = query.eq("status", sp.status);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead title="Invoices" subtitle="All invoices, created from accepted quotations. Create one from a quotation's detail page." />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search invoice no…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Status filter">
          <option value="">All statuses</option>
          {INVOICE_STATUS_ORDER.map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/invoices">Reset filters</Link>}
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr><th>Invoice No</th><th>Company</th><th>Status</th><th>Grand Total</th><th>Paid</th><th>Balance</th><th>Due Date</th><th></th></tr>
              </thead>
              <tbody>
                {(rows as InvoiceListRow[]).map((inv) => (
                  <tr key={inv.id}>
                    <td><code style={{ fontSize: 12 }}>{inv.invoice_no}</code></td>
                    <td>{inv.billing_company ?? inv.sales_opportunities?.company_name ?? inv.billing_name}</td>
                    <td><Badge status={effectiveInvoiceStatus(inv)} /></td>
                    <td>RM {Number(inv.grand_total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td>RM {Number(inv.amount_paid).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td>RM {Number(inv.balance_due).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td>{new Date(inv.due_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td style={{ textAlign: "right" }}><Link href={`/admin/invoices/${inv.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🧾" message="No invoices yet. Create one from an accepted quotation's detail page." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} invoice(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/invoices" query={qsBase} />
      </div>
    </>
  );
}
