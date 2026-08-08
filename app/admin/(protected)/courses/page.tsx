import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";
import { restoreCourse } from "./actions";

export const metadata = { title: "Courses — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; deleted?: string }>;
}) {
  const profile = await requireRole("editor");
  const canRestore = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("courses")
    .select("id, title, slug, category, status, featured, updated_at", { count: "exact" })
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  query = deletedView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (sp.q) query = query.ilike("title", `%${sp.q}%`);
  if (sp.status && !deletedView) query = query.eq("status", sp.status as any);

  const { data: courses, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <>
      <PageHead
        title="Courses"
        subtitle={deletedView ? "Deleted courses (restore available)." : "Manage the training programmes shown on the website."}
        action={
          deletedView ? undefined : <Link href="/admin/courses/new" className="ta-btn ta-btn-primary">+ New Course</Link>
        }
      />

      <div className="ta-toolbar">
        <form className="ta-search" style={{ maxWidth: 320 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search courses…" />
          {deletedView && <input type="hidden" name="deleted" value="1" />}
        </form>
        {!deletedView && (
          <form>
            <select name="status" defaultValue={sp.status ?? ""} onChange={undefined} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }}>
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </form>
        )}
        <div className="ta-spacer" />
        {canRestore && (
          <Link href={deletedView ? "/admin/courses" : "/admin/courses?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">
            {deletedView ? "← Active courses" : "🗑 Deleted courses"}
          </Link>
        )}
      </div>

      <Card>
        {courses && courses.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Featured</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.title}</strong>
                      <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>/{c.slug}</div>
                    </td>
                    <td>{c.category ?? "—"}</td>
                    <td><Badge status={c.status} /></td>
                    <td>{c.featured ? "★" : "—"}</td>
                    <td style={{ color: "var(--ta-muted)" }}>
                      {new Date(c.updated_at).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {deletedView ? (
                        canRestore && (
                          <form action={restoreCourse.bind(null, c.id)}>
                            <button className="ta-btn ta-btn-gold ta-btn-sm" type="submit">Restore</button>
                          </form>
                        )
                      ) : (
                        <Link href={`/admin/courses/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Edit</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🎓" message={deletedView ? "No deleted courses." : "No courses yet. Create your first one."} />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/courses" query={{ ...(sp.q ? { q: sp.q } : {}), ...(sp.status && !deletedView ? { status: sp.status } : {}), ...(deletedView ? { deleted: "1" } : {}) }} />
    </>
  );
}
