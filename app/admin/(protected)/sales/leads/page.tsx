import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { CRM_STATUS_ORDER, CRM_STATUS_LABELS, SOURCE_LABELS, sanitizeSearchTerm, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { LeadInboxTable } from "./LeadInboxTable";

export const metadata = { title: "Sales Leads — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function SalesLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string; q?: string; status?: string; source?: string; assigned?: string; from?: string; to?: string;
  }>;
}) {
  await requireRole("editor"); // read allowed for all sales-CRM staff; mutations are admin-gated in actions.ts
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  // Staff list for the "Assigned To" filter + display name lookups.
  const { data: staffRows } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  let query = supabase
    .from("v_sales_lead_inbox")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.or(`contact_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,subject.ilike.%${term}%`);
  }
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.source) query = query.eq("lead_source", sp.source);
  if (sp.assigned) query = sp.assigned === "unassigned" ? query.is("assigned_to", null) : query.eq("assigned_to", sp.assigned);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "source", "assigned", "from", "to"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead title="Sales Leads" subtitle="Unified inbox — public contact enquiries and proposal requests in one pipeline." />

      <form className="ta-toolbar">
        <div className="ta-search">
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, company, email…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-filter-select" aria-label="Status filter">
          <option value="">All statuses</option>
          {CRM_STATUS_ORDER.map((s) => <option key={s} value={s}>{CRM_STATUS_LABELS[s]}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="ta-filter-select" aria-label="Source filter">
          <option value="">All sources</option>
          <option value="enquiry">{SOURCE_LABELS.enquiry}</option>
          <option value="proposal_request">{SOURCE_LABELS.proposal_request}</option>
        </select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} className="ta-filter-select" style={{ maxWidth: 180 }} aria-label="Assigned to filter">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <label className="ta-filter-date-group">
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="ta-filter-date" />
        </label>
        <label className="ta-filter-date-group">
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="ta-filter-date" />
        </label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.source || sp.assigned || sp.from || sp.to) && (
          <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/sales/leads">Reset filters</Link>
        )}
      </form>

      <Card
        title="Lead Inbox"
        action={
          <a href={`/admin/sales/leads/export${exportQs ? "?" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">Export CSV</a>
        }
      >
        {rows && rows.length > 0 ? (
          <LeadInboxTable rows={rows as SalesLeadInboxRow[]} staffNames={staffNames} />
        ) : (
          <EmptyState icon="🧲" message="No leads match this view. Leads appear automatically here as soon as a visitor submits a contact enquiry or a proposal request." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} {count === 1 ? "lead" : "leads"}</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/leads" query={qsBase} />
      </div>
    </>
  );
}
