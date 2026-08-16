import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { softDeleteParticipant, restoreParticipant } from "../actions";

export const metadata = { title: "Participant — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ color: "var(--ta-muted)", padding: "7px 0" }}>{label}</dt>
      <dd style={{ margin: 0, padding: "7px 0", fontWeight: 500 }}>{value || "—"}</dd>
    </div>
  );
}

export default async function ViewParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleAccess("participants");
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: p }, { data: trainingHistory }, { data: certificates }, { data: attendance }, { data: assessments }] = await Promise.all([
    supabase.from("participants").select("*").eq("id", id).single(),
    supabase
      .from("schedule_participants")
      .select("id, enrolled_at, registration_status, course_schedules(schedule_code, start_date, status, courses(title))")
      .eq("participant_id", id)
      .is("deleted_at", null)
      .order("enrolled_at", { ascending: false }),
    supabase.from("certificates").select("id, certificate_number, status, issue_date, courses(title)").eq("participant_id", id).is("deleted_at", null).order("issue_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("attendance")
      .select("id, session_date, attendance_status, check_in_time, course_schedules(start_date, courses(title))")
      .eq("participant_id", id)
      .is("deleted_at", null)
      .order("session_date", { ascending: false }),
    supabase.from("assessments").select("id, assessment_type, result, theory_score, practical_score, assessed_at").eq("participant_id", id).is("deleted_at", null).order("assessed_at", { ascending: false, nullsFirst: false }),
  ]);
  if (!p) notFound();

  const isDeleted = !!p.deleted_at;
  const dl = { display: "grid", gridTemplateColumns: "170px 1fr", gap: 2, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={p.full_name}
        subtitle={p.participant_id}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/participants" className="ta-btn ta-btn-outline">← Back</Link>
            {canWrite && !isDeleted && <Link href={`/admin/participants/${id}/edit`} className="ta-btn ta-btn-primary">Edit</Link>}
            {canWrite && !isDeleted && (
              <form action={softDeleteParticipant.bind(null, id)}>
                <button className="ta-btn ta-btn-danger" type="submit">Delete</button>
              </form>
            )}
            {canWrite && isDeleted && (
              <form action={restoreParticipant.bind(null, id)}>
                <button className="ta-btn ta-btn-gold" type="submit">Restore</button>
              </form>
            )}
          </div>
        }
      />

      {isDeleted && <div className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>This participant is deleted. Restore to make them active again.</div>}

      <div style={{ marginBottom: 16 }}>
        <Badge status={p.status} />
      </div>

      <div className="ta-grid cols-2">
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Personal Details">
            <div className="ta-card-pad">
              <dl style={dl}>
                <Detail label="Participant ID" value={<code>{p.participant_id}</code>} />
                <Detail label="Full name" value={p.full_name} />
                <Detail label="IC / Passport" value={p.ic_passport_no} />
                <Detail label="Nationality" value={p.nationality} />
                <Detail label="Gender" value={p.gender} />
                <Detail label="Date of birth" value={p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString("en-MY") : null} />
                <Detail label="Registration date" value={p.registration_date ? new Date(p.registration_date).toLocaleDateString("en-MY") : null} />
              </dl>
            </div>
          </Card>

          <Card title="Employment Information">
            <div className="ta-card-pad">
              <dl style={dl}>
                <Detail label="Company" value={p.company} />
                <Detail label="Position" value={p.position} />
              </dl>
            </div>
          </Card>

          <Card title="Contact Information">
            <div className="ta-card-pad">
              <dl style={dl}>
                <Detail label="Phone" value={p.phone} />
                <Detail label="Email" value={p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : null} />
                <Detail label="Address" value={p.address} />
                <Detail label="Emergency contact" value={p.emergency_contact_name} />
                <Detail label="Emergency phone" value={p.emergency_contact_phone} />
              </dl>
            </div>
          </Card>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Training History">
            {trainingHistory && trainingHistory.length > 0 ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Course</th><th>Start date</th><th>Status</th></tr></thead><tbody>{trainingHistory.map((row: any) => <tr key={row.id}><td>{row.course_schedules?.courses?.title ?? "—"}</td><td>{row.course_schedules?.start_date ? new Date(row.course_schedules.start_date).toLocaleDateString("en-MY") : "—"}</td><td><Badge status={row.registration_status ?? "registered"} /></td></tr>)}</tbody></table></div> : <EmptyState icon="🎓" message="No training history yet." />}
          </Card>
          <Card title="Certificates">
            {certificates && certificates.length > 0 ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Certificate</th><th>Course</th><th>Status</th></tr></thead><tbody>{certificates.map((certificate: any) => <tr key={certificate.id}><td><Link href={`/admin/certificates/${certificate.id}`}><code>{certificate.certificate_number}</code></Link></td><td>{certificate.courses?.title ?? "—"}</td><td><Badge status={certificate.status} /></td></tr>)}</tbody></table></div> : <EmptyState icon="🏅" message="No certificates issued for this participant yet." />}
          </Card>
          <Card title="Attendance">
            {attendance && attendance.length > 0 ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Course</th><th>Session date</th><th>Status</th></tr></thead><tbody>{attendance.map((row: any) => <tr key={row.id}><td>{row.course_schedules?.courses?.title ?? "—"}</td><td>{row.session_date ? new Date(row.session_date).toLocaleDateString("en-MY") : "—"}</td><td><Badge status={row.attendance_status} /></td></tr>)}</tbody></table></div> : <EmptyState icon="✅" message="No attendance records yet." />}
          </Card>
          <Card title="Assessment">
            {assessments && assessments.length > 0 ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Type</th><th>Score</th><th>Result</th></tr></thead><tbody>{assessments.map((assessment: any) => { const t = assessment.theory_score, pr = assessment.practical_score; const overall = t != null && pr != null ? ((t + pr) / 2).toFixed(2) : t ?? pr ?? "—"; return <tr key={assessment.id}><td>{assessment.assessment_type ?? "—"}</td><td>{overall}</td><td><Badge status={assessment.result} /></td></tr>; })}</tbody></table></div> : <EmptyState icon="📝" message="No assessment records yet." />}
          </Card>
        </div>
      </div>
    </>
  );
}
