import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, EmptyState, StatCard } from "../../../../components/admin/ui";

export const dynamic = "force-dynamic";

export default async function MarketingLandingPage() {
  await requireModuleAccess("marketing");
  const supabase = await createSupabaseServerClient();

  const campaignCountQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true });
  const activeCampaignsQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
  const contactCountQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true });
  const salesReadyQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("status", "sales_ready");
  const followUpsQuery = supabase
    .from("marketing_contacts")
    .select("id", { count: "exact", head: true })
    .lte("next_follow_up_at", new Date().toISOString())
    .not("next_follow_up_at", "is", null)
    .not("status", "in", "(promoted,archived)");

  const [campaigns, activeCampaigns, contacts, salesReady, followUps] = await Promise.all([
    campaignCountQuery,
    activeCampaignsQuery,
    contactCountQuery,
    salesReadyQuery,
    followUpsQuery,
  ]);
  const queryError = campaigns.error || activeCampaigns.error || contacts.error || salesReady.error || followUps.error;

  return (
    <>
      <PageHead
        title="Marketing Dashboard"
        subtitle="Live overview of campaigns and pre-sales contacts."
        action={<Link href="/admin/marketing/contacts/new" className="ta-btn ta-btn-primary">+ Create Contact</Link>}
      />

      {queryError ? (
        <div className="ta-alert ta-alert-error">Could not load the marketing overview. Please try again later.</div>
      ) : (
        <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
          <StatCard label="Total Campaigns" value={campaigns.count ?? 0} icon="📣" href="/admin/marketing/campaigns" />
          <StatCard label="Active Campaigns" value={activeCampaigns.count ?? 0} icon="🟢" href="/admin/marketing/campaigns?status=active" />
          <StatCard label="Total Contacts" value={contacts.count ?? 0} icon="👥" href="/admin/marketing/contacts" />
          <StatCard label="Sales Ready" value={salesReady.count ?? 0} icon="🎯" href="/admin/marketing/contacts?status=sales_ready" />
          <StatCard label="Follow-ups Due" value={followUps.count ?? 0} icon="📞" href="/admin/marketing/contacts?followup=due" context="Includes overdue" />
        </div>
      )}

      <Card title="Marketing workspace">
        <div className="ta-card-pad ta-grid cols-2">
          <Link href="/admin/marketing/campaigns" className="ta-btn ta-btn-outline">Manage Campaigns →</Link>
          <Link href="/admin/marketing/contacts" className="ta-btn ta-btn-outline">Manage Contacts →</Link>
        </div>
      </Card>
    </>
  );
}
