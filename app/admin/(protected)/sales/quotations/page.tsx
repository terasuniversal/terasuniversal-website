import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { QUOTATION_STATUS_ORDER, QUOTATION_STATUS_LABELS, revisionLabel, sanitizeSearchTerm, type SalesQuotationRow } from "../../../../../lib/sales/crm";

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
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr><th>Quotation No</th><th>Revision</th><th>Company</th><th>Status</th><th>Total</th><th>Valid Until</th><th></th></tr>
              </thead>
              <tbody>
                {(rows as (SalesQuotationRow & { sales_opportunities: { opportunity_no: string; company_name: string | null } | null })[]).map((q) => (
                  <tr key={q.id}>
                    <td><code style={{ fontSize: 12 }}>{q.quotation_no}</code></td>
                    <td>{revisionLabel(q.revision_no)}</td>
                    <td>{q.sales_opportunities?.company_name ?? "—"}</td>
                    <td><Badge status={q.status} /></td>
                    <td>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td>{q.valid_until ? new Date(q.valid_until).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    <td style={{ textAlign: "right" }}><Link href={`/admin/sales/quotations/${q.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
