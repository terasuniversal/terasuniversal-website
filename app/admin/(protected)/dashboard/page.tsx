import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireStaff } from "../../../../lib/auth/session";
import { StatCard, Card, PageHead, Badge, EmptyState } from "../../../../components/admin/ui";

export const metadata = { title: "Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireStaff();
  // Trainers don't have a general dashboard — send them to their workspace.
  if (profile.role === "trainer") redirect("/admin/attendance");
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const dateLabel = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const [
    coursesCount,
    upcomingCount,
    upcoming,
    latestParticipants,
    certsIssued,
    certsPending,
    participantsCount,
    recentCertificates,
    recentAssessments,
  ] = await Promise.all([
    supabase.from("courses").select("*", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
    supabase.from("course_schedules").select("*", { count: "exact", head: true }).gte("start_date", today).is("deleted_at", null).not("status", "in", "(cancelled)"),
    supabase.from("course_schedules").select("id, schedule_code, start_date, status, capacity, seats_taken, courses(course_name)").gte("start_date", today).is("deleted_at", null).not("status", "in", "(cancelled)").order("start_date", { ascending: true }).limit(6),
    supabase.from("participants").select("id, full_name, company, status, registered_at").is("deleted_at", null).order("registered_at", { ascending: false }).limit(6),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "valid").is("deleted_at", null),
    supabase.from("certificates").select("*", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null),
    supabase.from("participants").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("certificates").select("id, certificate_number, holder_name, status, issue_date").is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
    supabase.from("assessments").select("id, assessment_type, result, theory_score, practical_score, competency_status, assessed_at, participants(full_name)").is("deleted_at", null).order("assessed_at", { ascending: false, nullsFirst: false }).limit(6),
  ]);

  return (
    <>
      <PageHead
        title={`Welcome back, ${(profile.full_name || profile.email).split(" ")[0]}`}
        subtitle="Your training operations at a glance."
        action={
          <div className="ta-page-head-actions">
            <span className="ta-date-chip">{dateLabel}</span>
            <Link className="ta-btn ta-btn-primary" href="/admin/schedules/new">
              + New Schedule
            </Link>
          </div>
        }
      />

      <section className="ta-dashboard-intro" aria-label="Dashboard summary">
        <div>
          <strong>Today&apos;s operations</strong>
          <p>Review upcoming training, participant activity and certificate progress from one workspace.</p>
        </div>
      </section>

      <div className="ta-grid cols-5" style={{ marginBottom: 22 }}>
        <StatCard icon="🎓" label="Published courses" value={coursesCount.count ?? 0} href="/admin/courses" />
        <StatCard icon="🗓" label="Upcoming schedules" value={upcomingCount.count ?? 0} href="/admin/schedules" />
        <StatCard icon="👥" label="Total participants" value={participantsCount.count ?? 0} href="/admin/participants" />
        <StatCard icon="🏅" label="Certificates issued" value={certsIssued.count ?? 0} href="/admin/certificates" />
        <StatCard icon="⏳" label="Certificates draft" value={certsPending.count ?? 0} href="/admin/certificates" />
      </div>

      <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
        <Card title="Upcoming Courses" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">View all</Link>}>
          {upcoming.data && upcoming.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Course</th><th>Start</th><th>Seats</th><th>Status</th></tr></thead>
                <tbody>
                  {upcoming.data.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.courses?.course_name ?? "—"}</td>
                      <td>{new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</td>
                      <td>{s.seats_taken}/{s.capacity}</td>
                      <td><Badge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="🗓"
              title="No upcoming schedules"
              message="Create a new training schedule to see it here."
              action={<Link className="ta-btn ta-btn-primary ta-btn-sm" href="/admin/schedules/new">+ New Schedule</Link>}
            />
          )}
        </Card>

        <Card title="Latest Participants" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/participants">View all</Link>}>
          {latestParticipants.data && latestParticipants.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <tbody>
                  {latestParticipants.data.map((p: any) => (
                    <tr key={p.id}>
                      <td><strong>{p.full_name}</strong>{p.company ? <div className="ta-muted-sub">{p.company}</div> : null}</td>
                      <td><Badge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="👥" title="No participants yet" message="Registered participants will appear here." />
          )}
        </Card>

        <Card title="Recent Certificates" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/certificates">View all</Link>}>
          {recentCertificates.data && recentCertificates.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Certificate</th><th>Holder</th><th>Status</th></tr></thead>
                <tbody>
                  {recentCertificates.data.map((c: any) => (
                    <tr key={c.id}>
                      <td><strong>{c.certificate_number ?? "—"}</strong></td>
                      <td>{c.holder_name ?? "—"}</td>
                      <td><Badge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="🏅" title="No certificates yet" message="Generated certificates will appear here." />
          )}
        </Card>
      </div>

      <div className="ta-grid cols-2" style={{ marginBottom: 22 }}>
        <Card title="Recent Assessments" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/attendance">Attendance & Assessment</Link>}>
          {recentAssessments.data && recentAssessments.data.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Participant</th><th>Type</th><th>Overall</th><th>Result</th></tr></thead>
                <tbody>
                  {recentAssessments.data.map((a: any) => {
                    const overall = a.theory_score != null && a.practical_score != null ? ((a.theory_score + a.practical_score) / 2).toFixed(2) : a.theory_score ?? a.practical_score ?? "—";
                    return (
                      <tr key={a.id}>
                        <td>{a.participants?.full_name ?? "—"}</td>
                        <td>{a.assessment_type ?? "—"}</td>
                        <td>{overall}</td>
                        <td><Badge status={a.result} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="✅" title="No assessments yet" message="Completed assessments will appear here." />
          )}
        </Card>

        <Card title="Quick Actions">
          <div className="ta-card-pad">
            <div className="ta-quick-actions">
              <Link className="ta-btn ta-btn-primary" href="/admin/courses/new">+ New Course</Link>
              <Link className="ta-btn ta-btn-gold" href="/admin/schedules/new">+ New Schedule</Link>
              <Link className="ta-btn ta-btn-outline" href="/admin/participants">Register Participant</Link>
              <Link className="ta-btn ta-btn-outline" href="/admin/certificates">Issue Certificate</Link>
              <Link className="ta-btn ta-btn-outline" href="/admin/news/new">+ News Post</Link>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
