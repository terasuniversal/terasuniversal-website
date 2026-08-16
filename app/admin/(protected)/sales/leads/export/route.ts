import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../../lib/auth/session";
import { isEditor } from "../../../../../../lib/auth/rbac";
import { SOURCE_LABELS, sanitizeSearchTerm, type SalesLeadInboxRow } from "../../../../../../lib/sales/crm";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";

/**
 * Exports the current filtered Lead Inbox as CSV. Read access = editor and
 * above, matching sales_lead_metadata's own RLS floor. Internal notes are
 * never included — this exports only the same columns already visible in
 * the inbox table, per the task's explicit "do not export internal notes
 * by default."
 */
const COLUMNS: [string, (r: SalesLeadInboxRow, staffNames: Map<string, string>) => string][] = [
  ["Source", (r) => SOURCE_LABELS[r.lead_source]],
  ["Contact", (r) => r.contact_name ?? ""],
  ["Company", (r) => r.company ?? ""],
  ["Email", (r) => r.email ?? ""],
  ["Phone", (r) => r.phone ?? ""],
  ["Status", (r) => r.status.replace(/_/g, " ")],
  ["Assigned To", (r, names) => (r.assigned_to ? names.get(r.assigned_to) ?? "" : "Unassigned")],
  ["Follow-up", (r) => (r.follow_up_at ? formatMalaysiaDateTime(r.follow_up_at) : "")],
  ["Created At", (r) => formatMalaysiaDateTime(r.created_at)],
];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: staffRows } = await supabase.from("profiles").select("id, full_name");
  const staffNames = new Map(((staffRows ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));

  let query = supabase.from("v_sales_lead_inbox").select("*").order("created_at", { ascending: false }).limit(5000);
  if (p.get("q")) {
    const term = sanitizeSearchTerm(p.get("q")!);
    if (term) query = query.or(`contact_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,subject.ilike.%${term}%`);
  }
  if (p.get("status")) query = query.eq("status", p.get("status")!);
  if (p.get("source")) query = query.eq("lead_source", p.get("source")!);
  if (p.get("assigned")) query = p.get("assigned") === "unassigned" ? query.is("assigned_to", null) : query.eq("assigned_to", p.get("assigned")!);
  if (p.get("from")) query = query.gte("created_at", p.get("from")!);
  if (p.get("to")) query = query.lte("created_at", `${p.get("to")}T23:59:59`);

  const { data, error } = await query;
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as SalesLeadInboxRow[];

  await supabase.rpc("log_event" as never, {
    p_action: "export",
    p_entity_type: "sales_leads",
    p_summary: `Exported ${rows.length} sales leads (CSV)`,
  } as never);

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    COLUMNS.map(([label]) => label).join(","),
    ...rows.map((r) => COLUMNS.map(([, get]) => esc(get(r, staffNames))).join(",")),
  ].join("\n");

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-leads-${stamp}.csv"`,
    },
  });
}
