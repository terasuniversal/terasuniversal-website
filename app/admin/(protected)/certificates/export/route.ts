import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../lib/auth/session";
import { canViewCertificate } from "../../../../../lib/auth/rbac";

/**
 * Certificate Register export.
 *   ?format=csv | excel | register
 * "register" = printable Certificate Register (the PDF placeholder — print/save
 * as PDF). Honours status/search filters. View = all staff.
 */
const COLUMNS: [string, string][] = [
  ["certificate_number", "Certificate No."],
  ["holder_name", "Holder"],
  ["course_title", "Course"],
  ["status", "Status"],
  ["issue_date", "Issue Date"],
  ["expiry_date", "Expiry Date"],
  ["verification_token", "Verification Token"],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !canViewCertificate(profile.role)) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const format = p.get("format") ?? "csv";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("certificates")
    .select("certificate_number, holder_name, status, issue_date, expiry_date, verification_token, courses(title)")
    .is("deleted_at", null)
    .order("issue_date", { ascending: false });
  if (p.get("q")) query = query.or(`certificate_number.ilike.%${p.get("q")}%,holder_name.ilike.%${p.get("q")}%`);
  if (p.get("status")) query = query.eq("status", p.get("status") as any);

  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []).map((r: any) => ({
    certificate_number: r.certificate_number, holder_name: r.holder_name, course_title: r.courses?.title ?? "",
    status: r.status, issue_date: r.issue_date ?? "", expiry_date: r.expiry_date ?? "", verification_token: r.verification_token ?? "",
  }));

  await supabase.rpc("log_event" as never, { p_action: "export", p_entity_type: "certificates", p_summary: `Exported ${rows.length} certificates (${format})` } as never);

  const stamp = new Date().toISOString().slice(0, 10);
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (format === "excel" || format === "register") {
    const head = COLUMNS.map(([, l]) => `<th>${esc(l)}</th>`).join("");
    const body = rows.map((r: Record<string, any>) => `<tr>${COLUMNS.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("");
    if (format === "register") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Certificate Register</title>
<style>body{font-family:Arial,sans-serif;color:#0B2C56;padding:26px}h1{font-size:19px;margin:0 0 4px}p{margin:2px 0;color:#555;font-size:13px}table{border-collapse:collapse;width:100%;font-size:11.5px;margin-top:16px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#0B2C56;color:#fff}</style>
</head><body onload="window.print()"><h1>TERAS UNIVERSAL — Certificate Register</h1><p>Generated ${stamp} · ${rows.length} record(s)</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const xls = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`;
    return new NextResponse(xls, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="certificate-register-${stamp}.xls"` } });
  }

  const escCsv = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [COLUMNS.map(([, l]) => l).join(","), ...rows.map((r: Record<string, any>) => COLUMNS.map(([k]) => escCsv(r[k])).join(","))].join("\n");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="certificate-register-${stamp}.csv"` } });
}
