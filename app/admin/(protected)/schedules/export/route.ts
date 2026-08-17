import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../lib/auth/session";
import { isEditor } from "../../../../../lib/auth/rbac";

/**
 * Export training schedules honouring the list filters.
 *   ?format=csv    → text/csv (UTF-8 BOM)
 *   ?format=excel  → Excel-openable .xls HTML table (dependency-free)
 *   ?format=print  → printable HTML page (auto-opens the print dialog)
 * Filters: q, status, course, trainer, month, year. Read = editor and above.
 */
const COLUMNS: [string, string][] = [
  ["schedule_code", "Schedule ID"],
  ["course_name", "Course"],
  ["trainer_name", "Trainer"],
  ["venue", "Venue"],
  ["training_mode", "Mode"],
  ["start_date", "Start Date"],
  ["end_date", "End Date"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["capacity", "Capacity"],
  ["seats_taken", "Enrolled"],
  ["seats_remaining", "Seats Left"],
  ["status", "Status"],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("schedules"))) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const format = p.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("course_schedules")
    .select("schedule_code, trainer_name, venue, training_mode, start_date, end_date, start_time, end_time, capacity, seats_taken, status, courses(course_name)")
    .is("deleted_at", null)
    .order("start_date", { ascending: true });
  if (p.get("q")) {
    const safe = p.get("q")!.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.or(`schedule_code.ilike.%${safe}%,trainer_name.ilike.%${safe}%,venue.ilike.%${safe}%`);
  }
  if (p.get("status")) query = query.eq("status", p.get("status") as any);
  if (p.get("course")) query = query.eq("course_id", p.get("course")!);
  if (p.get("trainer")) query = query.eq("trainer_name", p.get("trainer")!);
  if (p.get("year")) {
    const y = Number(p.get("year"));
    const m = p.get("month") ? Number(p.get("month")) : null;
    const from = m ? `${y}-${String(m).padStart(2, "0")}-01` : `${y}-01-01`;
    const to = m ? `${y}-${String(m).padStart(2, "0")}-31` : `${y}-12-31`;
    query = query.gte("start_date", from).lte("start_date", to);
  }

  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = ((data ?? []) as any[]).map((r) => ({
    ...r,
    course_name: r.courses?.course_name ?? "",
    seats_remaining: Math.max((Number(r.capacity) || 0) - (Number(r.seats_taken) || 0), 0),
  }));

  await supabase.rpc("log_event" as never, {
    p_action: "export",
    p_entity_type: "course_schedules",
    p_summary: `Exported ${rows.length} schedules (${format})`,
  } as never);

  const stamp = new Date().toISOString().slice(0, 10);
  const escHtml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "excel" || format === "print") {
    const head = COLUMNS.map(([, l]) => `<th>${escHtml(l)}</th>`).join("");
    const body = rows.map((r: Record<string, any>) => `<tr>${COLUMNS.map(([k]) => `<td>${escHtml(r[k])}</td>`).join("")}</tr>`).join("");
    if (format === "print") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Training Schedule</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#0B2C56;color:#fff}@media print{.noprint{display:none}}</style>
</head><body onload="window.print()"><h1>TERAS UNIVERSAL — Training Schedule</h1><p>Generated ${stamp}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, {
      headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="schedules-${stamp}.xls"` },
    });
  }

  const escCsv = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [COLUMNS.map(([, l]) => l).join(","), ...rows.map((r: Record<string, any>) => COLUMNS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="schedules-${stamp}.csv"` },
  });
}
