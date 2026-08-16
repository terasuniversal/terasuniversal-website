import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { AssignParticipants } from "../AssignParticipants";
import { removeParticipant, softDeleteSchedule, duplicateSchedule } from "../actions";

export const metadata = { title: "Schedule Details — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ScheduleDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: s } = await supabase.from("course_schedules").select("*, courses(course_name)").eq("id", id).single();
  if (!s) notFound();
  const courseName = (s as any).courses?.course_name ?? "—";
  const capacity = Math.max(Number(s.capacity) || 0, 0);
  const seatsTaken = Math.max(Number(s.seats_taken) || 0, 0);
  const seatsRemaining = Math.max(capacity - seatsTaken, 0);

  // Active enrollments (join) + available (active participants not currently enrolled).
  const { data: enrolled } = await supabase
    .from("schedule_participants")
    .select("id, enrolled_at, registration_status, participants(id, participant_id, full_name, company, phone, status, deleted_at)")
    .eq("schedule_id", id)
    .is("deleted_at", null)
    .order("enrolled_at", { ascending: true });
  const active = (enrolled ?? []).filter(
    (a: any) => a.registration_status !== "cancelled" && a.participants && !a.participants.deleted_at
  );
  const activeIds = new Set(active.map((a: any) => a.participants?.id).filter(Boolean));

  const { data: allActive } = await supabase
    .from("participants")
    .select("id, participant_id, full_name, company")
    .is("deleted_at", null)
    .order("full_name")
    .limit(500);
  const available = (allActive ?? []).filter((p: any) => !activeIds.has(p.id));

  const { data: fbRows } = await supabase.from("participant_feedback").select("id, status").eq("schedule_id", id);
  const fbSubmitted = (fbRows ?? []).filter((f: any) => f.status === "submitted").length;
  const fbEligible = active.length;
  const fbRate = fbEligible > 0 ? Math.round((fbSubmitted / fbEligible) * 100) : 0;

  const dl = { display: "grid", gridTemplateColumns: "150px 1fr", gap: 4, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={courseName}
        subtitle={s.schedule_code ?? ""}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/schedules" className="ta-btn ta-btn-outline">← Back</Link>
            {canWrite && (
              <>
                <form action={duplicateSchedule.bind(null, id)}><button className="ta-btn ta-btn-outline">Duplicate</button></form>
                <Link href={`/admin/schedules/${id}/edit`} className="ta-btn ta-btn-primary">Edit</Link>
                <form action={softDeleteSchedule.bind(null, id)}><button className="ta-btn ta-btn-danger">Delete</button></form>
              </>
            )}
          </div>
        }
      />

      <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <Badge status={s.status} />
        {!s.is_published && <Badge status="draft" />}
        <span style={{ color: "var(--ta-muted)" }}>
          {seatsTaken}/{capacity} enrolled · <strong>{seatsRemaining}</strong> seat(s) remaining
        </span>
      </div>

      <div className="ta-grid cols-2">
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Schedule Details">
            <div className="ta-card-pad">
              <dl style={dl}>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Course</dt><dd style={{ margin: 0, padding: "6px 0" }}>{courseName}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Trainer</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.trainer_name ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Venue</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.venue ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Mode</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.training_mode ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Dates</dt><dd style={{ margin: 0, padding: "6px 0" }}>{new Date(s.start_date).toLocaleDateString("en-MY")} – {new Date(s.end_date).toLocaleDateString("en-MY")}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Time</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.start_time ? `${s.start_time} – ${s.end_time ?? ""}` : "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Notes</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.notes ?? "—"}</dd>
              </dl>
            </div>
          </Card>

          <Card title="Attendance">
            <div className="ta-card-pad">
              <Link href={`/admin/attendance/${id}`} className="ta-btn ta-btn-outline">Open attendance for this schedule →</Link>
            </div>
          </Card>
          <Card title="Assessment">
            <div className="ta-card-pad">
              <Link href={`/admin/assessment/${id}`} className="ta-btn ta-btn-outline">Open assessment for this schedule →</Link>
            </div>
          </Card>
          <Card title="Certificate Generation"><div className="ta-card-pad"><EmptyState icon="🏅" message="Certificate generation for this schedule is a later follow-up (see SCHEDULES_ARCHITECTURE_DECISION.md §J)." /></div></Card>
          <Card title="Participant Feedback">
            <div className="ta-card-pad">
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--ta-navy)", marginBottom: 4 }}>
                {fbSubmitted} / {fbEligible} <span style={{ fontSize: 16, fontWeight: 600, color: "var(--ta-muted)" }}>responses</span>
              </div>
              <div className="ta-bar" style={{ marginBottom: 12 }}><span style={{ width: `${fbRate}%` }} /></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/admin/feedback?schedule=${id}`} className="ta-btn ta-btn-outline">Open Feedback Dashboard</Link>
                <Link href={`/admin/feedback/${id}`} className="ta-btn ta-btn-outline">Show QR / Links</Link>
              </div>
            </div>
          </Card>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title={`Enrolled Participants (${active.length})`}>
            <div className="ta-card-pad">
              {active.length > 0 ? (
                <div className="ta-table-wrap">
                  <table className="ta-table">
                    <tbody>
                      {active.map((a: any) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.participants?.full_name}</strong>
                            <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{a.participants?.participant_id}{a.participants?.company ? ` · ${a.participants.company}` : ""}{a.registration_status !== "registered" ? ` · ${a.registration_status}` : ""}</div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {canWrite && (
                              <form action={removeParticipant.bind(null, id, a.id)} style={{ display: "inline" }}>
                                <button className="ta-btn ta-btn-danger ta-btn-sm" title="Cancel enrollment">Cancel</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="👥" message="No participants enrolled yet." />
              )}
            </div>
          </Card>

          {canWrite && (
            <Card title="Enroll Participants">
              <div className="ta-card-pad">
                <AssignParticipants scheduleId={id} available={available as any} seatsRemaining={seatsRemaining} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
