import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { StatCard, Card, PageHead, Badge, EmptyState } from "../../../../components/admin/ui";

export const metadata = { title: "Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireRole("editor");
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    coursesCount,
    upcoming,
    latestParticipants,
    certsIssued,
    certsPending,
    participantsCount,
    recentAssessments,
  ] = await Promise.all([
    supabase.from("courses").select("*", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
    supabase.from("course_schedules").select("id, start_date, status, capacity, seats_available, courses(title)").gte("start_date", today).is("deleted_at", null).order("start_date", { ascending: true }).limit(6),
    supabase.from("participants").select("id, full_name, company, status, registered_at").is("deleted_at", null).order("registered_at", { ascending: false }).limit(6),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "issued").is("deleted_at", null),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "pending").is("deleted_at", null),
    supabase.from("participants").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("assessments").select("id, assessment_type, result, score, assessed_at, participants(full_name)").order("assessed_at", { ascending: false, nullsFirst: false }).limit(6),
  ]);

  return (
    <>
      <PageHead
        title={`Welcome back, ${(profile.full_name || profile.email).split(" ")[0]}`}
        subtitle="Your training operations at a glance."
      />

      <div className="ta-grid cols-4" style={{ marginBottom: 22 }}>
        <StatCard icon="🎓" label="Published courses" value={coursesCount.count ?? 0} href="/admin/courses" />
        <StatCard icon="👥" label="Total participants" value={participantsCount.count ?? 0} href="/admin/participants" />
        <StatCard icon="🏅" label="Certificates issued" value={certsIssued.count ?? 0} href="/admin/certificates" />
        <StatCard icon="⏳" label="Certificates pending" value={certsPending.count ?? 0} href="/admin/certificates" />
      </div>

      <div className="ta-grid cols-2" style={{ marginBottom: 22 }}>
        <Card title="Upcoming Courses" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">View all</Link>}>
          {upcoming.data && upcoming.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Course</th><th>Start</th><th>Seats</th><th>Status</th></tr></thead>
                <tbody>
                  {upcoming.data.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.courses?.title ?? "—"}</td>
                      <td>{new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</td>
                      <td>{s.seats_available}/{s.capacity}</td>
                      <td><Badge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="🗓" message="No upcoming schedules. Add one from Training Schedule." />
          )}
        </Card>

        <Card title="Latest Participants" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/participants">View all</Link>}>
          {latestParticipants.data && latestParticipants.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <tbody>
                  {latestParticipants.data.map((p: any) => (
                    <tr key={p.id}>
                      <td><strong>{p.full_name}</strong>{p.company ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{p.company}</div> : null}</td>
                      <td><Badge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="👥" message="No participants recorded yet." />
          )}
        </Card>
      </div>

      <div className="ta-grid cols-2" style={{ marginBottom: 22 }}>
        <Card title="Recent Assessments" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/attendance">Attendance & Assessment</Link>}>
          {recentAssessments.data && recentAssessments.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Participant</th><th>Type</th><th>Score</th><th>Result</th></tr></thead>
                <tbody>
                  {recentAssessments.data.map((a: any) => (
                    <tr key={a.id}>
                      <td>{a.participants?.full_name ?? "—"}</td>
                      <td>{a.assessment_type ?? "—"}</td>
                      <td>{a.score ?? "—"}</td>
                      <td><Badge status={a.result} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="✅" message="No assessments recorded yet." />
          )}
        </Card>

        <Card title="Quick Actions">
          <div className="ta-card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="ta-btn ta-btn-primary" href="/admin/courses/new">+ New Course</Link>
            <Link className="ta-btn ta-btn-gold" href="/admin/schedules/new">+ New Schedule</Link>
            <Link className="ta-btn ta-btn-outline" href="/admin/participants">Register Participant</Link>
            <Link className="ta-btn ta-btn-outline" href="/admin/certificates">Issue Certificate</Link>
            <Link className="ta-btn ta-btn-outline" href="/admin/news/new">+ News Post</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
