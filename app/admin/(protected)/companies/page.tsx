import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

export const metadata = { title: "Companies — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; industry?: string; state?: string; deleted?: string }>;
}) {
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const supabase = await createSupabaseServerClient();

  const { data: industryRows } = await supabase.from("companies").select("industry").is("deleted_at", null).not("industry", "is", null).limit(1000);
  const industries = Array.from(new Set<string>(((industryRows ?? []) as any[]).map((r) => r.industry).filter((value): value is string => typeof value === "string"))).sort();

  let query = supabase
    .from("companies")
    .select("id, company_id, company_name, industry, state, person_in_charge, status", { count: "exact" })
    .order("company_id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  query = deletedView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (sp.q) query = query.or(`company_name.ilike.%${sp.q}%,company_id.ilike.%${sp.q}%,registration_no.ilike.%${sp.q}%,industry.ilike.%${sp.q}%,person_in_charge.ilike.%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.industry) query = query.eq("industry", sp.industry);
  if (sp.state) query = query.eq("state", sp.state);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "industry", "state", "deleted"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead
        title="Companies"
        subtitle={deletedView ? "Deleted companies (restore available)." : "Master database of corporate clients."}
        action={canWrite && !deletedView ? <Link href="/admin/companies/new" className="ta-btn ta-btn-primary">+ Add Company</Link> : undefined}
      />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, reg no, industry, PIC…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={sel} aria-label="Status">
          <option value="">All statuses</option>
          {["active", "inactive", "prospect", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="industry" defaultValue={sp.industry ?? ""} style={sel} aria-label="Industry">
          <option value="">All industries</option>
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        {deletedView && <input type="hidden" name="deleted" value="1" />}
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        <div className="ta-spacer" />
        <a href={`/admin/companies/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
        <a href={`/admin/companies/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
        <Link href={deletedView ? "/admin/companies" : "/admin/companies?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">{deletedView ? "← Active" : "🗑 Deleted"}</Link>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Company ID</th><th>Name</th><th>Industry</th><th>State</th><th>PIC</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.id}>
                    <td><code style={{ fontSize: 12 }}>{c.company_id}</code></td>
                    <td><strong>{c.company_name}</strong></td>
                    <td>{c.industry ?? "—"}</td>
                    <td>{c.state ?? "—"}</td>
                    <td>{c.person_in_charge ?? "—"}</td>
                    <td><Badge status={c.status} /></td>
                    <td style={{ textAlign: "right" }}><Link href={`/admin/companies/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🏢" message={deletedView ? "No deleted companies." : "No companies yet. Add your first client."} />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/companies" query={qsBase} />
    </>
  );
}

const sel = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 160 } as const;
