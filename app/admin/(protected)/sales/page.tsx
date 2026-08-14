import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../components/admin/sales/FollowUpBadge";
import { OPEN_OPPORTUNITY_STATUSES, SOURCE_LABELS, followUpState, type SalesLeadInboxRow } from "../../../../lib/sales/crm";

export const metadata = { title: "Sales Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Real Sales CRM V1 dashboard, replacing the Phase 1A demo dashboard.
 * Every figure below is a live count against sales_lead_metadata — no
 * revenue/pipeline-value totals are shown because neither enquiries nor
 * proposal_requests carries a monetary field (see task instruction: "Do not
 * invent financial revenue totals unless actual values exist").
 */
export default async function SalesDashboardPage() {
  await requireRole("editor");
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nowIso = now.toISOString();

  // Each query is built (not awaited) here, then resolved together — no
  // `await` inside the Promise.all array literal (CLAUDE.md §5/§13).
  const newLeadsQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).eq("status", "new");
  const openOpportunitiesQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).in("status", OPEN_OPPORTUNITY_STATUSES);
  const followUpsDueQuery = supabase
    .from("sales_lead_metadata")
    .select("id", { count: "exact", head: true })
    .lte("follow_up_at", nowIso)
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)");
  const proposalSentQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).eq("status", "proposal_sent");
  const wonThisMonthQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).eq("status", "won").gte("won_at", startOfMonth);
  const lostQuery = supabase.from("sales_lead_metadata").select("id", { count: "exact", head: true }).eq("status", "lost");
  const overdueRowsQuery = supabase
    .from("v_sales_lead_inbox")
    .select("*")
    .lt("follow_up_at", nowIso)
    .not("follow_up_at", "is", null)
    .not("status", "in", "(won,lost,archived)")
    .order("follow_up_at", { ascending: true })
    .limit(10);

  const [
    { count: newLeads },
    { count: openOpportunities },
    { count: followUpsDue },
    { count: proposalSent },
    { count: wonThisMonth },
    { count: lost },
    { data: overdueRows },
  ] = await Promise.all([
    newLeadsQuery,
    openOpportunitiesQuery,
    followUpsDueQuery,
    proposalSentQuery,
    wonThisMonthQuery,
    lostQuery,
    overdueRowsQuery,
  ]);

  return (
    <div className="ta-sales">
      <PageHead
        title="Sales Dashboard"
        subtitle="Live lead pipeline — public contact enquiries and proposal requests."
        action={<Link className="ta-btn ta-btn-primary" href="/admin/sales/leads">View All Leads</Link>}
      />

      <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
        <StatCard label="New Leads" value={newLeads ?? 0} icon="🧲" href="/admin/sales/leads?status=new" />
        <StatCard label="Open Opportunities" value={openOpportunities ?? 0} icon="📊" />
        <StatCard label="Follow-ups Due" value={followUpsDue ?? 0} icon="📞" context={followUpsDue ? "Includes overdue" : undefined} />
        <StatCard label="Proposal Sent" value={proposalSent ?? 0} icon="📄" href="/admin/sales/leads?status=proposal_sent" />
        <StatCard label="Won This Month" value={wonThisMonth ?? 0} icon="🏆" href="/admin/sales/leads?status=won" />
        <StatCard label="Lost" value={lost ?? 0} icon="🚫" href="/admin/sales/leads?status=lost" />
      </div>

      <Card title="Overdue Follow-ups">
        {overdueRows && overdueRows.length > 0 ? (
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
                {(overdueRows as SalesLeadInboxRow[]).map((r) => (
                  <tr key={r.lead_metadata_id}>
                    <td><span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span></td>
                    <td>
                      <strong>{r.contact_name ?? "—"}</strong>
                      {r.company && <div className="ta-lead-sub">{r.company}</div>}
                    </td>
                    <td>
                      <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />{" "}
                      <span className="ta-lead-sub">
                        {r.follow_up_at && new Date(r.follow_up_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}
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
