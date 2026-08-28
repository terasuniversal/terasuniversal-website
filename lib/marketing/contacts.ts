import type {
  MarketingContact,
  MarketingContactConsentStatus,
  MarketingContactEventType,
  MarketingContactSource,
  MarketingContactStatus,
} from "../supabase/database.types";

/**
 * Marketing CRM Phase 1B-B -- display-oriented constants for
 * public.marketing_contacts / public.marketing_contact_events. Same split
 * from lib/validation/schemas.ts's validated-input shape that
 * lib/marketing/campaigns.ts already uses for Campaigns.
 */

export const SOURCE_LABELS: Record<MarketingContactSource, string> = {
  manual: "Manual",
  newsletter: "Newsletter",
  event: "Event",
  referral: "Referral",
  import: "Import",
  website: "Website",
  other: "Other",
};

export const STATUS_LABELS: Record<MarketingContactStatus, string> = {
  new: "New",
  nurturing: "Nurturing",
  sales_ready: "Sales Ready",
  promoted: "Promoted",
  archived: "Archived",
};

export const CONSENT_LABELS: Record<MarketingContactConsentStatus, string> = {
  not_set: "Not Set",
  opted_in: "Opted In",
  opted_out: "Opted Out",
};

export const EVENT_TYPE_LABELS: Record<MarketingContactEventType, string> = {
  created: "Contact created",
  status_changed: "Status changed",
  note_added: "Note added",
  campaign_linked: "Campaign linked",
  consent_changed: "Consent changed",
  unsubscribed: "Unsubscribed",
  promoted_to_sales: "Promoted to Sales",
};

/** `full_name` is nullable on the live table -- a sensible display fallback for list/detail/table cells. */
export function contactDisplayName(c: Pick<MarketingContact, "full_name" | "email" | "phone">): string {
  return c.full_name?.trim() || c.email?.trim() || c.phone?.trim() || "Unnamed contact";
}

/**
 * The one valid next-step set for each lifecycle status, per the locked
 * Phase 1B-B transition matrix. Deliberately NOT single-step-forced like
 * Campaign -- Contact status is a readiness assessment, not a time-ordered
 * phase sequence, so several statuses have more than one valid next step
 * and `sales_ready -> promoted` is excluded here (Phase 1B-D's job).
 */
export const CONTACT_LIFECYCLE_ALLOWED_FROM: Record<Exclude<MarketingContactStatus, "promoted">, MarketingContactStatus[]> = {
  new: [], // 'new' has no valid "from" set of its own -- it's a starting point.
  nurturing: ["new", "sales_ready", "archived"],
  sales_ready: ["new", "nurturing"],
  archived: ["new", "nurturing", "sales_ready"],
};
