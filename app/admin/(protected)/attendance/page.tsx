import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../components/admin/ui";
import { markAttendance, recordAssessment } from "./actions";

export const metadata = { title: "Attendance & Assessment — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Operational workflow: pick a schedule → its participants list appears →
 * mark attendance and record assessment inline per participant.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  await requireRole("editor");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: schedules } = await (supabase
    .from("course_schedules") as any)
    .select("id, start_date, end_date, status, courses(title)")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(50);

  const scheduleId = sp.schedule;
  let participants: any[] = [];
  let attendance: Record<string, any> = {};
  let assessments: Record<string, any[]> = {};

  if (scheduleId) {
    const [{ data: parts }, { data: att }, { data: asmt }] = await Promise.all([
      (supabase.from("participants") as any).select("id, full_name, company, status").eq("schedule_id", scheduleId).is("deleted_at", null).order("full_name"),
      (supabase.from("attendance") as any).select("participant_id, present, session_date").eq("schedule_id", scheduleId),
      (supabase.from("assessments") as any).select("participant_id, assessment_type, score, result").eq("schedule_id", scheduleId),
    ]);
    participants = parts ?? [];
    for (const a of (att ?? []) as any[]) attendance[a.participant_id] = a;
    for (const a of (asmt ?? []) as any[]) (assessments[a.participant_id] ??= []).push(a);
  }

  return (
    <>
      <PageHead title="Attendance & Assessment" subtitle="Record who attended and their assessment results." />

      <Card title="Select a schedule">
        <div className="ta-card-pad">
          {schedules && schedules.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {schedules.map((s: any) => (
                <Link
                  key={s.id}
                  href={`/admin/attendance?schedule=${s.id}`}
                  className={`ta-btn ta-btn-sm ${scheduleId === s.id ? "ta-btn-primary" : "ta-btn-outline"}`}
                >
                  {s.courses?.title ?? "Course"} · {new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon="🗓" message="No schedules yet. Create one in Training Schedule." />
          )}
        </div>
      </Card>

      {scheduleId && (
        <div style={{ marginTop: 20 }}>
          <Card title={`Participants (${participants.length})`}>
            {participants.length > 0 ? (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead>
                    <tr><th>Participant</th><th>Attendance</th><th>Assessment</th><th>Record result</th></tr>
                  </thead>
                  <tbody>
                    {participants.map((p) => {
                      const att = attendance[p.id];
                      const asmt = assessments[p.id]?.[0];
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.full_name}</strong>{p.company ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{p.company}</div> : null}</td>
                          <td>
                            <form action={markAttendance} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input type="hidden" name="schedule_id" value={scheduleId} />
                              <input type="hidden" name="participant_id" value={p.id} />
                              <input type="hidden" name="session_date" value={today} />
                              <input type="hidden" name="present" value={att?.present ? "false" : "true"} />
                              <button type="submit" className={`ta-btn ta-btn-sm ${att?.present ? "ta-btn-gold" : "ta-btn-outline"}`}>
                                {att?.present ? "✓ Present" : "Mark present"}
                              </button>
                            </form>
                          </td>
                          <td>{asmt ? <Badge status={asmt.result} /> : <span style={{ color: "var(--ta-muted)" }}>—</span>}</td>
                          <td>
                            <form action={recordAssessment} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <input type="hidden" name="schedule_id" value={scheduleId} />
                              <input type="hidden" name="participant_id" value={p.id} />
                              <input name="assessment_type" placeholder="Type" defaultValue="Final" style={{ width: 90, padding: "6px 8px", border: "1px solid var(--ta-line)", borderRadius: 7 }} />
                              <input name="score" type="number" min="0" max="100" placeholder="Score" style={{ width: 74, padding: "6px 8px", border: "1px solid var(--ta-line)", borderRadius: 7 }} />
                              <select name="result" defaultValue="competent" style={{ padding: "6px 8px", border: "1px solid var(--ta-line)", borderRadius: 7 }}>
                                <option value="competent">Competent</option>
                                <option value="not_yet_competent">Not Yet Competent</option>
                                <option value="pass">Pass</option>
                                <option value="fail">Fail</option>
                                <option value="pending">Pending</option>
                              </select>
                              <button type="submit" className="ta-btn ta-btn-sm ta-btn-primary">Save</button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="👥" message="No participants registered to this schedule yet." />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
