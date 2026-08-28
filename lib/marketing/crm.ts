import type { Database } from "../supabase/database.types";

export type CampaignChannel = "meta_ads" | "facebook_organic" | "instagram" | "tiktok" | "google" | "whatsapp" | "email" | "website" | "event" | "referral" | "other";
/** @deprecated Use CampaignChannel. Kept as a source-compatible alias. */
export type CampaignPlatform = CampaignChannel;
export type CampaignStatus = "draft" | "active" | "completed" | "archived";
export const CAMPAIGN_CHANNELS: CampaignChannel[] = ["meta_ads", "facebook_organic", "instagram", "tiktok", "google", "whatsapp", "email", "website", "event", "referral", "other"];
/** @deprecated Use CAMPAIGN_CHANNELS. */
export const CAMPAIGN_PLATFORMS = CAMPAIGN_CHANNELS;
export const CAMPAIGN_STATUS_ORDER: CampaignStatus[] = ["draft", "active", "completed", "archived"];
export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = { meta_ads: "Meta Ads", facebook_organic: "Facebook", instagram: "Instagram", tiktok: "TikTok", google: "Google", whatsapp: "WhatsApp", email: "Email", website: "Website", event: "Event", referral: "Referral", other: "Other" };
/** @deprecated Use CAMPAIGN_CHANNEL_LABELS. */
export const CAMPAIGN_PLATFORM_LABELS = CAMPAIGN_CHANNEL_LABELS;
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = { draft: "Draft", active: "Active", completed: "Completed", archived: "Archived" };

export type LeadAttributionSource = "facebook" | "tiktok" | "whatsapp" | "website" | "referral" | "other";
export const LEAD_ATTRIBUTION_SOURCES: LeadAttributionSource[] = ["facebook", "tiktok", "whatsapp", "website", "referral", "other"];
export const LEAD_ATTRIBUTION_SOURCE_LABELS: Record<LeadAttributionSource, string> = { facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp", website: "Website", referral: "Referral", other: "Other" };

export interface MarketingCampaignRow {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  objective: string | null;
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadAttributionRow {
  id: string;
  lead_metadata_id: string;
  source: LeadAttributionSource;
  campaign_id: string | null;
  campaign_name?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type MarketingCampaignInsert = Database["public"]["Tables"]["marketing_campaigns"]["Insert"];

export async function getCampaigns(supabase: Awaited<ReturnType<typeof import("../supabase/server").createSupabaseServerClient>>) {
  return supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false });
}

export async function getCampaign(supabase: Awaited<ReturnType<typeof import("../supabase/server").createSupabaseServerClient>>, id: string) {
  return supabase.from("marketing_campaigns").select("*").eq("id", id).maybeSingle();
}

export async function getLeadAttributions(supabase: Awaited<ReturnType<typeof import("../supabase/server").createSupabaseServerClient>>, leadIds: string[]) {
  if (!leadIds.length) return { data: [], error: null };
  return supabase.from("sales_lead_attributions").select("*, marketing_campaigns(name)").in("lead_metadata_id", leadIds);
}

export type MarketingCampaignPayload = MarketingCampaignInsert;
