/**
 * Sales CRM V1 — real Supabase-backed data layer.
 *
 * Deliberately separate from ./types.ts / ./constants.ts / ./demo-data.ts,
 * which remain the Phase 1B/1C/1D DEMO Leads/Opportunities/Quotations
 * module (untouched, out of scope for this build). Reusing those types
 * directly would force either narrowing real enquiries/proposal_requests
 * data into a shape designed for a single fictitious "pax + course +
 * estimatedValue" lead, or widening exhaustive Record<SalesLeadStatus,...>
 * maps consumed by 47+ existing demo components not audited in this pass.
 * A small parallel layer is the lower-risk choice.
 *
 * This file has ZERO imports from ./types.ts / ./constants.ts /
 * ./demo-data.ts / ./opportunities* / ./quotations* — Sales CRM V1 must not
 * depend on the demo module. FollowUpState/FOLLOW_UP_STATE_LABELS below were
 * originally reused from ./types.ts + ./constants.ts (genuinely generic,
 * not status-specific) but are now defined here instead, so
 * components/admin/sales/FollowUpBadge.tsx — the one demo-directory
 * component the real CRM actually renders — can import from this file alone.
 */

export type SalesLeadSourceKind = "enquiry" | "proposal_request";

/** Same four values/labels as the demo module's FollowUpState — moved here, not duplicated with different meaning. */
export type FollowUpState = "overdue" | "today" | "upcoming" | "none";

export const FOLLOW_UP_STATE_LABELS: Record<FollowUpState, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  none: "No Follow-up",
};

/** Matches supabase/migrations/20260814120000_create_sales_crm_v1.sql's status CHECK. */
export type SalesCrmStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "negotiation"
  | "won"
  | "lost"
  | "archived";

/** Statuses shown in the default active queue — archived is excluded per the task spec. */
export const ACTIVE_STATUSES: SalesCrmStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
];

export const CRM_STATUS_ORDER: SalesCrmStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
  "archived",
];

export const CRM_STATUS_LABELS: Record<SalesCrmStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

/** "Open opportunity" for dashboard purposes: actively being worked, not yet resolved. */
export const OPEN_OPPORTUNITY_STATUSES: SalesCrmStatus[] = ["contacted", "qualified", "proposal_sent", "negotiation"];

export type SalesCrmPriority = "low" | "medium" | "high";
export const PRIORITY_LABELS: Record<SalesCrmPriority, string> = { low: "Low", medium: "Medium", high: "High" };

export type SalesCrmLostReason =
  | "price"
  | "no_budget"
  | "no_response"
  | "timing"
  | "competitor"
  | "requirement_changed"
  | "duplicate"
  | "other";

export const LOST_REASON_LABELS: Record<SalesCrmLostReason, string> = {
  price: "Price",
  no_budget: "No Budget",
  no_response: "No Response",
  timing: "Timing",
  competitor: "Competitor",
  requirement_changed: "Requirement Changed",
  duplicate: "Duplicate",
  other: "Other",
};
export const LOST_REASONS: SalesCrmLostReason[] = ["price", "no_budget", "no_response", "timing", "competitor", "requirement_changed", "duplicate", "other"];

/** Matches supabase/migrations/20260814120000_create_sales_crm_v1.sql's sales_activity type CHECK. */
export type SalesCrmActivityType =
  | "lead_created"
  | "status_changed"
  | "assigned"
  | "followup_scheduled"
  | "note_added"
  | "proposal_sent"
  | "won"
  | "lost";

export const CRM_ACTIVITY_ICONS: Record<SalesCrmActivityType, string> = {
  lead_created: "🧲",
  status_changed: "🔁",
  assigned: "👤",
  followup_scheduled: "🗓",
  note_added: "📝",
  proposal_sent: "📨",
  won: "🏆",
  lost: "🚫",
};

export const CRM_ACTIVITY_LABELS: Record<SalesCrmActivityType, string> = {
  lead_created: "Lead created",
  status_changed: "Status changed",
  assigned: "Assigned",
  followup_scheduled: "Follow-up scheduled",
  note_added: "Note added",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export const SOURCE_LABELS: Record<SalesLeadSourceKind, string> = {
  enquiry: "Contact Enquiry",
  proposal_request: "Proposal Request",
};

/** Row shape of public.v_sales_lead_inbox. */
export interface SalesLeadInboxRow {
  lead_metadata_id: string;
  lead_source: SalesLeadSourceKind;
  source_id: string;
  status: SalesCrmStatus;
  assigned_to: string | null;
  follow_up_at: string | null;
  priority: SalesCrmPriority;
  lost_reason: SalesCrmLostReason | null;
  won_at: string | null;
  created_at: string;
  updated_at: string;
  contact_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  subject: string | null;
}

export interface SalesActivityRow {
  id: string;
  lead_metadata_id: string;
  type: SalesCrmActivityType;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

/** Derives OVERDUE / TODAY / UPCOMING / NONE for a follow-up timestamp on an unresolved lead. */
export function followUpState(followUpAt: string | null, status: SalesCrmStatus): FollowUpState {
  if (!followUpAt || status === "won" || status === "lost" || status === "archived") return "none";
  const due = new Date(followUpAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  if (due < now) return "overdue";
  if (due < startOfTomorrow) return "today";
  return "upcoming";
}

/** Sanitizes free-text search input before interpolating into a PostgREST .or() filter string (CLAUDE.md §6). */
export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_,()]/g, " ").trim();
}
