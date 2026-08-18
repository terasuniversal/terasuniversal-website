import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { AssignParticipants } from "../AssignParticipants";
import { AssessorAssignment } from "../AssessorAssignment";
import { GroupsPanel } from "../GroupsPanel";
import { ParticipantGroupAssignment } from "../ParticipantGroupAssignment";
import { removeParticipant, softDeleteSchedule, duplicateSchedule } from "../actions";
import { loadAssessorOptions, loadTrainerOptions } from "../options";

export const metadata = { title: "Schedule Details — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ScheduleDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assessor_error?: string; group_error?: string }>;
}) {
  await requireModuleAccess("schedules");
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const { id } = await params;
  const { assessor_error, group_error } = await searchParams;
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
    .select("id, enrolled_at, registration_status, schedule_group_id, participants(id, participant_id, full_name, company, phone, status)")
    .eq("schedule_id", id)
    .is("deleted_at", null)
    .order("enrolled_at", { ascending: true });
  const active = (enrolled ?? []).filter((a: any) => a.registration_status !== "cancelled");
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

  // Primary assessor assignment (Assessor Management Phase 1).
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name, is_active)")
    .eq("schedule_id", id)
    .eq("is_primary", true)
    .maybeSingle();
  const currentAssessorId = (assessorAssignment as any)?.assessor_id ?? null;
  const assessorName = (assessorAssignment as any)?.assessors?.full_name ?? null;
  const assessorOptions = canWrite ? await loadAssessorOptions() : [];

  // Training Schedule Groups V1 — optional subdivision of this class.
  const { data: groupRows } = await supabase
    .from("schedule_groups")
    .select("id, name, trainer_id, assessor_id, capacity, start_time, end_time, trainers(full_name), assessors(full_name)")
    .eq("schedule_id", id)
    .is("deleted_at", null)
    .order("name");
  const groupParticipantCounts = new Map<string, number>();
  for (const a of active as any[]) {
    if (a.schedule_group_id) groupParticipantCounts.set(a.schedule_group_id, (groupParticipantCounts.get(a.schedule_group_id) ?? 0) + 1);
  }
  const groups = (groupRows ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    trainer_id: g.trainer_id,
    trainer_name: g.trainers?.full_name ?? null,
    assessor_id: g.assessor_id,
    assessor_name: g.assessors?.full_name ?? null,
    capacity: g.capacity,
    start_time: g.start_time,
    end_time: g.end_time,
    participant_count: groupParticipantCounts.get(g.id) ?? 0,
  }));
  const trainerOptions = canWrite ? await loadTrainerOptions() : [];
  const groupOptions = groups.map((g: any) => ({ id: g.id as string, name: g.name as string }));

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

      {assessor_error && (
        <div className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>
          <strong>Assessor assignment incomplete:</strong> the schedule was created/updated, but the primary
          assessor could not be assigned ({assessor_error}). Reassign it using the Primary Assessor control below.
        </div>
      )}

      {group_error && (
        <div className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>
          <strong>Group not removed:</strong> {group_error}
        </div>
      )}

      <div className="ta-grid cols-2">
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Schedule Details">
            <div className="ta-card-pad">
              <dl style={dl}>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Course</dt><dd style={{ margin: 0, padding: "6px 0" }}>{courseName}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Trainer</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.trainer_name ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Assessor</dt><dd style={{ margin: 0, padding: "6px 0" }}>{assessorName ?? "Not assigned"}</dd>
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
          {canWrite && (
            <Card title="Primary Assessor">
              <div className="ta-card-pad">
                <AssessorAssignment scheduleId={id} assessors={assessorOptions} currentAssessorId={currentAssessorId} />
              </div>
            </Card>
          )}

          <Card title={`Training Groups (${groups.length})`}>
            <div className="ta-card-pad">
              {canWrite ? (
                <GroupsPanel scheduleId={id} groups={groups} trainers={trainerOptions} assessors={assessorOptions} scheduleAssessorName={assessorName} />
              ) : groups.length > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {groups.map((g: any) => (
                    <div key={g.id} style={{ fontSize: 13 }}>
                      <strong>{g.name}</strong> — Trainer: {g.trainer_name ?? "none"} · Assessor: {g.assessor_name ?? assessorName ?? "not assigned"}
                      {(g.assessor_name || assessorName) ? ` (${g.assessor_name ? "Override" : "Class Assessor"})` : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon="👥" message="No groups — this schedule uses its trainer/venue fields directly." />
              )}
            </div>
          </Card>

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
                          {groups.length > 0 && (
                            <td>
                              {canWrite ? (
                                <ParticipantGroupAssignment scheduleId={id} assignmentId={a.id} groups={groupOptions} currentGroupId={a.schedule_group_id ?? null} />
                              ) : (
                                <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>{groupOptions.find((g: any) => g.id === a.schedule_group_id)?.name ?? "Ungrouped"}</span>
                              )}
                            </td>
                          )}
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
