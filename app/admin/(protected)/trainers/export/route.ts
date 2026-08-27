import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../lib/auth/session";
import { isEditor } from "../../../../../lib/auth/rbac";
import { writeAuditEvent } from "../../../../../lib/audit/server";

/**
 * Trainer export.
 *   ?format=csv | excel        → the (filtered) trainer list
 *   ?format=profile&id=<uuid>  → printable Trainer Profile (PDF placeholder)
 * View access = editor and above.
 */
const COLUMNS: [string, string][] = [
  ["trainer_id", "Trainer ID"], ["full_name", "Name"], ["staff_no", "Staff No."],
  ["department", "Department"], ["position", "Position"], ["employment_type", "Employment"],
  ["specialisation", "Specialisation"], ["email", "Email"], ["phone", "Phone"], ["status", "Status"],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("trainers"))) return new NextResponse("Forbidden", { status: 403 });
  const p = request.nextUrl.searchParams;
  const format = p.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // --- Single trainer profile (printable) ---
  if (format === "profile") {
    const id = p.get("id");
    if (!id) return new NextResponse("Missing id", { status: 400 });
    const { data: t } = await supabase.from("trainers").select("*").eq("id", id).single();
    if (!t) return new NextResponse("Not found", { status: 404 });
    const list = (arr: any[]) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "—");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Trainer Profile — ${esc(t.full_name)}</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:28px;max-width:760px;margin:auto}h1{font-size:20px;margin:0}h2{font-size:14px;border-bottom:2px solid #E1A925;padding-bottom:4px;margin:20px 0 8px}table{width:100%;font-size:13px}td{padding:4px 0;vertical-align:top}td.k{color:#667085;width:180px}</style>
</head><body onload="window.print()">
<h1>${esc(t.full_name)}</h1><p style="color:#667085;margin:2px 0 0">${esc(t.trainer_id)} · ${esc(t.position ?? "")} · ${esc(t.status)}</p>
<h2>Employment</h2><table>
<tr><td class="k">Staff No.</td><td>${esc(t.staff_no ?? "—")}</td></tr>
<tr><td class="k">Department</td><td>${esc(t.department ?? "—")}</td></tr>
<tr><td class="k">Employment type</td><td>${esc(t.employment_type ?? "—")}</td></tr>
<tr><td class="k">Joining date</td><td>${esc(t.joining_date ?? "—")}</td></tr>
<tr><td class="k">Email</td><td>${esc(t.email ?? "—")}</td></tr>
<tr><td class="k">Phone</td><td>${esc(t.phone ?? "—")}</td></tr></table>
<h2>Specialisation</h2><p>${esc(t.specialisation ?? "—")}</p>
<h2>Competencies</h2>${list(t.competencies ?? [])}
<h2>Qualifications</h2>${list(t.qualifications ?? [])}
</body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // --- List export ---
  let query = supabase.from("trainers").select(COLUMNS.map(([k]) => k).join(",")).is("deleted_at", null).order("trainer_id");
  if (p.get("q")) query = query.or(`full_name.ilike.%${p.get("q")}%,trainer_id.ilike.%${p.get("q")}%,department.ilike.%${p.get("q")}%`);
  if (p.get("status")) query = query.eq("status", p.get("status") as any);
  if (p.get("employment_type")) query = query.eq("employment_type", p.get("employment_type")!);
  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as any[];

  await writeAuditEvent({ action: "export", entityType: "trainers", summary: `Exported ${rows.length} trainers (${format})` });

  if (format === "excel") {
    const head = COLUMNS.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = rows.map((r: Record<string, any>) => `<tr>${COLUMNS.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="trainers-${stamp}.xls"` } });
  }
  const escCsv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [COLUMNS.map(([, l]) => l).join(","), ...rows.map((r: Record<string, any>) => COLUMNS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trainers-${stamp}.csv"` } });
}
