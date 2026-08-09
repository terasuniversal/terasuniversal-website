import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../lib/auth/session";
import { isEditor } from "../../../../../lib/auth/rbac";

/**
 * Reporting export.
 *   ?report=<name>&format=csv|excel   → a data report (list)
 *   ?report=summary&format=print      → printable executive summary (PDF via print)
 * Reports: participants, companies, courses, schedules, trainers, certificates.
 * View = editor and above. Every export is audited.
 */
const REPORTS: Record<string, { table: string; columns: [string, string][]; order: string }> = {
  participants: { table: "participants", order: "created_at", columns: [["participant_id", "ID"], ["full_name", "Name"], ["company", "Company"], ["status", "Status"], ["created_at", "Created"]] },
  companies: { table: "companies", order: "company_id", columns: [["company_id", "ID"], ["company_name", "Name"], ["industry", "Industry"], ["state", "State"], ["status", "Status"]] },
  courses: { table: "courses", order: "sort_order", columns: [["title", "Title"], ["category", "Category"], ["status", "Status"]] },
  schedules: { table: "course_schedules", order: "start_date", columns: [["schedule_code", "ID"], ["trainer_name", "Trainer"], ["venue", "Venue"], ["start_date", "Start"], ["status", "Status"]] },
  trainers: { table: "trainers", order: "trainer_id", columns: [["trainer_id", "ID"], ["full_name", "Name"], ["department", "Department"], ["status", "Status"]] },
  certificates: { table: "certificates", order: "issue_date", columns: [["certificate_number", "Number"], ["holder_name", "Holder"], ["status", "Status"], ["issue_date", "Issued"]] },
};

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  const p = request.nextUrl.searchParams;
  const report = p.get("report") ?? "participants";
  const format = p.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  await supabase.rpc("log_event" as never, { p_action: "export", p_entity_type: "reports", p_summary: `Report export: ${report} (${format})` } as never);

  // --- Executive summary (printable / PDF) ---
  if (report === "summary") {
    const today = new Date().toISOString().slice(0, 10);
    const hc = (t: string, f: (q: any) => any = (q) => q) => f(supabase.from(t).select("*", { count: "exact", head: true }).is("deleted_at", null));
    const [participants, companies, courses, schedules, trainers, certs, upcoming] = await Promise.all([
      hc("participants"), hc("companies"), hc("courses"), hc("course_schedules"), hc("trainers"),
      hc("certificates", (q) => q.eq("status", "valid")),
      hc("course_schedules", (q) => q.gte("start_date", today).not("status", "in", "(cancelled)")),
    ]);
    const row = (k: string, v: any) => `<tr><td class="k">${esc(k)}</td><td style="text-align:right;font-weight:700">${esc(v)}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>TERAS UNIVERSAL — Executive Summary</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:30px;max-width:620px;margin:auto}h1{font-size:20px;margin:0}p{color:#667085;font-size:13px}table{width:100%;font-size:14px;margin-top:16px;border-collapse:collapse}td{padding:9px 4px;border-bottom:1px solid #eee}td.k{color:#333}</style>
</head><body onload="window.print()">
<h1>TERAS UNIVERSAL — Executive Summary</h1><p>Generated ${stamp}</p>
<table>${row("Total participants", participants.count ?? 0)}${row("Total companies", companies.count ?? 0)}${row("Total courses", courses.count ?? 0)}${row("Training schedules", schedules.count ?? 0)}${row("Total trainers", trainers.count ?? 0)}${row("Certificates issued", certs.count ?? 0)}${row("Upcoming courses", upcoming.count ?? 0)}</table>
</body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const def = REPORTS[report];
  if (!def) return new NextResponse("Unknown report", { status: 400 });
  const { data, error } = await supabase.from(def.table).select(def.columns.map(([k]) => k).join(",")).is("deleted_at", null).order(def.order);
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as any[];

  if (format === "excel") {
    const head = def.columns.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = rows.map((r) => `<tr>${def.columns.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="report-${report}-${stamp}.xls"` } });
  }
  const escCsv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [def.columns.map(([, l]) => l).join(","), ...rows.map((r) => def.columns.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="report-${report}-${stamp}.csv"` } });
}
