import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

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
    .select("id, trainer_id, full_name, department, specialisation, position, employment_type, status", { count: "exact" })
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
        subtitle={deletedView ? "Deleted trainers (restore available)." : "Manage trainers, assessors and instructors."}
        action={canWrite && !deletedView ? <Link href="/admin/trainers/new" className="ta-btn ta-btn-primary">+ Add Trainer</Link> : undefined}
      />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="ID, name, competency, dept…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={sel} aria-label="Status">
          <option value="">All statuses</option>
          {["active", "inactive", "retired", "on_leave"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select name="employment_type" defaultValue={sp.employment_type ?? ""} style={sel} aria-label="Employment type">
          <option value="">All types</option>
          {["Full-time", "Part-time", "Contract", "Freelance", "Associate"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {deletedView && <input type="hidden" name="deleted" value="1" />}
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        <div className="ta-spacer" />
        <a href={`/admin/trainers/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
        <a href={`/admin/trainers/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
        <Link href={deletedView ? "/admin/trainers" : "/admin/trainers?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">{deletedView ? "← Active" : "🗑 Deleted"}</Link>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Trainer ID</th><th>Name</th><th>Department</th><th>Specialisation</th><th>Type</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((t: any) => (
                  <tr key={t.id}>
                    <td><code style={{ fontSize: 12 }}>{t.trainer_id}</code></td>
                    <td><strong>{t.full_name}</strong>{t.position ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{t.position}</div> : null}</td>
                    <td>{t.department ?? "—"}</td>
                    <td>{t.specialisation ?? "—"}</td>
                    <td>{t.employment_type ?? "—"}</td>
                    <td><Badge status={t.status} /></td>
                    <td style={{ textAlign: "right" }}><Link href={`/admin/trainers/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🧑‍🏫" message={deletedView ? "No deleted trainers." : "No trainers yet. Add your first one."} />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/trainers" query={qsBase} />
    </>
  );
}

const sel = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 150 } as const;
