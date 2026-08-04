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

  const { data: s } = await supabase.from("training_schedules").select("*").eq("id", id).single();
  if (!s) notFound();

  // Assigned participants (join) + available (active, not yet assigned).
  const { data: assigned } = await supabase
    .from("schedule_participants")
    .select("id, assigned_at, participants(id, participant_id, full_name, company, phone, status)")
    .eq("schedule_id", id)
    .order("assigned_at", { ascending: true });
  const assignedIds = new Set((assigned ?? []).map((a: any) => a.participants?.id).filter(Boolean));

  const { data: allActive } = await supabase
    .from("participants")
    .select("id, participant_id, full_name, company")
    .is("deleted_at", null)
    .order("full_name")
    .limit(500);
  const available = (allActive ?? []).filter((p: any) => !assignedIds.has(p.id));

  const dl = { display: "grid", gridTemplateColumns: "150px 1fr", gap: 4, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={s.course_name}
        subtitle={`${s.schedule_id}`}
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
        <span style={{ color: "var(--ta-muted)" }}>
          {s.registered_participants}/{s.max_participants} registered · <strong>{s.seats_remaining}</strong> seat(s) remaining
        </span>
      </div>

      <div className="ta-grid cols-2">
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Schedule Details">
            <div className="ta-card-pad">
              <dl style={dl}>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Course</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.course_name}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Trainer</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.trainer ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Venue</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.venue ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Mode</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.training_mode ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Dates</dt><dd style={{ margin: 0, padding: "6px 0" }}>{new Date(s.start_date).toLocaleDateString("en-MY")} – {new Date(s.end_date).toLocaleDateString("en-MY")}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Time</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.start_time ? `${s.start_time} – ${s.end_time ?? ""}` : "—"}</dd>
                <dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>Remarks</dt><dd style={{ margin: 0, padding: "6px 0" }}>{s.remarks ?? "—"}</dd>
              </dl>
            </div>
          </Card>

          {/* Future-ready placeholders */}
          <Card title="Attendance"><div className="ta-card-pad"><EmptyState icon="✅" message="Attendance module — coming soon." /></div></Card>
          <Card title="Assessment"><div className="ta-card-pad"><EmptyState icon="📝" message="Assessment module — coming soon." /></div></Card>
          <Card title="Certificate Generation"><div className="ta-card-pad"><EmptyState icon="🏅" message="Certificate module — coming soon." /></div></Card>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title={`Assigned Participants (${assigned?.length ?? 0})`}>
            <div className="ta-card-pad">
              {assigned && assigned.length > 0 ? (
                <div className="ta-table-wrap">
                  <table className="ta-table">
                    <tbody>
                      {assigned.map((a: any) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.participants?.full_name}</strong>
                            <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{a.participants?.participant_id}{a.participants?.company ? ` · ${a.participants.company}` : ""}</div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {canWrite && (
                              <form action={removeParticipant.bind(null, id, a.id)} style={{ display: "inline" }}>
                                <button className="ta-btn ta-btn-danger ta-btn-sm" title="Remove">Remove</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="👥" message="No participants assigned yet." />
              )}
            </div>
          </Card>

          {canWrite && (
            <Card title="Assign Participants">
              <div className="ta-card-pad">
                <AssignParticipants scheduleId={id} available={available as any} seatsRemaining={s.seats_remaining} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
