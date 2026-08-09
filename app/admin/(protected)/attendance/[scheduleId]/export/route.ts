import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../../lib/auth/session";
import { canViewAttendance } from "../../../../../../lib/auth/rbac";

/**
 * Export a schedule's attendance sheet for one session date.
 *   ?format=csv | excel | print   ?date=YYYY-MM-DD (defaults to schedule start_date)
 * View access = editor+ or trainer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || !canViewAttendance(profile.role)) return new NextResponse("Forbidden", { status: 403 });
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
      check_in_time: a?.check_in_time ? new Date(a.check_in_time).toLocaleString("en-MY") : "",
      check_out_time: a?.check_out_time ? new Date(a.check_out_time).toLocaleString("en-MY") : "",
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

  if (format === "excel" || format === "print") {
    const head = HEADERS.map(([, l]) => `<th>${escHtml(l)}</th>`).join("");
    const body = flat.map((r) => `<tr>${HEADERS.map(([k]) => `<td>${escHtml(r[k])}</td>`).join("")}</tr>`).join("");
    if (format === "print") {
      const title = `${s?.courses?.course_name ?? "Training"} — Attendance Sheet (${sessionDate})`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:24px}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;color:#555;font-size:13px}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:14px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#0B2C56;color:#fff}</style>
</head><body onload="window.print()">
<h1>${escHtml(title)}</h1>
<p>Schedule: ${escHtml(s?.schedule_code ?? "")} · Trainer: ${escHtml(s?.trainer_name ?? "-")} · Venue: ${escHtml(s?.venue ?? "-")} · Date: ${escHtml(sessionDate ?? "")}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${s?.schedule_code ?? "sheet"}-${sessionDate}-${stamp}.xls"` } });
  }

  const escCsv = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [HEADERS.map(([, l]) => l).join(","), ...flat.map((r) => HEADERS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${s?.schedule_code ?? "sheet"}-${sessionDate}-${stamp}.csv"` } });
}
