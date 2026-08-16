import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireCertificate } from "../../../../lib/auth/session";
import { canManageCertificate } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination, StatCard } from "../../../../components/admin/ui";
import { restoreCertificate } from "./actions";
import { ExportButtons } from "./ExportButtons";

export const metadata = { title: "Certificates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUSES = ["valid", "expired", "revoked"];

export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; course?: string; deleted?: string }>;
}) {
  const profile = await requireCertificate(false);
  await requireModuleAccess("certificates");
  const canManage = canManageCertificate(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const supabase = await createSupabaseServerClient();

  const [{ count: issued }, { count: revoked }, { count: draft }, { data: courses }] = await Promise.all([
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "valid").is("deleted_at", null),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "revoked").is("deleted_at", null),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
    supabase.from("courses").select("id, title").is("deleted_at", null).order("title", { ascending: true }),
  ]);

  let query = supabase
    .from("certificates")
    .select("id, certificate_number, holder_name, status, issue_date, verification_token, courses(title)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  query = deletedView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (sp.q) {
    const term = sp.q.replace(/[%_,()]/g, " ");
    query = query.or(`certificate_number.ilike.%${term}%,holder_name.ilike.%${term}%`);
  }
  if (sp.status && !deletedView) query = query.eq("status", sp.status as any);
  if (sp.course && !deletedView) query = query.eq("course_id", sp.course);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "course"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead
        title="Certificates"
        subtitle={deletedView ? "Deleted certificates (restore available)." : "Generate, verify and manage training certificates."}
        action={
          deletedView ? undefined : (
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/admin/certificates/templates" className="ta-btn ta-btn-outline">🧩 Templates</Link>
              {canManage && <Link href="/admin/certificates/generate" className="ta-btn ta-btn-primary">+ Generate</Link>}
            </div>
          )
        }
      />

      <div className="ta-grid cols-3" style={{ marginBottom: 20 }}>
        <StatCard icon="🏅" label="Issued" value={issued ?? 0} />
        <StatCard icon="📝" label="Draft" value={draft ?? 0} />
        <StatCard icon="⛔" label="Revoked" value={revoked ?? 0} />
      </div>

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 280 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Cert number or holder name…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="course" defaultValue={sp.course ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 240 }} aria-label="Course">
          <option value="">All courses</option>
          {(courses ?? []).map((course: any) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.course) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/certificates">Reset filters</Link>}
        <div className="ta-spacer" />
        {!deletedView && (
          <>
            <ExportButtons exportQs={exportQs} />
            <a href={`/admin/certificates/export?format=register${exportQs ? "&" + exportQs : ""}`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">📄 Register (PDF)</a>
          </>
        )}
        {canManage && (
          <Link href={deletedView ? "/admin/certificates" : "/admin/certificates?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">
            {deletedView ? "← Active" : "🗑 Deleted"}
          </Link>
        )}
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Certificate No.</th><th>Holder</th><th>Course</th><th>Issued</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.id}>
                    <td><code style={{ fontSize: 12 }}>{c.certificate_number}</code></td>
                    <td><strong>{c.holder_name}</strong></td>
                    <td>{c.courses?.title ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{c.issue_date ? new Date(c.issue_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    <td><Badge status={c.status} /></td>
                    <td style={{ textAlign: "right" }}>
                      {deletedView ? (
                        canManage && (
                          <form action={restoreCertificate.bind(null, c.id)}>
                            <button className="ta-btn ta-btn-gold ta-btn-sm" type="submit">Restore</button>
                          </form>
                        )
                      ) : (
                        <Link href={`/admin/certificates/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🏅" message={deletedView ? "No deleted certificates." : "No certificates yet. Generate from an eligible schedule."} />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/certificates" query={{ ...qsBase, ...(deletedView ? { deleted: "1" } : {}) }} />
    </>
  );
}
