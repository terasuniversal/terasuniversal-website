import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

export const metadata = { title: "Courses — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  await requireRole("editor");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = (supabase
    .from("courses") as any)
    .select("id, title, slug, category, status, featured, updated_at", { count: "exact" })
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) query = query.ilike("title", `%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);

  const { data: courses, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <>
      <PageHead
        title="Courses"
        subtitle="Manage the training programmes shown on the website."
        action={<Link href="/admin/courses/new" className="ta-btn ta-btn-primary">+ New Course</Link>}
      />

      <div className="ta-toolbar">
        <form className="ta-search" style={{ maxWidth: 320 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search courses…" />
        </form>
        <div className="ta-spacer" />
        <form>
          <select name="status" defaultValue={sp.status ?? ""} onChange={undefined} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </form>
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
                      <Link href={`/admin/courses/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🎓" message="No courses yet. Create your first one." />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/courses" query={{ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}) }} />
    </>
  );
}
