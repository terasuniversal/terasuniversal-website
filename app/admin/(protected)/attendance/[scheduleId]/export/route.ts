import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../../lib/auth/session";
import { canViewAttendance } from "../../../../../../lib/auth/rbac";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";

/**
 * Export a schedule's attendance sheet for one session date.
 *   ?format=csv | excel   ?date=YYYY-MM-DD (defaults to schedule start_date)
 * View access = editor+ or trainer.
 * Printing is handled by the dedicated print route (…/print), not here.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !canViewAttendance(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("attendance"))) return new NextResponse("Forbidden", { status: 403 });
  const { scheduleId } = await params;
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase
    .from("course_schedules")
    .select("schedule_code, trainer_name, venue, start_date, courses(course_name)")
    .eq("id", scheduleId)
    .single();
  const s = scheduleRow as any;
  const sessionDate = sp.get("date") || s?.start_date;

  // The printable sheet now lives at …/print (whole-schedule attendance);
  // keep the old format=print URL working (stale links/bookmarks) instead
  // of silently returning CSV. CSV/Excel exports below remain date-scoped.
  if (format === "print") {
    return NextResponse.redirect(new URL(`/admin/attendance/${scheduleId}/print`, request.url));
  }

  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  const { data: att } = await supabase
    .from("attendance")
    .select("participant_id, attendance_status, check_in_time, check_out_time, remarks")
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate);
  const byParticipant = new Map<string, any>((att ?? []).map((a: any): [string, any] => [a.participant_id, a]));

  type AttendanceExportRow = {
    participant_id: string; full_name: string; company: string; attendance_status: string;
    check_in_time: string; check_out_time: string; remarks: string;
  };
  const flat: AttendanceExportRow[] = (roster ?? []).map((r: any): AttendanceExportRow => {
    const a = byParticipant.get(r.participant_id);
    return {
      participant_id: r.participants?.participant_id ?? "",
      full_name: r.participants?.full_name ?? "",
      company: r.participants?.company ?? "",
      attendance_status: a?.attendance_status ?? "not_recorded",
      check_in_time: a?.check_in_time ? formatMalaysiaDateTime(a.check_in_time) : "",
      check_out_time: a?.check_out_time ? formatMalaysiaDateTime(a.check_out_time) : "",
      remarks: a?.remarks ?? "",
    };
  });
  const HEADERS: [keyof (typeof flat)[number], string][] = [
    ["participant_id", "Participant ID"], ["full_name", "Name"], ["company", "Company"],
    ["attendance_status", "Status"], ["check_in_time", "Check-in"], ["check_out_time", "Check-out"], ["remarks", "Remarks"],
  ];

  await supabase.rpc("log_event" as never, { p_action: "export", p_entity_type: "attendance", p_summary: `Exported attendance for ${s?.schedule_code ?? scheduleId} on ${sessionDate} (${format})` } as never);

  const stamp = new Date().toISOString().slice(0, 10);
  const escHtml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "excel") {
    const head = HEADERS.map(([, l]) => `<th>${escHtml(l)}</th>`).join("");
    const body = flat.map((r) => `<tr>${HEADERS.map(([k]) => `<td>${escHtml(r[k])}</td>`).join("")}</tr>`).join("");
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${s?.schedule_code ?? "sheet"}-${sessionDate}-${stamp}.xls"` } });
  }

  const escCsv = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [HEADERS.map(([, l]) => l).join(","), ...flat.map((r) => HEADERS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${s?.schedule_code ?? "sheet"}-${sessionDate}-${stamp}.csv"` } });
}
