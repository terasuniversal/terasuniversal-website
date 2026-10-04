import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../../lib/auth/session";
import { isEditor } from "../../../../../../lib/auth/rbac";
import { resolveReportDateRange, buildMonthlyTrend, REPORT_RANGE_KEYS, type ReportRangeKey } from "../../../../../../lib/sales/reports";

/**
 * Exports the Monthly Trend summary for the selected date range as CSV.
 * Read access = editor+, matching the report page's own RLS floor.
 * Only aggregate counts/values — no internal notes, no participant PII, no
 * activity text (Task 13's explicit exclusions).
 *
 * Historical event totals include archived real records, matching the page.
 * Only test/demo records are excluded from the monthly trend.
 */
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("sales_reports"))) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const rangeKey: ReportRangeKey = (REPORT_RANGE_KEYS as readonly string[]).includes(p.get("range") ?? "") ? (p.get("range") as ReportRangeKey) : "this_month";
  const range = resolveReportDateRange(rangeKey, { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });

  // Same source table + timestamp per metric as the report page itself
  // (Task 19) — never a different, inconsistent shortcut for the export.
  // Test/demo chains (is_test=true) are excluded.
  const supabase = await createSupabaseServerClient();
  const leadsQuery = supabase.from("sales_lead_metadata").select("id, created_at, status").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const opportunitiesQuery = supabase.from("sales_opportunities").select("id, created_at, stage, lead_metadata_id").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const quotationsSentQuery = supabase
    .from("sales_quotations")
    .select("opportunity_id, sent_at")
    .eq("is_test", false)
    .not("sent_at", "is", null)
    .gte("sent_at", range.startUtc)
    .lt("sent_at", range.endUtc);
  const wonQuery = supabase.from("sales_opportunities").select("id, won_at").eq("is_test", false).eq("stage", "won").not("won_at", "is", null).gte("won_at", range.startUtc).lt("won_at", range.endUtc);
  const lostQuery = supabase.from("sales_opportunities").select("id, lost_at").eq("is_test", false).eq("stage", "lost").not("lost_at", "is", null).gte("lost_at", range.startUtc).lt("lost_at", range.endUtc);
  const acceptedQuery = supabase
    .from("sales_quotations")
    .select("opportunity_id, total, accepted_at")
    .eq("is_test", false)
    .eq("status", "accepted")
    .not("accepted_at", "is", null)
    .gte("accepted_at", range.startUtc)
    .lt("accepted_at", range.endUtc);

  const [
    { data: leadsRaw, error: e1 },
    { data: oppsRaw, error: e2 },
    { data: quotationsSentRaw, error: e3 },
    { data: wonRaw, error: e4 },
    { data: lostRaw, error: e5 },
    { data: acceptedRaw, error: e6 },
  ] = await Promise.all([leadsQuery, opportunitiesQuery, quotationsSentQuery, wonQuery, lostQuery, acceptedQuery]);
  const error = e1 || e2 || e3 || e4 || e5 || e6;
  if (error) return new NextResponse("Sales report export unavailable", { status: 500 });

  const leads = leadsRaw ?? [];
  const opps = oppsRaw ?? [];
  const quotationsSent = quotationsSentRaw ?? [];
  const won = wonRaw ?? [];
  const lost = lostRaw ?? [];
  const accepted = acceptedRaw ?? [];
  const qualifiedStatuses = new Set(["qualified", "proposal_sent", "negotiation", "won", "lost"]);

  // Same correction as the report page: convert_lead_to_opportunity() does
  // not update the source lead's own status, so status alone undercounts —
  // a lead with an Opportunity at all counts as qualified regardless of
  // its own (possibly stale) status column.
  const leadIds = leads.map((l: any) => l.id);
  const { data: leadsWithOppRaw, error: leadsWithOppError } = leadIds.length
    ? await supabase.from("sales_opportunities").select("id, stage, lead_metadata_id").eq("is_test", false).in("lead_metadata_id", leadIds)
    : { data: [] as any[], error: null };
  if (leadsWithOppError) return new NextResponse("Sales report export unavailable", { status: 500 });

  const leadIdsWithOpportunity = new Set<string>((leadsWithOppRaw ?? []).map((o: any) => o.lead_metadata_id));
  const qualifiedLeadIds = new Set<string>(leads.filter((l: any) => qualifiedStatuses.has(l.status) || leadIdsWithOpportunity.has(l.id)).map((l: any) => l.id));

  // Use the same source rows and date buckets as the page's Monthly Trend.
  const rows = buildMonthlyTrend({
    range,
    leads,
    qualifiedLeadIds,
    opps,
    quotationsSent,
    won,
    lost,
    accepted,
  });

  const { error: auditError } = await supabase.rpc("log_event" as never, {
    p_action: "export",
    p_entity_type: "sales_reports",
    p_summary: `Exported Sales Reports monthly summary (${range.startDateLabel} to ${range.endDateLabel})`,
  } as never);
  if (auditError) return new NextResponse("Sales report export unavailable", { status: 500 });

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Month (Malaysia time)", "Leads Created", "Qualified Now (Estimate, Lead Creation Month)", "Opportunities Created", "Quotations Sent", "Won Events", "Lost Events", "Accepted Quotation Value"];
  const csv = [
    header.map(esc).join(","),
    ...rows.map((r) => [r.month, r.leads, r.qualified, r.opportunities, r.quotationsSent, r.won, r.lost, r.acceptedQuotationValue.toFixed(2)].map(esc).join(",")),
  ].join("\n");

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-reports-${stamp}.csv"`,
    },
  });
}
