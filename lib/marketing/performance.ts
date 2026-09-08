import type { MarketingCampaign } from "../supabase/database.types";

export type MarketingPerformanceCampaign = Pick<MarketingCampaign, "id" | "campaign_number" | "name" | "actual_spend">;
export type MarketingPerformanceAttribution = { lead_metadata_id: string; campaign_id: string | null };
export type MarketingPerformanceLead = { id: string; status: string; is_test?: boolean | null };
export type MarketingPerformanceOpportunity = { id: string; lead_metadata_id: string; stage: string; is_test?: boolean | null };
export type MarketingPerformanceQuotation = { opportunity_id: string; revision_no?: number | null; status: string; total: number | string | null; accepted_at: string | null; is_test?: boolean | null };
export type MarketingPerformanceMetrics = { spend: number | null; leads: number; salesReady: number; won: number; costPerLead: number | null; costPerAcquisition: number | null; conversionRate: number | null; attributedRevenue: number; roas: number | null };
export type MarketingPerformanceRow = MarketingPerformanceMetrics & { id: string; campaignNumber: string; name: string };
export type MarketingPerformanceResult = { overall: MarketingPerformanceMetrics; campaigns: MarketingPerformanceRow[] };

const SALES_READY_STATUSES = new Set(["qualified", "proposal_sent", "negotiation", "won"]);
const finiteNumber = (value: number | string | null | undefined) => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0;
const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null;

function buildMetrics(spend: number | null, leads: Set<string>, salesReady: Set<string>, won: Set<string>, revenue: number): MarketingPerformanceMetrics {
  return { spend, leads: leads.size, salesReady: salesReady.size, won: won.size, costPerLead: spend === null ? null : ratio(spend, leads.size), costPerAcquisition: spend === null ? null : ratio(spend, won.size), conversionRate: ratio(won.size, leads.size), attributedRevenue: revenue, roas: spend === null ? null : ratio(revenue, spend) };
}

export function calculateMarketingPerformance(campaigns: MarketingPerformanceCampaign[], attributions: MarketingPerformanceAttribution[], leads: MarketingPerformanceLead[], opportunities: MarketingPerformanceOpportunity[], quotations: MarketingPerformanceQuotation[]): MarketingPerformanceResult {
  const leadById = new Map(leads.filter((lead) => lead.is_test !== true).map((lead) => [lead.id, lead]));
  const realAttributions = attributions.filter((attribution) => leadById.has(attribution.lead_metadata_id));
  const realOpportunities = opportunities.filter((opportunity) => opportunity.is_test !== true && leadById.has(opportunity.lead_metadata_id));
  const opportunitiesByLead = new Map<string, MarketingPerformanceOpportunity[]>();
  for (const opportunity of realOpportunities) opportunitiesByLead.set(opportunity.lead_metadata_id, [...(opportunitiesByLead.get(opportunity.lead_metadata_id) ?? []), opportunity]);
  const revenueByOpportunity = new Map<string, number>();
  const acceptedMetaByOpportunity = new Map<string, { acceptedAt: string; revisionNo: number }>();
  for (const quotation of quotations) {
    if (quotation.is_test === true || quotation.status !== "accepted" || !quotation.accepted_at) continue;
    const existingQuotation = acceptedMetaByOpportunity.get(quotation.opportunity_id);
    const acceptedAt = quotation.accepted_at;
    const revisionNo = quotation.revision_no ?? 0;
    const isNewer = !existingQuotation || acceptedAt > existingQuotation.acceptedAt || (acceptedAt === existingQuotation.acceptedAt && revisionNo > existingQuotation.revisionNo);
    if (isNewer) {
      revenueByOpportunity.set(quotation.opportunity_id, finiteNumber(quotation.total));
      acceptedMetaByOpportunity.set(quotation.opportunity_id, { acceptedAt, revisionNo });
    }
  }
  const spendValues = campaigns.map((campaign) => campaign.actual_spend).filter((value): value is number => value !== null);
  const spend = spendValues.length ? spendValues.reduce((sum, value) => sum + finiteNumber(value), 0) : null;
  const leadsFor = (campaignId?: string) => new Set(realAttributions.filter((attribution) => campaignId === undefined ? attribution.campaign_id !== null : attribution.campaign_id === campaignId).map((attribution) => attribution.lead_metadata_id));
  const salesReadyOpportunityStages = new Set(["qualified", "quotation", "negotiation", "won"]);
  const salesReadyFor = (leadIds: Set<string>) => new Set([...leadIds].filter((leadId) => {
    const lead = leadById.get(leadId);
    const hasCancelledOpportunity = opportunitiesByLead.get(leadId)?.some((opportunity) => opportunity.stage === "cancelled") ?? false;
    const hasSalesReadyOpportunity = opportunitiesByLead.get(leadId)?.some((opportunity) => salesReadyOpportunityStages.has(opportunity.stage)) ?? false;
    return Boolean(lead && ((!hasCancelledOpportunity && SALES_READY_STATUSES.has(lead.status)) || hasSalesReadyOpportunity));
  }));
  const wonFor = (leadIds: Set<string>) => new Set([...leadIds].filter((leadId) => opportunitiesByLead.get(leadId)?.some((opportunity) => opportunity.stage === "won")));
  const revenueFor = (leadIds: Set<string>) => {
    const opportunityIds = new Set([...leadIds].flatMap((leadId) => (opportunitiesByLead.get(leadId) ?? []).filter((opportunity) => opportunity.stage === "won").map((opportunity) => opportunity.id)));
    return [...opportunityIds].reduce((sum, opportunityId) => sum + (revenueByOpportunity.get(opportunityId) ?? 0), 0);
  };
  const allLeads = leadsFor();
  const campaignsResult = campaigns.map((campaign) => {
    const campaignLeads = leadsFor(campaign.id);
    return { id: campaign.id, campaignNumber: campaign.campaign_number, name: campaign.name, ...buildMetrics(campaign.actual_spend, campaignLeads, salesReadyFor(campaignLeads), wonFor(campaignLeads), revenueFor(campaignLeads)) };
  });
  return { overall: buildMetrics(spend, allLeads, salesReadyFor(allLeads), wonFor(allLeads), revenueFor(allLeads)), campaigns: campaignsResult };
}
