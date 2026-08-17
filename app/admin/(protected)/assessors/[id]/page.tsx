import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { formatMalaysiaDateTime } from "../../../../../lib/date-time";
import { setAssessorActive } from "../actions";

export const metadata = { title: "Assessor — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function AssessorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  await requireModuleAccess("assessors");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: assessor } = await supabase.from("assessors").select("*").eq("id", id).single();
  if (!assessor) notFound();

  // Historical + current primary assignments (deactivating keeps these rows).
  const { data: assignments } = await supabase
    .from("schedule_assessors")
    .select("id, is_primary, assigned_at, course_schedules(id, schedule_code, start_date, end_date, courses(course_name))")
    .eq("assessor_id", id)
    .order("assigned_at", { ascending: false });

  const dl = { display: "grid", gridTemplateColumns: "160px 1fr", gap: 4, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={assessor.full_name}
        subtitle="Assessor profile"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/assessors" className="ta-btn ta-btn-outline">← Back</Link>
            <Link href={`/admin/assessors/${id}/edit`} className="ta-btn ta-btn-primary">Edit</Link>
            <form action={setAssessorActive.bind(null, id, !assessor.is_active)}>
              <button type="submit" className="ta-btn ta-btn-outline">
                {assessor.is_active ? "Deactivate" : "Activate"}
              </button>
            </form>
          </div>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Badge status={assessor.is_active ? "active" : "inactive"} />
      </div>

      <div className="ta-grid cols-2">
        <Card title="Assessor details">
          <div className="ta-card-pad">
            <dl style={dl}>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Full name</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.full_name}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>IC / Passport</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.ic_passport_no ?? "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Phone</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.phone ?? "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Email</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.email ? <a className="ta-link" href={`mailto:${assessor.email}`}>{assessor.email}</a> : "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Organization</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.organization ?? "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Qualification</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.qualification ?? "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Notes</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessor.notes ?? "—"}</dd>
              <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Updated</dt><dd style={{ margin: 0, padding: "6px 0" }}>{formatMalaysiaDateTime(assessor.updated_at)}</dd>
            </dl>
          </div>
        </Card>

        <Card title={`Schedule assignments (${assignments?.length ?? 0})`}>
          <div className="ta-card-pad">
            {assignments && assignments.length > 0 ? (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <tbody>
                    {(assignments as any[]).map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{(a as any).course_schedules?.courses?.course_name ?? "—"}</strong>
                          <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>
                            {(a as any).course_schedules?.schedule_code ?? "—"}
                            {(a as any).course_schedules ? ` · ${(a as any).course_schedules.start_date} – ${(a as any).course_schedules.end_date}` : ""}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {(a as any).course_schedules ? (
                            <Link href={`/admin/schedules/${(a as any).course_schedules.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Open schedule</Link>
                          ) : (
                            <span className="ta-cell-sub">Schedule removed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="🗓️" message="No schedule assignments yet. Assign this assessor from a Training Schedule." />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
