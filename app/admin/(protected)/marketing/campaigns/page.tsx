import Link from "next/link";
import { Card, EmptyState, PageHead, Badge } from "../../../../../components/admin/ui";
import { requireRole } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_STATUS_LABELS, getCampaign, getCampaigns, type MarketingCampaignRow } from "../../../../../lib/marketing/crm";
import { CampaignForm } from "./CampaignForm";
import { createCampaign, updateCampaign } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns — TERAS UNIVERSAL Admin" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ new?: string; edit?: string }> }) {
  await requireRole("editor");
  const sp = await searchParams; const supabase = await createSupabaseServerClient();
  const { data, error } = await getCampaigns(supabase); const campaigns = (data ?? []) as MarketingCampaignRow[];
  let editing: MarketingCampaignRow | undefined;
  if (sp.edit) { const result = await getCampaign(supabase, sp.edit); editing = result.data as MarketingCampaignRow | undefined; }
  if (sp.new || sp.edit) return <><PageHead title={editing ? "Edit Campaign" : "New Campaign"} subtitle="Manage campaign metadata and lifecycle." /><CampaignForm action={editing ? updateCampaign.bind(null, editing.id) : createCampaign} campaign={editing} /></>;
  return <><PageHead title="Campaigns" subtitle="Track Marketing campaigns and connect their leads to Sales." action={<Link href="/admin/marketing/campaigns?new=1" className="ta-btn ta-btn-primary">+ New Campaign</Link>} />
    <Card>{error ? <div className="ta-alert ta-alert-error">Unable to load campaigns: {error.message}</div> : campaigns.length === 0 ? <EmptyState title="No campaigns yet" message="Create a campaign to start tracking marketing activity." action={<Link href="/admin/marketing/campaigns?new=1" className="ta-btn ta-btn-primary">Create campaign</Link>} /> : <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Dates</th><th>Budget</th><th /></tr></thead><tbody>{campaigns.map((c) => <tr key={c.id}><td><strong>{c.name}</strong>{c.objective && <div className="ta-lead-sub">{c.objective}</div>}</td><td>{CAMPAIGN_CHANNEL_LABELS[c.channel]}</td><td><Badge status={c.status} /><div className="ta-lead-sub">{CAMPAIGN_STATUS_LABELS[c.status]}</div></td><td>{c.start_date ?? "—"}{c.end_date ? ` → ${c.end_date}` : ""}</td><td>{c.budget == null ? "—" : `RM ${Number(c.budget).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`}</td><td className="ta-row-actions"><Link href={`/admin/marketing/campaigns?edit=${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Edit</Link></td></tr>)}</tbody></table></div>}</Card></>;
}
