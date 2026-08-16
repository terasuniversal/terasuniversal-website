import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination, Avatar } from "../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../lib/date-time";

export const metadata = { title: "Trainers — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function TrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; employment_type?: string; deleted?: string }>;
}) {
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("trainers")
    .select("id, trainer_id, full_name, department, specialisation, position, employment_type, status, email, phone, trainer_photo, updated_at", { count: "exact" })
    .order("trainer_id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  query = deletedView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q}%,trainer_id.ilike.%${sp.q}%,department.ilike.%${sp.q}%,specialisation.ilike.%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.employment_type) query = query.eq("employment_type", sp.employment_type);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "employment_type", "deleted"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead
        title="Trainers"
        subtitle={deletedView ? "Deleted trainers (restore available)." : "Manage trainers, instructors and training assignments."}
        action={canWrite && !deletedView ? <Link href="/admin/trainers/new" className="ta-btn ta-btn-primary">+ New Trainer</Link> : undefined}
      />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 280 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="ID, name, competency, dept…" aria-label="Search trainers" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          {["active", "inactive", "retired", "on_leave"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select name="employment_type" defaultValue={sp.employment_type ?? ""} className="ta-select" aria-label="Filter by employment type">
          <option value="">All types</option>
          {["Full-time", "Part-time", "Contract", "Freelance", "Associate"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {deletedView && <input type="hidden" name="deleted" value="1" />}
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        <div className="ta-spacer" />
        <a href={`/admin/trainers/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">CSV</a>
        <a href={`/admin/trainers/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">Excel</a>
        <Link href={deletedView ? "/admin/trainers" : "/admin/trainers?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">{deletedView ? "← Active" : "Deleted"}</Link>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Trainer</th>
                  <th>Contact</th>
                  <th>Specialisation</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t: any) => (
                  <tr key={t.id} className={deletedView ? "ta-row-deleted" : undefined}>
                    <td>
                      <div className="ta-cell-main">
                        <Avatar name={t.full_name} src={t.trainer_photo} />
                        <div style={{ minWidth: 0 }}>
                          <strong>{t.full_name}</strong>
                          <div className="ta-cell-sub">
                            {t.trainer_id}
                            {t.position ? ` · ${t.position}` : ""}
                            {t.employment_type ? ` · ${t.employment_type}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {t.email || t.phone ? (
                        <>
                          {t.email && <div><a className="ta-link" href={`mailto:${t.email}`}>{t.email}</a></div>}
                          {t.phone && <div className="ta-cell-sub">{t.phone}</div>}
                        </>
                      ) : (
                        <span className="ta-cell-sub">—</span>
                      )}
                    </td>
                    <td>{t.specialisation ?? <span className="ta-cell-sub">—</span>}</td>
                    <td><Badge status={t.status} /></td>
                    <td className="ta-nowrap">
                      <span className="ta-cell-sub">
                        {t.updated_at ? formatMalaysiaDate(t.updated_at) : "—"}
                      </span>
                    </td>
                    <td className="ta-row-actions">
                      <Link href={`/admin/trainers/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="🧑‍🏫"
            title={deletedView ? "No deleted trainers" : "No trainers yet"}
            message={deletedView ? "Trainers you delete will appear here for restore." : "Add your first trainer to start building the instructor pool."}
            action={canWrite && !deletedView ? <Link href="/admin/trainers/new" className="ta-btn ta-btn-primary">+ New Trainer</Link> : undefined}
          />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/trainers" query={qsBase} />
    </>
  );
}
