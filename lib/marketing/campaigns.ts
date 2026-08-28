import type { MarketingCampaignChannel, MarketingCampaignStatus } from "../supabase/database.types";

/**
 * Marketing CRM Phase 1A -- display-oriented constants for
 * public.marketing_campaigns. Kept separate from lib/validation/schemas.ts's
 * validated-input shape (that file's job), same split lib/sales/crm.ts uses
 * for Sales.
 */

export const CHANNEL_LABELS: Record<MarketingCampaignChannel, string> = {
  meta_ads: "Meta Ads",
  facebook_organic: "Facebook Organic",
  instagram: "Instagram",
  tiktok: "TikTok",
  google: "Google",
  whatsapp: "WhatsApp",
  email: "Email",
  website: "Website",
  event: "Event",
  referral: "Referral",
  other: "Other",
};

export const STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
