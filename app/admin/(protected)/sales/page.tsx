import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../components/admin/sales/FollowUpBadge";
import { OPEN_OPPORTUNITY_STAGES, SOURCE_LABELS, followUpState, mytEndOfTodayUtc, type SalesLeadInboxRow } from "../../../../lib/sales/crm";
import { resolveReportDateRange } from "../../../../lib/sales/reports";
import { formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Sales Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Real Sales CRM V1 dashboard, replacing the Phase 1A demo dashboard.
 * Opportunity estimated_value is optional user input on conversion. Summing
 * it would treat missing estimates as zero and imply a complete pipeline;
 * omit a dashboard value aggregate until coverage and semantics are verified.
 */
export default async function SalesDashboardPage() {
  await requireRole("editor");
  await requireModuleAccess("sales");
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const monthRange = resolveReportDateRange("this_month", undefined, now);
  const nowIso = now.toISOString();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();

  // Each query is built (not awaited) here, then resolved together — no
  // `await` inside the Promise.all array literal (CLAUDE.md §5/§13).
  // Test/demo chains (is_test=true) are excluded from every dashboard KPI.
  const newLeadsQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).eq("status", "new").eq("is_test", false);
  const openOpportunitiesQuery = supabase.from("sales_opportunities").select("id", { count: "exact", head: true }).in("stage", OPEN_OPPORTUNITY_STAGES).eq("is_test", false);
  const followUpsDueQuery = supabase
    .from("sales_lead_metadata")
    .select("id", { count: "exact", head: true })
    .eq("is_test", false)
    .lte("follow_up_at", nowIso)
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)");
  const wonThisMonthQuery = supabase.from("sales_opportunities").select("id", { count: "exact", head: true }).eq("stage", "won").eq("is_test", false).gte("won_at", monthRange.startUtc).lt("won_at", monthRange.endUtc);
  const overdueRowsQuery = supabase
    .from("v_sales_lead_inbox")
    .select("*")
    .eq("is_test", false)
    .lt("follow_up_at", nowIso)
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)")
    .order("follow_up_at", { ascending: true })
    .limit(10);

  // Work Requiring Attention uses the same overdue/today boundaries as the
  // existing Follow-ups and Tasks queues.
  const overdueFollowUpsQuery = supabase
    .from("sales_lead_metadata")
    .select("id", { count: "exact", head: true })
    .eq("is_test", false)
    .lt("follow_up_at", nowIso)
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)");
  const followUpsDueTodayQuery = supabase
    .from("sales_lead_metadata")
    .select("id", { count: "exact", head: true })
    .eq("is_test", false)
    .gte("follow_up_at", nowIso)
    .lt("follow_up_at", endOfTodayMyt)
    .not("status", "in", "(won,lost,archived)");
  const overdueTasksQuery = supabase
    .from("sales_tasks")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .lt("due_at", nowIso)
    .not("due_at", "is", null)
    .not("status", "in", "(completed,cancelled)");
  const tasksDueTodayQuery = supabase
    .from("sales_tasks")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .gte("due_at", nowIso)
    .lt("due_at", endOfTodayMyt)
    .not("status", "in", "(completed,cancelled)");

  const [
    newLeadsResult,
    openOpportunitiesResult,
    followUpsDueResult,
    wonThisMonthResult,
    overdueRowsResult,
    overdueFollowUpsResult,
    followUpsDueTodayResult,
    overdueTasksResult,
    tasksDueTodayResult,
  ] = await Promise.all([
    newLeadsQuery,
    openOpportunitiesQuery,
    followUpsDueQuery,
    wonThisMonthQuery,
    overdueRowsQuery,
    overdueFollowUpsQuery,
    followUpsDueTodayQuery,
    overdueTasksQuery,
    tasksDueTodayQuery,
  ]);
  const countValue = (result: { count: number | null; error: unknown }) => result.error || result.count == null ? "Unavailable" : result.count;
  const followUpsDueContext = followUpsDueResult.error || followUpsDueResult.count == null
    ? "Unable to load this metric."
    : followUpsDueResult.count > 0 ? "Includes overdue" : undefined;

  return (
    <div className="ta-sales">
      <PageHead
        title="Sales Dashboard"
        subtitle="Current sales activity across leads, opportunities, follow-ups and tasks."
        action={<Link className="ta-btn ta-btn-primary" href="/admin/sales/leads">View All Leads</Link>}
      />

      <div className="ta-sales-dashboard-kpis">
        <StatCard label="New Leads" value={countValue(newLeadsResult)} icon="🧲" href="/admin/sales/leads?status=new" />
        <StatCard label="Open Opportunities" value={countValue(openOpportunitiesResult)} icon="📊" href="/admin/sales/opportunities?state=open" />
        <StatCard label="Follow-ups Due" value={countValue(followUpsDueResult)} icon="📞" context={followUpsDueContext} href="/admin/sales/follow-ups" />
        <StatCard label="Won This Month" value={countValue(wonThisMonthResult)} icon="🏆" href="/admin/sales/reports?range=this_month" />
      </div>

      <Card title="Work Requiring Attention">
        <div className="ta-sales-attention-grid">
          <StatCard label="Overdue Follow-ups" value={countValue(overdueFollowUpsResult)} icon="📞" href="/admin/sales/follow-ups?view=overdue" />
          <StatCard label="Follow-ups Due Today" value={countValue(followUpsDueTodayResult)} icon="🗓" href="/admin/sales/follow-ups?view=today" />
          <StatCard label="Overdue Tasks" value={countValue(overdueTasksResult)} icon="☑" href="/admin/sales/tasks?view=overdue" />
          <StatCard label="Tasks Due Today" value={countValue(tasksDueTodayResult)} icon="☑" href="/admin/sales/tasks?view=today" />
        </div>
        {overdueRowsResult.error ? (
          <div className="ta-card-pad ta-alert ta-alert-error" role="alert">Overdue follow-ups are unavailable. Please try again.</div>
        ) : overdueRowsResult.data && overdueRowsResult.data.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Contact / Company</th>
                  <th>Follow-up Was Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(overdueRowsResult.data as SalesLeadInboxRow[]).map((r) => (
                  <tr key={r.lead_metadata_id}>
                    <td><span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span></td>
                    <td>
                      <strong>{r.contact_name ?? "—"}</strong>
                      {r.company && <div className="ta-lead-sub">{r.company}</div>}
                    </td>
                    <td>
                      <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />{" "}
                      <span className="ta-lead-sub">
                        {r.follow_up_at && formatMalaysiaDateTime(r.follow_up_at)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="✅" message="No overdue follow-ups." />
        )}
      </Card>
    </div>
  );
}
