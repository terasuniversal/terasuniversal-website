import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, EmptyState, StatCard } from "../../../../components/admin/ui";
import { calculateMarketingPerformance } from "../../../../lib/marketing/performance";

export const dynamic = "force-dynamic";
const money = (value: number | null) => value === null ? "—" : `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percentage = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const multiple = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}x`;

export default async function MarketingLandingPage() {
  await requireModuleAccess("marketing");
  const supabase = await createSupabaseServerClient();
  const campaignCountQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true });
  const activeCampaignsQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
  const contactCountQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true });
  const salesReadyQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("status", "sales_ready");
  const followUpsQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).lte("next_follow_up_at", new Date().toISOString()).not("next_follow_up_at", "is", null).not("status", "in", "(promoted,archived)");
  const performanceQueries = [
    supabase.from("marketing_campaigns").select("id, campaign_number, name, actual_spend"),
    supabase.from("sales_lead_attributions").select("lead_metadata_id, campaign_id"),
    supabase.from("sales_lead_metadata").select("id, status, is_test"),
    supabase.from("sales_opportunities").select("id, lead_metadata_id, stage, is_test"),
    supabase.from("sales_quotations").select("opportunity_id, revision_no, status, total, accepted_at, is_test"),
  ];
  const [campaigns, activeCampaigns, contacts, salesReady, followUps, performance] = await Promise.all([campaignCountQuery, activeCampaignsQuery, contactCountQuery, salesReadyQuery, followUpsQuery, Promise.all(performanceQueries)]);
  const performanceError = performance.find((query) => query.error)?.error ?? null;
  const queryError = campaigns.error || activeCampaigns.error || contacts.error || salesReady.error || followUps.error || performanceError;
  const performanceMetrics = !queryError ? calculateMarketingPerformance(performance[0].data ?? [], performance[1].data ?? [], performance[2].data ?? [], performance[3].data ?? [], performance[4].data ?? []) : null;

  return <>
    <PageHead title="Marketing Dashboard" subtitle="Live overview of campaigns and pre-sales contacts." action={<Link href="/admin/marketing/contacts/new" className="ta-btn ta-btn-primary">+ Add Contact</Link>} />
    {queryError ? <div className="ta-alert ta-alert-error">Could not load marketing overview: {queryError.message}</div> : <>
      <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
        <StatCard label="Total Campaigns" value={campaigns.count ?? 0} icon="📣" href="/admin/marketing/campaigns" />
        <StatCard label="Active Campaigns" value={activeCampaigns.count ?? 0} icon="🟢" href="/admin/marketing/campaigns?status=active" />
        <StatCard label="Total Contacts" value={contacts.count ?? 0} icon="👥" href="/admin/marketing/contacts" />
        <StatCard label="Sales Ready" value={salesReady.count ?? 0} icon="🎯" href="/admin/marketing/contacts?status=sales_ready" />
        <StatCard label="Follow-ups Due" value={followUps.count ?? 0} icon="📞" href="/admin/marketing/contacts?followup=due" context="Includes overdue" />
      </div>
      <Card title="Marketing performance">
        <div className="ta-card-pad ta-muted-sub">Attributed sales performance from recorded campaign spend and accepted quotation totals.</div>
        <div className="ta-grid cols-3 ta-card-pad">
          <StatCard label="Total Spend" value={money(performanceMetrics?.overall.spend ?? null)} icon="Spend" />
          <StatCard label="Attributed Leads" value={performanceMetrics?.overall.leads ?? 0} icon="Leads" />
          <StatCard label="Sales-ready Leads" value={performanceMetrics?.overall.salesReady ?? 0} icon="Ready" />
          <StatCard label="Converted / Won" value={performanceMetrics?.overall.won ?? 0} icon="Won" />
          <StatCard label="Cost Per Lead" value={money(performanceMetrics?.overall.costPerLead ?? null)} icon="CPL" />
          <StatCard label="Cost Per Acquisition" value={money(performanceMetrics?.overall.costPerAcquisition ?? null)} icon="CPA" />
          <StatCard label="Conversion Rate" value={percentage(performanceMetrics?.overall.conversionRate ?? null)} icon="Rate" />
          <StatCard label="Attributed Revenue" value={money(performanceMetrics?.overall.attributedRevenue ?? null)} icon="Revenue" />
          <StatCard label="ROAS" value={multiple(performanceMetrics?.overall.roas ?? null)} icon="ROAS" />
        </div>
        <div className="ta-card-pad ta-muted-sub">Revenue is attributed only through a campaign-linked lead, a won opportunity, and an accepted quotation with a recorded total. Missing links or totals are excluded and shown as unavailable, not estimated.</div>
      </Card>
      <Card title="Campaign performance">
        {performanceMetrics?.campaigns.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Campaign</th><th>Spend</th><th>Leads</th><th>Sales-ready</th><th>Won</th><th>Revenue</th><th>ROAS</th></tr></thead><tbody>{performanceMetrics.campaigns.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><br /><span className="ta-muted-sub">{row.campaignNumber}</span></td><td>{money(row.spend)}</td><td>{row.leads}</td><td>{row.salesReady}</td><td>{row.won}</td><td>{money(row.attributedRevenue)}</td><td>{multiple(row.roas)}</td></tr>)}</tbody></table></div> : <EmptyState icon="Data" message="No campaign performance data yet." />}
      </Card>
    </>}
    <Card title="Marketing workspace"><div className="ta-card-pad ta-grid cols-2"><Link href="/admin/marketing/campaigns" className="ta-btn ta-btn-outline">Manage Campaigns →</Link><Link href="/admin/marketing/contacts" className="ta-btn ta-btn-outline">Manage Contacts →</Link></div></Card>
  </>;
}
