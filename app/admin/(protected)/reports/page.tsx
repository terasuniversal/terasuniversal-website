import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, Badge, EmptyState } from "../../../../components/admin/ui";
import { BarChart, LineChart, DonutChart, type Point } from "../../../../components/admin/Charts";
import { formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Reports & Analytics — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const headCount = (supabase: any, table: string, filters: (q: any) => any = (q) => q) =>
  filters(supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null));

export default async function ReportsPage() {
  await requireRole("editor");
  await requireModuleAccess("reports");
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  // --- KPIs (parallel head counts + view reads) ---
  const [
    participants, companies, courses, schedules, trainers, certsIssued,
    activeCourses, upcomingCourses, attBreakdown, passFail,
    partPerMonth, schedPerMonth, certPerMonth, attTrend, topCompanies, topCourses, trainerWorkload,
    latestParticipants, latestCerts, latestCompanies, upcoming, latestAudit,
  ] = await Promise.all([
    headCount(supabase, "participants"),
    headCount(supabase, "companies"),
    headCount(supabase, "courses"),
    headCount(supabase, "course_schedules"),
    headCount(supabase, "trainers"),
    headCount(supabase, "certificates", (q) => q.eq("status", "valid")),
    headCount(supabase, "courses", (q) => q.eq("status", "published")),
    headCount(supabase, "course_schedules", (q) => q.gte("start_date", today).not("status", "in", "(cancelled)")),
    supabase.from("v_attendance_breakdown").select("*"),
    supabase.from("v_assessment_passfail").select("*"),
    supabase.from("v_participants_per_month").select("*"),
    supabase.from("v_schedules_per_month").select("*"),
    supabase.from("v_certificates_per_month").select("*"),
    supabase.from("v_attendance_trend").select("*"),
    supabase.from("v_top_companies").select("*"),
    supabase.from("v_top_courses").select("*"),
    supabase.from("v_trainer_workload").select("*"),
    supabase.from("participants").select("id, participant_id, full_name, company, status, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("certificates").select("id, certificate_number, holder_name, status, issue_date").is("deleted_at", null).order("issue_date", { ascending: false }).limit(5),
    supabase.from("companies").select("id, company_id, company_name, status, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("course_schedules").select("id, start_date, status, capacity, seats_taken, courses(course_name)").gte("start_date", today).is("deleted_at", null).order("start_date").limit(5),
    supabase.from("audit_logs").select("actor_email, action, entity_type, summary, created_at").order("created_at", { ascending: false }).limit(6),
  ]);

  // Attendance rate + pass rate.
  const ab = (attBreakdown.data ?? []) as any[];
  const totalAtt = ab.reduce((s, r) => s + r.total, 0);
  const present = ab.find((r) => r.status === "present")?.total ?? 0;
  const attendanceRate = totalAtt ? Math.round((present / totalAtt) * 1000) / 10 : 0;
  const pf = (passFail.data ?? []) as any[];
  const passed = pf.find((r) => r.result === "pass")?.total ?? 0;
  const failed = pf.find((r) => r.result === "fail")?.total ?? 0;
  const passRate = passed + failed ? Math.round((passed / (passed + failed)) * 1000) / 10 : 0;

  const toPoints = (rows: any[], labelKey: string, valueKey: string): Point[] => (rows ?? []).map((r) => ({ label: String(r[labelKey] ?? ""), value: Number(r[valueKey] ?? 0) }));

  return (
    <>
      <PageHead
        title="Reports & Analytics"
        subtitle="Real-time overview of training operations."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/admin/reports/export?report=participants&format=csv" className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
            <a href="/admin/reports/export?report=summary&format=print" target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">🖨 Print / PDF</a>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="ta-grid cols-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" label="Total participants" value={participants.count ?? 0} href="/admin/participants" />
        <StatCard icon="🏢" label="Total companies" value={companies.count ?? 0} href="/admin/companies" />
        <StatCard icon="🎓" label="Total courses" value={courses.count ?? 0} href="/admin/courses" />
        <StatCard icon="🗓" label="Training schedules" value={schedules.count ?? 0} href="/admin/schedules" />
      </div>
      <div className="ta-grid cols-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🧑‍🏫" label="Total trainers" value={trainers.count ?? 0} href="/admin/trainers" />
        <StatCard icon="🏅" label="Certificates issued" value={certsIssued.count ?? 0} href="/admin/certificates" />
        <StatCard icon="✅" label="Attendance rate" value={`${attendanceRate}%`} />
        <StatCard icon="🎯" label="Pass rate" value={`${passRate}%`} />
      </div>
      <div className="ta-grid cols-2" style={{ marginBottom: 22 }}>
        <StatCard icon="📗" label="Active (published) courses" value={activeCourses.count ?? 0} />
        <StatCard icon="⏭" label="Upcoming courses" value={upcomingCourses.count ?? 0} />
      </div>

      {/* Charts */}
      <div className="ta-grid cols-2" style={{ marginBottom: 18 }}>
        <Card title="Participants per Month"><div className="ta-card-pad"><BarChart data={toPoints(partPerMonth.data as any, "ym", "total")} /></div></Card>
        <Card title="Training Sessions per Month"><div className="ta-card-pad"><BarChart data={toPoints(schedPerMonth.data as any, "ym", "total")} color="#2f6fed" /></div></Card>
      </div>
      <div className="ta-grid cols-2" style={{ marginBottom: 18 }}>
        <Card title="Certificates Issued (Monthly)"><div className="ta-card-pad"><LineChart data={toPoints(certPerMonth.data as any, "ym", "total")} /></div></Card>
        <Card title="Attendance Trend (%)"><div className="ta-card-pad"><LineChart data={toPoints(attTrend.data as any, "ym", "rate")} color="#2e9e5b" /></div></Card>
      </div>
      <div className="ta-grid cols-2" style={{ marginBottom: 18 }}>
        <Card title="Pass vs Fail"><div className="ta-card-pad"><DonutChart data={toPoints(pf, "result", "total")} /></div></Card>
        <Card title="Attendance Breakdown"><div className="ta-card-pad"><DonutChart data={toPoints(ab, "status", "total")} /></div></Card>
      </div>
      <div className="ta-grid cols-2" style={{ marginBottom: 18 }}>
        <Card title="Top Companies"><div className="ta-card-pad"><BarChart data={toPoints(topCompanies.data as any, "company_name", "participant_count")} color={"#0B2C56"} /></div></Card>
        <Card title="Trainer Workload"><div className="ta-card-pad"><BarChart data={toPoints(trainerWorkload.data as any, "full_name", "session_count")} color="#a9791a" /></div></Card>
      </div>
      <Card title="Top Courses"><div className="ta-card-pad"><BarChart data={toPoints(topCourses.data as any, "course_name", "session_count")} color="#2f6fed" /></div></Card>

      {/* Widgets */}
      <div className="ta-grid cols-2" style={{ marginTop: 22 }}>
        <Widget title="Upcoming Training" href="/admin/schedules" rows={(upcoming.data ?? []).map((s: any) => ({ main: s.courses?.course_name ?? "—", sub: `${new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })} · ${s.seats_taken}/${s.capacity} seats`, badge: s.status }))} />
        <Widget title="Recent Participants" href="/admin/participants" rows={(latestParticipants.data ?? []).map((p: any) => ({ main: p.full_name, sub: p.company, badge: p.status }))} />
        <Widget title="Recent Certificates" href="/admin/certificates" rows={(latestCerts.data ?? []).map((c: any) => ({ main: c.certificate_number, sub: c.holder_name, badge: c.status }))} />
        <Widget title="Latest Companies" href="/admin/companies" rows={(latestCompanies.data ?? []).map((c: any) => ({ main: c.company_name, sub: c.company_id, badge: c.status }))} />
      </div>

      <Card title="Latest Audit Logs" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/audit">View all</Link>}>
        {latestAudit.data && latestAudit.data.length > 0 ? (
          <div className="ta-table-wrap"><table className="ta-table"><tbody>
            {latestAudit.data.map((l: any, i: number) => (
              <tr key={i}><td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{formatMalaysiaDateTime(l.created_at)}</td><td>{l.actor_email ?? "system"}</td><td><Badge status={l.action} /></td><td style={{ color: "var(--ta-muted)" }}>{l.summary}</td></tr>
            ))}
          </tbody></table></div>
        ) : <EmptyState icon="📋" message="No activity yet." />}
      </Card>
    </>
  );
}

function Widget({ title, href, rows }: { title: string; href: string; rows: { main: string; sub?: string; badge?: string }[] }) {
  return (
    <Card title={title} action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href={href}>View</Link>}>
      {rows.length > 0 ? (
        <div className="ta-table-wrap"><table className="ta-table"><tbody>
          {rows.map((r, i) => (
            <tr key={i}><td><strong>{r.main}</strong>{r.sub ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{r.sub}</div> : null}</td><td style={{ textAlign: "right" }}>{r.badge ? <Badge status={r.badge} /> : null}</td></tr>
          ))}
        </tbody></table></div>
      ) : <EmptyState message="Nothing yet." />}
    </Card>
  );
}
