import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireAttendance } from "../../../../../lib/auth/session";
import { canManageAttendance } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, StatCard } from "../../../../../components/admin/ui";
import { AttendanceTable, type AttRow } from "../AttendanceTable";
import { markAllPresent, resetAttendance } from "../actions";

export const metadata = { title: "Take Attendance — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function TakeAttendancePage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const profile = await requireAttendance(false);
  const canManage = canManageAttendance(profile.role);
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await (supabase
    .from("training_schedules") as any)
    .select("id, schedule_id, course_name, trainer, venue, start_date, end_date, status, registered_participants")
    .eq("id", scheduleId)
    .single();
  const s = scheduleRow as {
    id: string; schedule_id: string; course_name: string; trainer: string | null;
    venue: string | null; start_date: string; end_date: string;
    status: string; registered_participants: number | null;
  } | null;
  if (!s) notFound();

  const { data: att } = await supabase
    .from("attendance")
    .select("id, attendance_status, check_in_time, check_out_time, remarks, participants(id, participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .order("attendance_id", { ascending: true });

  const rows: AttRow[] = (att ?? []).map((a: any) => ({
    id: a.id,
    attendance_status: a.attendance_status,
    check_in_time: a.check_in_time,
    check_out_time: a.check_out_time,
    remarks: a.remarks,
    participant: a.participants,
  }));

  // Summary tiles.
  const counts = rows.reduce((m: Record<string, number>, r) => { m[r.attendance_status] = (m[r.attendance_status] ?? 0) + 1; return m; }, {});

  return (
    <>
      <PageHead
        title="Take Attendance"
        subtitle={`${s.course_name} · ${s.schedule_id}`}
        action={<Link href="/admin/attendance" className="ta-btn ta-btn-outline">← Back</Link>}
      />

      {/* Schedule view */}
      <Card title="Schedule">
        <div className="ta-card-pad" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <div><small style={{ color: "var(--ta-muted)" }}>Course</small><div><strong>{s.course_name}</strong></div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Venue</small><div>{s.venue ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Trainer</small><div>{s.trainer ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Date</small><div>{new Date(s.start_date).toLocaleDateString("en-MY")} – {new Date(s.end_date).toLocaleDateString("en-MY")}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Participants</small><div>{s.registered_participants}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Status</small><div><Badge status={s.status} /></div></div>
        </div>
      </Card>

      <div className="ta-grid cols-4" style={{ margin: "18px 0" }}>
        <StatCard icon="✅" label="Present" value={counts["present"] ?? 0} />
        <StatCard icon="❌" label="Absent" value={counts["absent"] ?? 0} />
        <StatCard icon="⏰" label="Late" value={counts["late"] ?? 0} />
        <StatCard icon="⏳" label="Pending" value={counts["pending"] ?? 0} />
      </div>

      {canManage && rows.length > 0 && (
        <div className="ta-toolbar">
          <form action={markAllPresent.bind(null, scheduleId)}>
            <button type="submit" className="ta-btn ta-btn-gold ta-btn-sm">✓ Mark all present</button>
          </form>
          <form action={resetAttendance.bind(null, scheduleId)}>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">↩ Undo all (reset to pending)</button>
          </form>
          <div className="ta-spacer" />
          <a href={`/admin/attendance/${scheduleId}/export?format=csv`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
          <a href={`/admin/attendance/${scheduleId}/export?format=excel`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
          <a href={`/admin/attendance/${scheduleId}/export?format=print`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">🖨 Sheet</a>
          <Link href={`/admin/attendance/${scheduleId}/import`} className="ta-btn ta-btn-outline ta-btn-sm">⬆ Import</Link>
        </div>
      )}

      <Card>
        {rows.length > 0 ? (
          <AttendanceTable scheduleId={scheduleId} rows={rows} canManage={canManage} />
        ) : (
          <EmptyState icon="👥" message="No participants assigned to this schedule yet. Assign participants from the Training Schedule module — attendance rows are created automatically." />
        )}
      </Card>

      {/* Integration placeholders */}
      <div className="ta-grid cols-3" style={{ marginTop: 18 }}>
        <Card title="Assessment"><div className="ta-card-pad"><EmptyState icon="📝" message="Assessment integration — coming soon." /></div></Card>
        <Card title="Certificate Generation"><div className="ta-card-pad"><EmptyState icon="🏅" message="Certificate integration — coming soon." /></div></Card>
        <Card title="QR Verification"><div className="ta-card-pad"><EmptyState icon="🔳" message="QR check-in — coming soon." /></div></Card>
      </div>
    </>
  );
}
