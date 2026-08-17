import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { OPPORTUNITY_STAGE_ORDER, OPPORTUNITY_STAGE_LABELS, sanitizeSearchTerm, type SalesOpportunityRow } from "../../../../../lib/sales/crm";
import { OpportunityTable } from "./OpportunityTable";

export const metadata = { title: "Opportunities — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * Real Opportunity pipeline (Task 4), replacing the Phase 1C demo page at
 * this same route. Disconnected from lib/sales/opportunities-data.ts
 * entirely — queries public.sales_opportunities directly.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; stage?: string; assigned?: string; from?: string; to?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("sales_opportunities");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  let query = supabase
    .from("sales_opportunities")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) query = query.or(`opportunity_no.ilike.%${term}%,company_name.ilike.%${term}%,contact_person.ilike.%${term}%,title.ilike.%${term}%,programme.ilike.%${term}%`);
  }
  if (sp.stage) query = query.eq("stage", sp.stage);
  if (sp.assigned) query = sp.assigned === "unassigned" ? query.is("assigned_to", null) : query.eq("assigned_to", sp.assigned);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "stage", "assigned", "from", "to"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead title="Opportunities" subtitle="Real pipeline — opportunities converted from qualified leads." />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search opportunity no, company…" />
        </div>
        <select name="stage" defaultValue={sp.stage ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Stage filter">
          <option value="">All stages</option>
          {OPPORTUNITY_STAGE_ORDER.map((s) => <option key={s} value={s}>{OPPORTUNITY_STAGE_LABELS[s]}</option>)}
        </select>
        <select name="assigned" defaultValue={sp.assigned ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 180 }} aria-label="Owner filter">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ta-muted)" }}>
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--ta-muted)" }}>
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} />
        </label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.stage || sp.assigned || sp.from || sp.to) && (
          <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/sales/opportunities">Reset filters</Link>
        )}
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <OpportunityTable rows={rows as SalesOpportunityRow[]} staffNames={staffNames} />
        ) : (
          <EmptyState icon="🎯" message="No opportunities yet. Convert a qualified lead from Lead Detail to create one." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} opportunit{(count ?? 0) === 1 ? "y" : "ies"}</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/opportunities" query={qsBase} />
      </div>
    </>
  );
}
