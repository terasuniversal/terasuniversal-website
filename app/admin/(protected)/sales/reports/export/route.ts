import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { getCurrentProfile } from "../../../../../../lib/auth/session";
import { isEditor } from "../../../../../../lib/auth/rbac";
import { resolveReportDateRange, monthKeysInRange, mytMonthKey, monthKeyLabel, REPORT_RANGE_KEYS, type ReportRangeKey } from "../../../../../../lib/sales/reports";

/**
 * Exports the Monthly Trend summary for the selected date range as CSV.
 * Read access = editor+, matching the report page's own RLS floor.
 * Only aggregate counts/values — no internal notes, no participant PII, no
 * activity text (Task 13's explicit exclusions).
 */
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isEditor(profile.role)) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const rangeKey: ReportRangeKey = (REPORT_RANGE_KEYS as readonly string[]).includes(p.get("range") ?? "") ? (p.get("range") as ReportRangeKey) : "this_month";
  const range = resolveReportDateRange(rangeKey, { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });

  // Same source table + timestamp per metric as the report page itself
  // (Task 19) — never a different, inconsistent shortcut for the export.
  // Test/demo chains (is_test=true) are excluded.
  const supabase = await createSupabaseServerClient();
  const leadsQuery = supabase.from("sales_lead_metadata").select("id, created_at, status").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const opportunitiesQuery = supabase.from("sales_opportunities").select("id, created_at").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
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
  if (error) return new NextResponse(error.message, { status: 500 });

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
  const { data: leadsWithOppRaw } = leadIds.length
    ? await supabase.from("sales_opportunities").select("lead_metadata_id").eq("is_test", false).in("lead_metadata_id", leadIds)
    : { data: [] as any[] };
  const leadIdsWithOpportunity = new Set((leadsWithOppRaw ?? []).map((o: any) => o.lead_metadata_id));
  const isQualified = (l: any) => qualifiedStatuses.has(l.status) || leadIdsWithOpportunity.has(l.id);

  const monthKeys = monthKeysInRange(range.startUtc, range.endUtc);
  const rows = monthKeys.map((mk) => ({
    month: monthKeyLabel(mk),
    leads: leads.filter((l: any) => mytMonthKey(l.created_at) === mk).length,
    qualified: leads.filter((l: any) => mytMonthKey(l.created_at) === mk && isQualified(l)).length,
    opportunities: opps.filter((o: any) => mytMonthKey(o.created_at) === mk).length,
    quotationsSent: new Set(quotationsSent.filter((q: any) => mytMonthKey(q.sent_at) === mk).map((q: any) => q.opportunity_id)).size,
    won: won.filter((o: any) => mytMonthKey(o.won_at) === mk).length,
    lost: lost.filter((o: any) => mytMonthKey(o.lost_at) === mk).length,
    wonValue: accepted.filter((q: any) => mytMonthKey(q.accepted_at) === mk).reduce((s: number, q: any) => s + Number(q.total), 0),
  }));

  await supabase.rpc("log_event" as never, {
    p_action: "export",
    p_entity_type: "sales_reports",
    p_summary: `Exported Sales Reports monthly summary (${range.startDateLabel} to ${range.endDateLabel})`,
  } as never);

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Month", "Leads", "Qualified", "Opportunities", "Quotations Sent", "Won", "Lost", "Won Value"];
  const csv = [
    header.join(","),
    ...rows.map((r) => [r.month, r.leads, r.qualified, r.opportunities, r.quotationsSent, r.won, r.lost, r.wonValue.toFixed(2)].map(esc).join(",")),
  ].join("\n");

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-reports-${stamp}.csv"`,
    },
  });
}
