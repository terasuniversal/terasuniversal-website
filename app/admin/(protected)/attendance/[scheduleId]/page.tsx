import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireAttendance } from "../../../../../lib/auth/session";
import { canManageAttendance } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, StatCard } from "../../../../../components/admin/ui";
import { AttendanceTable, type AttRow } from "../AttendanceTable";
import { markAllPresent, resetAttendance } from "../actions";
import { loadAttendanceGroups, resolveRequestedGroup, computeAssessorDisplay, UNGROUPED } from "../groupFilter";

export const metadata = { title: "Take Attendance — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function TakeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ date?: string; group?: string }>;
}) {
  await requireModuleAccess("attendance");
  const profile = await requireAttendance(false);
  const canManage = canManageAttendance(profile.role);
  const { scheduleId } = await params;
  const { date, group: requestedGroup } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, trainer_name, venue, start_date, end_date, status, capacity, seats_taken, courses(course_name)")
    .eq("id", scheduleId)
    .single();
  if (!scheduleRow) notFound();
  const s = scheduleRow as any;
  const courseName = s.courses?.course_name ?? "—";
  const sessionDate = date && date >= s.start_date && date <= s.end_date ? date : s.start_date;

  // Schedule Groups V1 — group is a view/filter dimension over the same
  // attendance rows, never a second attendance system. selection is
  // server-validated against THIS schedule's own groups (groupFilter.ts) so
  // an invalid or cross-schedule ?group= value can never leak another
  // schedule's roster.
  const groups = await loadAttendanceGroups(supabase, scheduleId);
  const selection = resolveRequestedGroup(groups, requestedGroup);

  // Schedule's shared/default assessor (Assessor Management Phase 1) — the
  // fallback every group with no assessor_id override resolves to.
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const schedulePrimaryAssessorName = (assessorAssignment as any)?.assessors?.full_name ?? "";

  // Enrolled roster (schedule_participants), independent of whether
  // attendance has been recorded for this session date yet.
  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, schedule_group_id, participants(id, participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .order("enrolled_at", { ascending: true });

  const rosterFiltered = (roster ?? []).filter((r: any) => {
    if (selection === null) return true; // All Groups
    if (selection === UNGROUPED) return !r.schedule_group_id;
    return r.schedule_group_id === selection.id;
  });
  const hasUngrouped = groups.length > 0 && (roster ?? []).some((r: any) => !r.schedule_group_id);

  // Attendance already recorded for this specific session date.
  const { data: att } = await supabase
    .from("attendance")
    .select("participant_id, attendance_status, check_in_time, check_out_time, remarks")
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate);
  const byParticipant = new Map<string, any>((att ?? []).map((a: any): [string, any] => [a.participant_id, a]));

  const rows: AttRow[] = rosterFiltered.map((r: any) => {
    const a = byParticipant.get(r.participant_id);
    return {
      participant_id: r.participant_id,
      participant: r.participants,
      attendance_status: a?.attendance_status ?? null,
      check_in_time: a?.check_in_time ?? null,
      check_out_time: a?.check_out_time ?? null,
      remarks: a?.remarks ?? null,
    };
  });

  // Trainer display: a lone name only ever means one thing. Once a schedule
  // has groups with different trainers, a single "Trainer: X" line would
  // misattribute Group B's session to Group A's trainer (or vice versa) --
  // see STOP GATE #1 rule "do not pretend there is one trainer if there are
  // multiple group trainers".
  const distinctGroupTrainers = new Set(groups.map((g) => g.trainer_name).filter(Boolean));
  const trainerDisplay: { mode: "single" | "list"; single?: string; list?: { label: string; trainer: string }[] } =
    selection && selection !== UNGROUPED
      ? { mode: "single", single: selection.trainer_name ?? "— none —" }
      : selection === UNGROUPED
        ? { mode: "single", single: s.trainer_name ?? "—" }
        : groups.length === 0 || distinctGroupTrainers.size <= 1
          ? { mode: "single", single: (groups[0]?.trainer_name ?? s.trainer_name) ?? "—" }
          : {
              mode: "list",
              list: [
                ...groups.map((g) => ({ label: g.name, trainer: g.trainer_name ?? "— none —" })),
                ...(hasUngrouped ? [{ label: "Ungrouped", trainer: s.trainer_name ?? "—" }] : []),
              ],
            };

  // Effective assessor = group.assessor_id ?? schedule primary assessor,
  // applied identically to the print sheet (groupFilter.ts's shared rule).
  const assessorDisplay = computeAssessorDisplay(groups, schedulePrimaryAssessorName, selection, hasUngrouped);

  const counts = rows.reduce((m: Record<string, number>, r) => {
    const key = r.attendance_status ?? "not_recorded";
    m[key] = (m[key] ?? 0) + 1;
    return m;
  }, {});

  // Simple day-by-day navigation across the schedule's date range. Built in
  // UTC: start_date is a bare date, so parsing it as local time and then
  // slicing toISOString() would shift every button a day early on any
  // UTC+x server (e.g. Vercel's UTC), making the nav links out-of-range.
  const days: string[] = [];
  const startDay = new Date(s.start_date + "T00:00:00Z");
  const endDay = new Date(s.end_date + "T00:00:00Z");
  for (let d = new Date(startDay); d <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  return (
    <>
      <PageHead
        title="Take Attendance"
        subtitle={`${courseName} · ${s.schedule_code}`}
        action={<Link href="/admin/attendance" className="ta-btn ta-btn-outline">← Back</Link>}
      />

      <Card title="Schedule">
        <div className="ta-card-pad" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <div><small style={{ color: "var(--ta-muted)" }}>Course</small><div><strong>{courseName}</strong></div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Venue</small><div>{s.venue ?? "—"}</div></div>
          <div>
            <small style={{ color: "var(--ta-muted)" }}>{trainerDisplay.mode === "list" ? "Trainer(s)" : "Trainer"}</small>
            {trainerDisplay.mode === "single" ? (
              <div>{trainerDisplay.single}</div>
            ) : (
              <div style={{ display: "grid", gap: 2 }}>
                {trainerDisplay.list!.map((t) => (
                  <div key={t.label} style={{ fontSize: 13 }}><strong>{t.label}</strong> — {t.trainer}</div>
                ))}
              </div>
            )}
          </div>
          <div>
            <small style={{ color: "var(--ta-muted)" }}>{assessorDisplay.mode === "list" ? "Assessor(s)" : "Assessor"}</small>
            {assessorDisplay.mode === "single" ? (
              <div>
                {assessorDisplay.assessor || "— none —"}
                {assessorDisplay.showLabel && assessorDisplay.assessor ? ` (${assessorDisplay.isOverride ? "Override" : "Class Assessor"})` : ""}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 2 }}>
                {assessorDisplay.entries.map((e) => (
                  <div key={e.label} style={{ fontSize: 13 }}>
                    <strong>{e.label}</strong> — {e.assessor || "— none —"} {e.assessor ? `(${e.isOverride ? "Override" : "Class Assessor"})` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div><small style={{ color: "var(--ta-muted)" }}>Dates</small><div>{new Date(s.start_date).toLocaleDateString("en-MY")} – {new Date(s.end_date).toLocaleDateString("en-MY")}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Enrolled</small><div>{s.seats_taken}/{s.capacity}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Status</small><div><Badge status={s.status} /></div></div>
        </div>
      </Card>

      {groups.length > 0 && (
        <div className="ta-toolbar" style={{ flexWrap: "wrap" }}>
          <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Group:</span>
          <Link
            href={`/admin/attendance/${scheduleId}?date=${sessionDate}`}
            className={`ta-btn ta-btn-sm ${selection === null ? "ta-btn-primary" : "ta-btn-outline"}`}
          >
            All Groups
          </Link>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/admin/attendance/${scheduleId}?date=${sessionDate}&group=${g.id}`}
              className={`ta-btn ta-btn-sm ${selection !== null && selection !== UNGROUPED && selection.id === g.id ? "ta-btn-primary" : "ta-btn-outline"}`}
            >
              {g.name}
            </Link>
          ))}
          {hasUngrouped && (
            <Link
              href={`/admin/attendance/${scheduleId}?date=${sessionDate}&group=${UNGROUPED}`}
              className={`ta-btn ta-btn-sm ${selection === UNGROUPED ? "ta-btn-primary" : "ta-btn-outline"}`}
            >
              Ungrouped
            </Link>
          )}
        </div>
      )}

      {days.length > 1 && (
        <div className="ta-toolbar" style={{ flexWrap: "wrap" }}>
          <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Session date:</span>
          {days.map((d) => (
            <Link
              key={d}
              href={`/admin/attendance/${scheduleId}?date=${d}${requestedGroup ? `&group=${requestedGroup}` : ""}`}
              className={`ta-btn ta-btn-sm ${d === sessionDate ? "ta-btn-primary" : "ta-btn-outline"}`}
            >
              {new Date(d + "T00:00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
            </Link>
          ))}
        </div>
      )}

      <div className="ta-grid cols-4" style={{ margin: "18px 0" }}>
        <StatCard icon="✅" label="Present" value={counts["present"] ?? 0} />
        <StatCard icon="❌" label="Absent" value={counts["absent"] ?? 0} />
        <StatCard icon="⏰" label="Late" value={counts["late"] ?? 0} />
        <StatCard icon="🫥" label="Excused" value={counts["excused"] ?? 0} />
      </div>

      {canManage && rows.length > 0 && (
        <div className="ta-toolbar">
          <form action={markAllPresent.bind(null, scheduleId, sessionDate)}>
            {rows.map((r) => <input key={r.participant_id} type="hidden" name="participant_ids" value={r.participant_id} />)}
            <button type="submit" className="ta-btn ta-btn-gold ta-btn-sm">✓ Mark all present ({sessionDate})</button>
          </form>
          <form action={resetAttendance.bind(null, scheduleId, sessionDate)}>
            {rows.map((r) => <input key={r.participant_id} type="hidden" name="participant_ids" value={r.participant_id} />)}
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">↩ Undo all for this date</button>
          </form>
          <div className="ta-spacer" />
          <a href={`/admin/attendance/${scheduleId}/export?format=csv&date=${sessionDate}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
          <a href={`/admin/attendance/${scheduleId}/export?format=excel&date=${sessionDate}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
          <a href={`/admin/attendance/${scheduleId}/print${requestedGroup ? `?group=${requestedGroup}` : ""}`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">🖨 Print Attendance Sheet</a>
          <Link href={`/admin/attendance/${scheduleId}/import?date=${sessionDate}`} className="ta-btn ta-btn-outline ta-btn-sm">⬆ Import</Link>
        </div>
      )}

      <Card>
        {rows.length > 0 ? (
          <AttendanceTable scheduleId={scheduleId} sessionDate={sessionDate} rows={rows} canManage={canManage} />
        ) : rosterFiltered.length === 0 && (roster ?? []).length > 0 ? (
          <EmptyState icon="👥" message="No participants assigned to this group yet." />
        ) : (
          <EmptyState icon="👥" message="No participants enrolled in this schedule yet. Enroll participants from the Training Schedule module." />
        )}
      </Card>

      <div className="ta-grid cols-3" style={{ marginTop: 18 }}>
        <Card title="Assessment"><div className="ta-card-pad"><Link href={`/admin/assessment/${scheduleId}`} className="ta-btn ta-btn-outline">Open assessment →</Link></div></Card>
        <Card title="Certificate Generation"><div className="ta-card-pad"><EmptyState icon="🏅" message="Certificate generation is a later follow-up (see SCHEDULES_ARCHITECTURE_DECISION.md §J)." /></div></Card>
        <Card title="QR Verification"><div className="ta-card-pad"><EmptyState icon="🔳" message="QR check-in — coming soon." /></div></Card>
      </div>
    </>
  );
}
