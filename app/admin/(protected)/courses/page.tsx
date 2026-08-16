import type { ReactNode } from "react";
import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination, StatCard, SvgIcon } from "../../../../components/admin/ui";
import { restoreCourse } from "./actions";
import { formatMalaysiaDate } from "../../../../lib/date-time";

export const metadata = { title: "Courses — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; deleted?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("courses");
  const canRestore = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const supabase = await createSupabaseServerClient();

  // KPI data is only meaningful for the active (non-deleted) view. Head-only
  // read counts, derived from existing columns/statuses. IMPORTANT: postgrest-js
  // v2 builders MUTATE in place (`.eq()` returns `this`), so every count query
  // must be built from a fresh `.from()` chain — sharing one builder would fold
  // all filters into a single impossible query and report 0 for every card.
  // A failed count logs a sanitized message and omits that card (never 0).
  let kpis: { label: string; value: number | null; icon: ReactNode; href?: string }[] = [];
  if (!deletedView) {
    const kpiBase = () => supabase.from("courses").select("*", { count: "exact", head: true }).is("deleted_at", null);
    const [total, published, draft, featured] = await Promise.all([
      kpiBase(),
      kpiBase().eq("status", "published"),
      kpiBase().eq("status", "draft"),
      kpiBase().eq("featured", true),
    ]);
    const kpiCount = (r: { count: number | null; error: { message: string } | null }, label: string): number | null => {
      if (r.error) {
        console.error(`KPI count "${label}" failed: ${r.error.message}`);
        return null;
      }
      return r.count ?? null;
    };
    kpis = [
      { label: "Total courses", value: kpiCount(total, "total"), icon: <SvgIcon><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></SvgIcon>, href: "/admin/courses" },
      { label: "Published", value: kpiCount(published, "published"), icon: <SvgIcon><path d="M9 11.5 11 13.5 15.5 9" /><rect x="3.5" y="4.5" width="17" height="16" rx="2" /></SvgIcon>, href: "/admin/courses?status=published" },
      { label: "Draft", value: kpiCount(draft, "draft"), icon: <SvgIcon><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></SvgIcon>, href: "/admin/courses?status=draft" },
      { label: "Featured", value: kpiCount(featured, "featured"), icon: <SvgIcon><path d="M12 3v12" /><path d="M8 7 12 3l4 4" /><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" /></SvgIcon> },
    ];
  }

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
        subtitle={deletedView ? "Deleted courses (restore available)." : "Manage TERAS training programmes and website course content."}
        action={
          deletedView ? undefined : <Link href="/admin/courses/new" className="ta-btn ta-btn-primary">+ New Course</Link>
        }
      />

      {kpis.some((k) => k.value != null) && (
        <div className="ta-kpi-grid">
          {kpis.filter((k) => k.value != null).map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} href={k.href} />
          ))}
        </div>
      )}

      <form className="ta-toolbar">
        <div className="ta-search" style={{ maxWidth: 300 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search courses…" aria-label="Search courses" />
        </div>
        {!deletedView && (
          <select name="status" defaultValue={sp.status ?? ""} className="ta-select" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        )}
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {deletedView && <input type="hidden" name="deleted" value="1" />}
        <div className="ta-spacer" />
        {canRestore && (
          <Link href={deletedView ? "/admin/courses" : "/admin/courses?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">
            {deletedView ? "← Active courses" : "Deleted courses"}
          </Link>
        )}
      </form>

      <Card>
        {courses && courses.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Featured</th>
                  <th>Updated</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c: any) => (
                  <tr key={c.id} className={deletedView ? "ta-row-deleted" : undefined}>
                    <td>
                      <div className="ta-cell-main">
                        <strong>{c.title}</strong>
                      </div>
                      <div className="ta-cell-sub">/{c.slug}</div>
                    </td>
                    <td>{c.category ?? <span className="ta-cell-sub">—</span>}</td>
                    <td><Badge status={c.status} /></td>
                    <td>{c.featured ? <span className="ta-badge-pill featured">Featured</span> : <span className="ta-cell-sub">—</span>}</td>
                    <td className="ta-nowrap">
                      <span className="ta-cell-sub">
                        {formatMalaysiaDate(c.updated_at)}
                      </span>
                    </td>
                    <td className="ta-row-actions">
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
          <EmptyState
            icon="🎓"
            title={deletedView ? "No deleted courses" : "No courses yet"}
            message={deletedView ? "Courses you delete will appear here for restore." : "Create your first course to start publishing training programmes."}
            action={!deletedView ? <Link href="/admin/courses/new" className="ta-btn ta-btn-primary">+ New Course</Link> : undefined}
          />
        )}
      </Card>

      <Pagination
        page={page}
        pageCount={pageCount}
        basePath="/admin/courses"
        query={{
          ...(sp.q ? { q: sp.q } : {}),
          ...(sp.status && !deletedView ? { status: sp.status } : {}),
          ...(deletedView ? { deleted: "1" } : {}),
        }}
      />
    </>
  );
}
