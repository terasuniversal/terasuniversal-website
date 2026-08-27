import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../lib/auth/session";
import { isEditor } from "../../../../../lib/auth/rbac";
import { writeAuditEvent } from "../../../../../lib/audit/server";

/**
 * Company export.
 *   ?format=csv | excel        → the (filtered) company list
 *   ?format=profile&id=<uuid>  → printable Company Profile Report (PDF placeholder)
 * View = editor and above.
 */
const COLUMNS: [string, string][] = [
  ["company_id", "Company ID"], ["company_name", "Name"], ["registration_no", "Reg. No."],
  ["industry", "Industry"], ["company_type", "Type"], ["state", "State"],
  ["person_in_charge", "PIC"], ["pic_phone", "PIC Phone"], ["email", "Email"], ["status", "Status"],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("companies"))) return new NextResponse("Forbidden", { status: 403 });
  const p = request.nextUrl.searchParams;
  const format = p.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "profile") {
    const id = p.get("id");
    if (!id) return new NextResponse("Missing id", { status: 400 });
    const { data: c } = await supabase.from("companies").select("*").eq("id", id).single();
    if (!c) return new NextResponse("Not found", { status: 404 });
    const { count: pCount } = await supabase.from("participants").select("*", { count: "exact", head: true }).eq("company_id", id).is("deleted_at", null);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Company Report — ${esc(c.company_name)}</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:28px;max-width:760px;margin:auto}h1{font-size:20px;margin:0}h2{font-size:14px;border-bottom:2px solid #E1A925;padding-bottom:4px;margin:20px 0 8px}table{width:100%;font-size:13px}td.k{color:#667085;width:190px}td{padding:4px 0;vertical-align:top}</style>
</head><body onload="window.print()">
<h1>${esc(c.company_name)}</h1><p style="color:#667085;margin:2px 0 0">${esc(c.company_id)} · ${esc(c.industry ?? "")} · ${esc(c.status)}</p>
<h2>Company</h2><table>
<tr><td class="k">Registration No.</td><td>${esc(c.registration_no ?? "—")}</td></tr>
<tr><td class="k">Type</td><td>${esc(c.company_type ?? "—")}</td></tr>
<tr><td class="k">Address</td><td>${esc([c.address, c.city, c.postcode, c.state, c.country].filter(Boolean).join(", "))}</td></tr>
<tr><td class="k">Phone / Email</td><td>${esc(c.phone ?? "—")} · ${esc(c.email ?? "—")}</td></tr>
<tr><td class="k">Total participants</td><td>${pCount ?? 0}</td></tr></table>
<h2>Person In Charge</h2><table>
<tr><td class="k">Name</td><td>${esc(c.person_in_charge ?? "—")}</td></tr>
<tr><td class="k">Position</td><td>${esc(c.pic_position ?? "—")}</td></tr>
<tr><td class="k">Phone / Email</td><td>${esc(c.pic_phone ?? "—")} · ${esc(c.pic_email ?? "—")}</td></tr></table>
</body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  let query = supabase.from("companies").select(COLUMNS.map(([k]) => k).join(",")).is("deleted_at", null).order("company_id");
  if (p.get("q")) query = query.or(`company_name.ilike.%${p.get("q")}%,company_id.ilike.%${p.get("q")}%,industry.ilike.%${p.get("q")}%`);
  if (p.get("status")) query = query.eq("status", p.get("status") as any);
  if (p.get("industry")) query = query.eq("industry", p.get("industry")!);
  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as any[];
  await writeAuditEvent({ action: "export", entityType: "companies", summary: `Exported ${rows.length} companies (${format})` });

  if (format === "excel") {
    const head = COLUMNS.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = rows.map((r: Record<string, any>) => `<tr>${COLUMNS.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="companies-${stamp}.xls"` } });
  }
  const escCsv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [COLUMNS.map(([, l]) => l).join(","), ...rows.map((r: Record<string, any>) => COLUMNS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="companies-${stamp}.csv"` } });
}
