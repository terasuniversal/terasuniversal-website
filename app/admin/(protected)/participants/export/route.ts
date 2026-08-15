import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../lib/auth/session";
import { isEditor } from "../../../../../lib/auth/rbac";
import { writeAuditEvent } from "../../../../../lib/audit/server";

/**
 * Export participants honouring the current list filters.
 *   ?format=csv    → text/csv (UTF-8 BOM so Excel reads unicode correctly)
 *   ?format=excel  → an Excel-openable HTML table (application/vnd.ms-excel),
 *                    dependency-free (no SheetJS needed in the sandbox).
 * Filters: q, status, company, deleted. Read access = editor and above.
 */
const COLUMNS: [string, string][] = [
  ["participant_id", "Participant ID"],
  ["full_name", "Full Name"],
  ["ic_passport_no", "IC / Passport"],
  ["nationality", "Nationality"],
  ["gender", "Gender"],
  ["date_of_birth", "Date of Birth"],
  ["company", "Company"],
  ["position", "Position"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address", "Address"],
  ["emergency_contact_name", "Emergency Contact"],
  ["emergency_contact_phone", "Emergency Phone"],
  ["status", "Status"],
  ["registration_date", "Registration Date"],
  ["created_at", "Created"],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const format = p.get("format") === "excel" ? "excel" : "csv";
  const supabase = await createSupabaseServerClient();

  let query = supabase.from("participants").select(COLUMNS.map(([k]) => k).join(",")).order("created_at", { ascending: false });
  query = p.get("deleted") === "1" ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (p.get("q")) query = query.or(`full_name.ilike.%${p.get("q")}%,participant_id.ilike.%${p.get("q")}%,ic_passport_no.ilike.%${p.get("q")}%,company.ilike.%${p.get("q")}%`);
  if (p.get("status")) query = query.eq("status", p.get("status") as any);
  if (p.get("company")) query = query.eq("company", p.get("company")!);

  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as any[];

  // Best-effort audit note.
  await writeAuditEvent({ action: "export", entityType: "participants", summary: `Exported ${rows.length} participants (${format})` });

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "excel") {
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = COLUMNS.map(([, label]) => `<th>${esc(label)}</th>`).join("");
    const body = rows
      .map((r) => `<tr>${COLUMNS.map(([k]) => `<td>${esc(r[k])}</td>`).join("")}</tr>`)
      .join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${`<tr>${head}</tr>`}${body}</table></body></html>`;
    return new NextResponse(html, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="participants-${stamp}.xls"`,
      },
    });
  }

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    COLUMNS.map(([, label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([k]) => esc(r[k])).join(",")),
  ].join("\n");

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="participants-${stamp}.csv"`,
    },
  });
}
