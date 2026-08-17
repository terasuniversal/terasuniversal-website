import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../lib/date-time";
import { setAssessorActive } from "./actions";

export const metadata = { title: "Assessors — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AssessorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  await requireRole("admin");
  await requireModuleAccess("assessors");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("assessors")
    .select("id, full_name, ic_passport_no, organization, qualification, email, phone, is_active, updated_at", { count: "exact" })
    .order("full_name", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q}%,organization.ilike.%${sp.q}%,ic_passport_no.ilike.%${sp.q}%`);
  if (sp.status === "active") query = query.eq("is_active", true);
  if (sp.status === "inactive") query = query.eq("is_active", false);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead
        title="Assessors"
        subtitle="Manage the assessor pool and who verifies each training schedule."
        action={<Link href="/admin/assessors/new" className="ta-btn ta-btn-primary">+ New Assessor</Link>}
      />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 280 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, organization, IC…" aria-label="Search assessors" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Assessor</th>
                  <th>IC / Passport</th>
                  <th>Organization</th>
                  <th>Qualification</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a: any) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.full_name}</strong>
                      {a.email && <div className="ta-cell-sub">{a.email}</div>}
                    </td>
                    <td>{a.ic_passport_no ?? <span className="ta-cell-sub">—</span>}</td>
                    <td>{a.organization ?? <span className="ta-cell-sub">—</span>}</td>
                    <td>{a.qualification ?? <span className="ta-cell-sub">—</span>}</td>
                    <td><Badge status={a.is_active ? "active" : "inactive"} /></td>
                    <td className="ta-nowrap">
                      <span className="ta-cell-sub">{a.updated_at ? formatMalaysiaDate(a.updated_at) : "—"}</span>
                    </td>
                    <td className="ta-row-actions">
                      <Link href={`/admin/assessors/${a.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                      <form action={setAssessorActive.bind(null, a.id, !a.is_active)} style={{ display: "inline" }}>
                        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" title={a.is_active ? "Deactivate assessor" : "Activate assessor"}>
                          {a.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="🗒️"
            title="No assessors yet"
            message="Add your first assessor to start assigning assessor verification to training schedules."
            action={<Link href="/admin/assessors/new" className="ta-btn ta-btn-primary">+ New Assessor</Link>}
          />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/assessors" query={qsBase} />
    </>
  );
}
