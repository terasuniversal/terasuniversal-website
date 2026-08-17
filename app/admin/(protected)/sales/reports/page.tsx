import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../../components/admin/ui";
import {
  SOURCE_LABELS,
  LOST_REASON_LABELS,
  LOST_REASONS,
  OPPORTUNITY_STAGE_ORDER,
  OPPORTUNITY_STAGE_LABELS,
  type SalesLeadSourceKind,
  type SalesOpportunityStage,
  type SalesCrmLostReason,
} from "../../../../../lib/sales/crm";
import {
  resolveReportDateRange,
  monthKeysInRange,
  mytMonthKey,
  monthKeyLabel,
  conversionRate,
  REPORT_RANGE_KEYS,
  REPORT_RANGE_LABELS,
  type ReportRangeKey,
} from "../../../../../lib/sales/reports";

export const metadata = { title: "Sales Reports — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Sales CRM Phase 4C — real Sales Reports & Analytics, replacing the
 * SalesPlaceholder demo stub. Every number below is computed from live
 * sales_lead_metadata / sales_opportunities / sales_quotations /
 * sales_tasks rows fetched in a small, fixed set of batched queries (no
 * N+1, no per-row queries) and aggregated in memory — data volumes on this
 * CRM are small enough that this is simpler and safer than adding a new
 * view/RPC (Task 14: only add one if justified; it isn't here).
 *
 * DATA SOURCE / TIMESTAMP MAP (Task 19 — documented explicitly, never
 * silently chosen):
 *   Lead              <- sales_lead_metadata, filtered by created_at
 *   Qualified         <- sales_lead_metadata, filtered by created_at:
 *                        current status in (qualified, proposal_sent,
 *                        negotiation, won, lost) OR the lead already has a
 *                        sales_opportunities row. The OR-opportunity check
 *                        is required, not optional — verified live that
 *                        convert_lead_to_opportunity() does NOT update the
 *                        source lead's own status column, so a lead that
 *                        has genuinely become a full Opportunity can still
 *                        read status='new'; status alone would silently
 *                        undercount. No qualified_at timestamp exists on
 *                        this table, so this is a current-state snapshot,
 *                        not a reconstructed historical funnel.
 *   Opportunity       <- sales_opportunities, filtered by created_at
 *   Quotation Sent     <- sales_quotations, filtered by sent_at (not
 *                        created_at — a drafted-but-never-sent quotation
 *                        must never count here), distinct opportunity_id
 *                        (a revised-and-resent quotation thread counts its
 *                        opportunity once)
 *   Won               <- sales_opportunities where stage = 'won', filtered
 *                        by won_at
 *   Lost              <- sales_opportunities where stage = 'lost',
 *                        filtered by lost_at
 *   Accepted / Won Value <- sales_quotations where status = 'accepted',
 *                        filtered by accepted_at, SUM(total). Never
 *                        opportunities.estimated_value, never a draft or
 *                        proposal figure. An opportunity can have at most
 *                        one accepted quotation in practice (accept_quotation()'s
 *                        own guard blocks accepting a second quotation once
 *                        the opportunity is already won/lost — verified
 *                        live, 0 opportunities with >1 accepted quotation
 *                        at audit time), so summing accepted quotations
 *                        directly is not a double-counting risk.
 *   Opportunity Stage  <- sales_opportunities, filtered by created_at;
 *                        'archived' is excluded (an administratively
 *                        hidden/dead record, not a live pipeline stage).
 *
 * Deduplication (Task 2): sales_lead_metadata has a real
 * unique(lead_source, source_id) constraint (one row per source lead) and
 * sales_opportunities has unique(lead_metadata_id) (at most one
 * opportunity per lead) — every count below is a plain COUNT/GROUP BY over
 * already-deduplicated rows, not a join that could multiply them.
 *
 * Soft-deletes: sales_lead_metadata/sales_opportunities/sales_quotations
 * have no deleted_at column (none exists live) — nothing to filter.
 * sales_tasks does; every task query below filters deleted_at is null.
 */

const LEAD_SOURCES: SalesLeadSourceKind[] = ["enquiry", "proposal_request"];
const REPORTABLE_STAGES: SalesOpportunityStage[] = OPPORTUNITY_STAGE_ORDER.filter((s) => s !== "archived");
const QUALIFIED_OR_LATER = new Set(["qualified", "proposal_sent", "negotiation", "won", "lost"]);

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="ta-report-bar-row">
      <span>{label}</span>
      <span className="ta-report-bar-track">
        <span className="ta-report-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span style={{ textAlign: "right" }}>
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

function money(n: number) {
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

export default async function SalesReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("sales_reports");
  const sp = await searchParams;
  const rangeKey: ReportRangeKey = (REPORT_RANGE_KEYS as readonly string[]).includes(sp.range ?? "") ? (sp.range as ReportRangeKey) : "this_month";
  const range = resolveReportDateRange(rangeKey, { from: sp.from, to: sp.to });

  const supabase = await createSupabaseServerClient();

  // ---- One fixed batch of independent queries — no await inside the array literal (CLAUDE.md §5/§13). ----
  // Test/demo chains (is_test=true) are excluded from every report metric.
  const leadsQuery = supabase.from("sales_lead_metadata").select("*").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const opportunitiesQuery = supabase.from("sales_opportunities").select("*").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const quotationsCreatedQuery = supabase.from("sales_quotations").select("*").eq("is_test", false).gte("created_at", range.startUtc).lt("created_at", range.endUtc);
  const quotationsSentQuery = supabase
    .from("sales_quotations")
    .select("*")
    .eq("is_test", false)
    .not("sent_at", "is", null)
    .gte("sent_at", range.startUtc)
    .lt("sent_at", range.endUtc);
  const acceptedQuotationsQuery = supabase
    .from("sales_quotations")
    .select("*")
    .eq("is_test", false)
    .eq("status", "accepted")
    .not("accepted_at", "is", null)
    .gte("accepted_at", range.startUtc)
    .lt("accepted_at", range.endUtc);
  const wonOpportunitiesQuery = supabase
    .from("sales_opportunities")
    .select("*")
    .eq("is_test", false)
    .eq("stage", "won")
    .not("won_at", "is", null)
    .gte("won_at", range.startUtc)
    .lt("won_at", range.endUtc);
  const lostOpportunitiesQuery = supabase
    .from("sales_opportunities")
    .select("*")
    .eq("is_test", false)
    .eq("stage", "lost")
    .not("lost_at", "is", null)
    .gte("lost_at", range.startUtc)
    .lt("lost_at", range.endUtc);
  const tasksDueQuery = supabase
    .from("sales_tasks")
    .select("*")
    .is("deleted_at", null)
    .not("due_at", "is", null)
    .gte("due_at", range.startUtc)
    .lt("due_at", range.endUtc)
    .not("status", "in", "(completed,cancelled)");
  const staffQuery = supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");

  const [
    { data: leadsRaw },
    { data: oppsRaw },
    { data: quotationsCreatedRaw },
    { data: quotationsSentRaw },
    { data: acceptedRaw },
    { data: wonRaw },
    { data: lostRaw },
    { data: tasksDueRaw },
    { data: staffRaw },
  ] = await Promise.all([
    leadsQuery,
    opportunitiesQuery,
    quotationsCreatedQuery,
    quotationsSentQuery,
    acceptedQuotationsQuery,
    wonOpportunitiesQuery,
    lostOpportunitiesQuery,
    tasksDueQuery,
    staffQuery,
  ]);

  const leads = leadsRaw ?? [];
  const opps = oppsRaw ?? [];
  const quotationsCreated = quotationsCreatedRaw ?? [];
  const quotationsSent = quotationsSentRaw ?? [];
  const accepted = acceptedRaw ?? [];
  const won = wonRaw ?? [];
  const lost = lostRaw ?? [];
  const tasksDue = tasksDueRaw ?? [];
  const staff = (staffRaw ?? []) as { id: string; full_name: string }[];

  // ---- Qualified, corrected for a real data-model gap found during
  // verification: convert_lead_to_opportunity() does not update the source
  // lead's own sales_lead_metadata.status -- a lead that has already become
  // a full Opportunity (proof of qualification by definition) can still
  // read status='new'. Relying on status alone would silently undercount.
  // A lead counts as qualified if its status says so OR it has an
  // Opportunity at all (checked without the date-range filter that `opps`
  // carries, since the lead's qualification is a fact regardless of which
  // period its opportunity row happens to have been created in). ----
  const leadIds = leads.map((l: any) => l.id);
  const { data: leadsWithOppRaw } = leadIds.length
    ? await supabase.from("sales_opportunities").select("lead_metadata_id").eq("is_test", false).in("lead_metadata_id", leadIds)
    : { data: [] as any[] };
  const leadIdsWithOpportunity = new Set((leadsWithOppRaw ?? []).map((o: any) => o.lead_metadata_id));
  const isQualified = (l: any) => QUALIFIED_OR_LATER.has(l.status) || leadIdsWithOpportunity.has(l.id);

  // ---- Top Programmes: participant counts, only where a real handoff exists (Phase 3 traceability). ----
  const wonOppIds = won.map((o: any) => o.id);
  const { data: schedulesForWon } = wonOppIds.length
    ? await supabase.from("course_schedules").select("id, source_opportunity_id").in("source_opportunity_id", wonOppIds)
    : { data: [] as any[] };
  const scheduleIds = (schedulesForWon ?? []).map((s: any) => s.id);
  const { data: enrolledRows } = scheduleIds.length
    ? await supabase.from("schedule_participants").select("schedule_id").in("schedule_id", scheduleIds).is("deleted_at", null).neq("registration_status", "cancelled")
    : { data: [] as any[] };
  const scheduleToOpp = new Map<string, string>((schedulesForWon ?? []).map((s: any) => [s.id, s.source_opportunity_id]));
  const participantsByOpp = new Map<string, number>();
  for (const row of enrolledRows ?? []) {
    const oppId = scheduleToOpp.get((row as any).schedule_id);
    if (oppId) participantsByOpp.set(oppId, (participantsByOpp.get(oppId) ?? 0) + 1);
  }

  // ==================================================================
  // Task 2/3 — Funnel + conversion rates
  // ==================================================================
  const leadCount = leads.length;
  const qualifiedCount = leads.filter(isQualified).length;
  const opportunityCount = opps.length;
  const quotationSentOppCount = new Set(quotationsSent.map((q: any) => q.opportunity_id)).size;
  const wonCount = won.length;

  const funnel = [
    { label: "Lead", value: leadCount },
    { label: "Qualified", value: qualifiedCount },
    { label: "Opportunity", value: opportunityCount },
    { label: "Quotation Sent", value: quotationSentOppCount },
    { label: "Won", value: wonCount },
  ];
  const funnelMax = Math.max(1, leadCount);

  const conversions = [
    { label: "Lead → Qualified", value: conversionRate(qualifiedCount, leadCount) },
    { label: "Qualified → Opportunity", value: conversionRate(opportunityCount, qualifiedCount) },
    { label: "Opportunity → Quotation Sent", value: conversionRate(quotationSentOppCount, opportunityCount) },
    { label: "Quotation Sent → Won", value: conversionRate(wonCount, quotationSentOppCount) },
    { label: "Lead → Won (overall)", value: conversionRate(wonCount, leadCount) },
  ];

  // ==================================================================
  // Task 4 — Lead source
  // ==================================================================
  const leadSourceRows = LEAD_SOURCES.map((source) => {
    const sourceLeads = leads.filter((l: any) => l.lead_source === source);
    const sourceLeadIds = new Set(sourceLeads.map((l: any) => l.id));
    const sourceQualified = sourceLeads.filter(isQualified).length;
    const sourceOpps = opps.filter((o: any) => sourceLeadIds.has(o.lead_metadata_id)).length;
    const sourceWon = won.filter((o: any) => sourceLeadIds.has(o.lead_metadata_id)).length;
    return { source, label: SOURCE_LABELS[source], total: sourceLeads.length, qualified: sourceQualified, opportunities: sourceOpps, won: sourceWon };
  });

  // ==================================================================
  // Task 5 — Opportunity stage distribution
  // ==================================================================
  const stageRows = REPORTABLE_STAGES.map((stage) => ({
    stage,
    label: OPPORTUNITY_STAGE_LABELS[stage],
    count: opps.filter((o: any) => o.stage === stage).length,
  }));
  const stageMax = Math.max(1, ...stageRows.map((r) => r.count));

  // ==================================================================
  // Task 6 — Quotation performance
  // ==================================================================
  const sentCount = quotationsSent.length;
  const acceptedAmongSent = quotationsSent.filter((q: any) => q.status === "accepted").length;
  const rejectedAmongSent = quotationsSent.filter((q: any) => q.status === "rejected").length;
  const avgAcceptedValue = accepted.length > 0 ? accepted.reduce((sum: number, q: any) => sum + Number(q.total), 0) / accepted.length : null;
  const quotationStatusRows = ["draft", "sent", "accepted", "rejected", "expired", "superseded"].map((status) => ({
    status,
    count: quotationsCreated.filter((q: any) => q.status === status).length,
  }));

  // ==================================================================
  // Task 7 — Won / Lost
  // ==================================================================
  const winRate = conversionRate(wonCount, wonCount + lost.length);
  const lostReasonRows: { reason: SalesCrmLostReason; label: string; count: number }[] = LOST_REASONS.map((reason) => ({
    reason,
    label: LOST_REASON_LABELS[reason],
    count: lost.filter((o: any) => o.lost_reason === reason).length,
  })).filter((r) => r.count > 0);

  // ==================================================================
  // Task 8 — Sales value
  // ==================================================================
  const acceptedValue = accepted.reduce((sum: number, q: any) => sum + Number(q.total), 0);
  const avgWonDeal = wonCount > 0 ? acceptedValue / wonCount : null;

  // ==================================================================
  // Task 9 — Top programmes (won opportunities only, exact programme text)
  // ==================================================================
  const acceptedByOpp = new Map<string, number>();
  for (const q of accepted) acceptedByOpp.set((q as any).opportunity_id, ((acceptedByOpp.get((q as any).opportunity_id) ?? 0)) + Number((q as any).total));
  const programmeMap = new Map<string, { count: number; value: number; participants: number }>();
  for (const o of won as any[]) {
    const key = o.programme?.trim() || "(No programme recorded)";
    const entry = programmeMap.get(key) ?? { count: 0, value: 0, participants: 0 };
    entry.count += 1;
    entry.value += acceptedByOpp.get(o.id) ?? 0;
    entry.participants += participantsByOpp.get(o.id) ?? 0;
    programmeMap.set(key, entry);
  }
  const topProgrammes = Array.from(programmeMap.entries())
    .map(([programme, v]) => ({ programme, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // ==================================================================
  // Task 10 — Monthly trend
  // ==================================================================
  const monthKeys = monthKeysInRange(range.startUtc, range.endUtc);
  const monthlyTrend = monthKeys.map((mk) => ({
    month: mk,
    label: monthKeyLabel(mk),
    leads: leads.filter((l: any) => mytMonthKey(l.created_at) === mk).length,
    qualified: leads.filter((l: any) => mytMonthKey(l.created_at) === mk && isQualified(l)).length,
    opportunities: opps.filter((o: any) => mytMonthKey(o.created_at) === mk).length,
    quotationsSent: new Set(quotationsSent.filter((q: any) => mytMonthKey(q.sent_at) === mk).map((q: any) => q.opportunity_id)).size,
    won: won.filter((o: any) => mytMonthKey(o.won_at) === mk).length,
    lost: lost.filter((o: any) => mytMonthKey(o.lost_at) === mk).length,
    wonValue: accepted.filter((q: any) => mytMonthKey(q.accepted_at) === mk).reduce((s: number, q: any) => s + Number(q.total), 0),
  }));

  // ==================================================================
  // Task 11 — Owner summary (operational visibility, not a scoring/ranking)
  // ==================================================================
  const ownerRows = staff
    .map((s) => {
      const ownerLeads = leads.filter((l: any) => l.assigned_to === s.id).length;
      const ownerOpps = opps.filter((o: any) => o.assigned_to === s.id).length;
      const ownerFollowUps = leads.filter((l: any) => l.assigned_to === s.id && l.follow_up_at && !["won", "lost", "archived"].includes(l.status)).length;
      const ownerTasksDue = tasksDue.filter((t: any) => t.assigned_to === s.id).length;
      const ownerWonOpps = won.filter((o: any) => o.assigned_to === s.id);
      const ownerWonValue = ownerWonOpps.reduce((sum: number, o: any) => sum + (acceptedByOpp.get(o.id) ?? 0), 0);
      return { name: s.full_name, leads: ownerLeads, opportunities: ownerOpps, followUps: ownerFollowUps, tasksDue: ownerTasksDue, won: ownerWonOpps.length, wonValue: ownerWonValue };
    })
    .filter((r) => r.leads > 0 || r.opportunities > 0 || r.followUps > 0 || r.tasksDue > 0 || r.won > 0);

  const rangeQs = (extra: Record<string, string> = {}) => new URLSearchParams({ range: rangeKey, ...(rangeKey === "custom" ? { from: sp.from ?? "", to: sp.to ?? "" } : {}), ...extra }).toString();

  return (
    <div className="ta-sales">
      <PageHead
        title="Sales Reports"
        subtitle={`${range.startDateLabel} to ${range.endDateLabel} (Malaysia time) — real records only.`}
        action={
          <a href={`/admin/sales/reports/export?${rangeQs()}`} className="ta-btn ta-btn-outline">
            ⬇ Export Monthly CSV
          </a>
        }
      />

      <form className="ta-toolbar" style={{ flexWrap: "wrap", marginBottom: 18 }}>
        {REPORT_RANGE_KEYS.map((k) => (
          <Link key={k} href={`/admin/sales/reports?${rangeQs({ range: k })}`} className={`ta-btn ta-btn-sm ${rangeKey === k ? "ta-btn-primary" : "ta-btn-outline"}`}>
            {REPORT_RANGE_LABELS[k]}
          </Link>
        ))}
        {rangeKey === "custom" && (
          <>
            <label className="ta-filter-date-group">
              From
              <input type="date" name="from" defaultValue={sp.from ?? ""} className="ta-filter-date" />
            </label>
            <label className="ta-filter-date-group">
              To
              <input type="date" name="to" defaultValue={sp.to ?? ""} className="ta-filter-date" />
            </label>
            <input type="hidden" name="range" value="custom" />
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
          </>
        )}
        {rangeKey !== "custom" && (
          <Link href={`/admin/sales/reports?${rangeQs({ range: "custom" })}`} className="ta-btn ta-btn-outline ta-btn-sm">
            Custom Range…
          </Link>
        )}
      </form>

      <div className="ta-grid cols-5" style={{ marginBottom: 22 }}>
        <StatCard label="Leads" value={leadCount} icon="🧲" />
        <StatCard label="Opportunities" value={opportunityCount} icon="📊" />
        <StatCard label="Won" value={wonCount} icon="🏆" />
        <StatCard label="Won Value" value={money(acceptedValue)} icon="💰" />
        <StatCard label="Lead → Won" value={conversionRate(wonCount, leadCount)} icon="📈" />
      </div>

      <Card title="Funnel">
        <div className="ta-card-pad">
          {funnel.map((f) => (
            <Bar key={f.label} label={f.label} value={f.value} max={funnelMax} />
          ))}
        </div>
      </Card>

      <div className="ta-grid cols-2" style={{ marginTop: 20, alignItems: "start", gap: 20 }}>
        <Card title="Conversion Rates">
          <div className="ta-card-pad">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 10px", margin: 0 }}>
              {conversions.map((c) => (
                <div key={c.label} style={{ display: "contents" }}>
                  <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>{c.label}</dt>
                  <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{c.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>

        <Card title="Won / Lost">
          <div className="ta-card-pad">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 10px", margin: 0, marginBottom: lostReasonRows.length ? 14 : 0 }}>
              <div style={{ display: "contents" }}>
                <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>Won</dt>
                <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{wonCount}</dd>
              </div>
              <div style={{ display: "contents" }}>
                <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>Lost</dt>
                <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{lost.length}</dd>
              </div>
              <div style={{ display: "contents" }}>
                <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>Win Rate</dt>
                <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{winRate}</dd>
              </div>
            </dl>
            {lostReasonRows.length > 0 ? (
              lostReasonRows.map((r) => <Bar key={r.reason} label={r.label} value={r.count} max={Math.max(1, ...lostReasonRows.map((x) => x.count))} />)
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ta-muted)" }}>No lost opportunities in this range.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="ta-grid cols-2" style={{ marginTop: 20, alignItems: "start", gap: 20 }}>
        <Card title="Lead Source">
          <div className="ta-card-pad">
            {leadSourceRows.every((r) => r.total === 0) ? (
              <EmptyState icon="🧲" message="No leads in this range." />
            ) : (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Total</th>
                      <th>Qualified</th>
                      <th>Opportunities</th>
                      <th>Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadSourceRows.map((r) => (
                      <tr key={r.source}>
                        <td>{r.label}</td>
                        <td>{r.total}</td>
                        <td>{r.qualified}</td>
                        <td>{r.opportunities}</td>
                        <td>{r.won}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card title="Opportunity Stage">
          <div className="ta-card-pad">
            {stageRows.every((r) => r.count === 0) ? (
              <EmptyState icon="📊" message="No opportunities in this range." />
            ) : (
              stageRows.map((r) => <Bar key={r.stage} label={r.label} value={r.count} max={stageMax} />)
            )}
            <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ta-muted)" }}>Archived opportunities are excluded.</p>
          </div>
        </Card>
      </div>

      <Card title="Quotation Performance">
        <div className="ta-card-pad">
          <div className="ta-grid cols-4" style={{ marginBottom: 14 }}>
            <StatCard label="Created" value={quotationsCreated.length} icon="📄" />
            <StatCard label="Sent" value={sentCount} icon="📨" />
            <StatCard label="Acceptance Rate" value={conversionRate(acceptedAmongSent, sentCount)} icon="✅" />
            <StatCard label="Rejection Rate" value={conversionRate(rejectedAmongSent, sentCount)} icon="🚫" />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ta-muted)", margin: "0 0 10px" }}>
            Acceptance/rejection rates are measured against quotations <strong>sent</strong> in this range (never against drafts).
            {avgAcceptedValue != null && <> Average accepted value: <strong>{money(avgAcceptedValue)}</strong>.</>}
          </p>
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr><th>Status</th><th>Count (created in range)</th></tr>
              </thead>
              <tbody>
                {quotationStatusRows.map((r) => (
                  <tr key={r.status}><td style={{ textTransform: "capitalize" }}>{r.status}</td><td>{r.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="ta-grid cols-2" style={{ marginTop: 20, alignItems: "start", gap: 20 }}>
        <Card title="Sales Value">
          <div className="ta-card-pad">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px 10px", margin: 0 }}>
              <div style={{ display: "contents" }}>
                <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>Accepted / Won Value</dt>
                <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{money(acceptedValue)}</dd>
              </div>
              <div style={{ display: "contents" }}>
                <dt style={{ color: "var(--ta-muted)", fontSize: 13 }}>Average Won Deal</dt>
                <dd style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{avgWonDeal != null ? money(avgWonDeal) : "N/A"}</dd>
              </div>
            </dl>
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ta-muted)" }}>
              Sourced only from accepted quotation totals — never draft/proposal figures or opportunity estimates.
            </p>
          </div>
        </Card>

        <Card title="Top Programmes">
          <div className="ta-card-pad">
            {topProgrammes.length === 0 ? (
              <EmptyState icon="🏅" message="No won opportunities in this range." />
            ) : (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead>
                    <tr><th>Programme</th><th>Won</th><th>Value</th><th>Participants</th></tr>
                  </thead>
                  <tbody>
                    {topProgrammes.map((p) => (
                      <tr key={p.programme}>
                        <td>{p.programme}</td>
                        <td>{p.count}</td>
                        <td>{money(p.value)}</td>
                        <td>{p.participants || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title="Monthly Trend">
        <div className="ta-card-pad">
          {monthlyTrend.length === 0 ? (
            <EmptyState icon="📅" message="No months in this range." />
          ) : (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead>
                  <tr>
                    <th>Month</th><th>Leads</th><th>Qualified</th><th>Opportunities</th><th>Quotations Sent</th><th>Won</th><th>Lost</th><th>Won Value</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyTrend.map((m) => (
                    <tr key={m.month}>
                      <td>{m.label}</td>
                      <td>{m.leads}</td>
                      <td>{m.qualified}</td>
                      <td>{m.opportunities}</td>
                      <td>{m.quotationsSent}</td>
                      <td>{m.won}</td>
                      <td>{m.lost}</td>
                      <td>{money(m.wonValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card title="Owner Summary">
        <div className="ta-card-pad">
          <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--ta-muted)" }}>
            Operational visibility only — not a performance ranking.
          </p>
          {ownerRows.length === 0 ? (
            <EmptyState icon="👤" message="No assigned activity in this range." />
          ) : (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead>
                  <tr><th>Owner</th><th>Leads</th><th>Opportunities</th><th>Follow-ups Due</th><th>Tasks Due</th><th>Won</th><th>Won Value</th></tr>
                </thead>
                <tbody>
                  {ownerRows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{r.leads}</td>
                      <td>{r.opportunities}</td>
                      <td>{r.followUps}</td>
                      <td>{r.tasksDue}</td>
                      <td>{r.won}</td>
                      <td>{money(r.wonValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
