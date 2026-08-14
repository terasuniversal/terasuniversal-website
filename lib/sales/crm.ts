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

/**
 * Matches supabase/migrations/20260814120000_create_sales_crm_v1.sql's +
 * 20260814150000_create_sales_crm_phase2_opportunities_quotations.sql's +
 * 20260814220000_sales_activity_training_handoff_type.sql's combined
 * sales_activity type CHECK (each phase extended the constraint
 * additively, never replaced it).
 */
export type SalesCrmActivityType =
  | "lead_created"
  | "status_changed"
  | "assigned"
  | "followup_scheduled"
  | "note_added"
  | "proposal_sent"
  | "won"
  | "lost"
  | "opportunity_created"
  | "quotation_created"
  | "quotation_sent"
  | "quotation_revised"
  | "quotation_accepted"
  | "quotation_rejected"
  | "opportunity_won"
  | "opportunity_lost"
  | "training_handoff_created";

export const CRM_ACTIVITY_ICONS: Record<SalesCrmActivityType, string> = {
  lead_created: "🧲",
  status_changed: "🔁",
  assigned: "👤",
  followup_scheduled: "🗓",
  note_added: "📝",
  proposal_sent: "📨",
  won: "🏆",
  lost: "🚫",
  opportunity_created: "🎯",
  quotation_created: "📄",
  quotation_sent: "📨",
  quotation_revised: "🔃",
  quotation_accepted: "✅",
  quotation_rejected: "🚫",
  opportunity_won: "🏆",
  opportunity_lost: "🚫",
  training_handoff_created: "🎓",
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
  opportunity_created: "Opportunity created",
  quotation_created: "Quotation created",
  quotation_sent: "Quotation sent",
  quotation_revised: "Quotation revised",
  quotation_accepted: "Quotation accepted",
  quotation_rejected: "Quotation rejected",
  opportunity_won: "Opportunity won",
  opportunity_lost: "Opportunity lost",
  training_handoff_created: "Training schedule created",
};

export const SOURCE_LABELS: Record<SalesLeadSourceKind, string> = {
  enquiry: "Contact Enquiry",
  proposal_request: "Proposal Request",
};

/* ------------------------------------------------------------------ */
/* Phase 2 — Opportunities                                             */
/* ------------------------------------------------------------------ */

/** Matches sales_opportunities.stage's CHECK. Aligned with the Lead pipeline where practical (Task 4). */
export type SalesOpportunityStage = "new" | "qualified" | "quotation" | "negotiation" | "won" | "lost" | "archived";

export const OPPORTUNITY_STAGE_ORDER: SalesOpportunityStage[] = ["new", "qualified", "quotation", "negotiation", "won", "lost", "archived"];

export const OPPORTUNITY_STAGE_LABELS: Record<SalesOpportunityStage, string> = {
  new: "New",
  qualified: "Qualified",
  quotation: "Quotation",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export const OPEN_OPPORTUNITY_STAGES: SalesOpportunityStage[] = ["new", "qualified", "quotation", "negotiation"];

/** Row shape of public.sales_opportunities. */
export interface SalesOpportunityRow {
  id: string;
  lead_metadata_id: string;
  opportunity_no: string;
  company_name: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  title: string;
  programme: string | null;
  stage: SalesOpportunityStage;
  assigned_to: string | null;
  expected_close_date: string | null;
  probability: number | null;
  estimated_value: number | null;
  lost_reason: SalesCrmLostReason | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  lost_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Phase 2 — Quotations                                                */
/* ------------------------------------------------------------------ */

/** Matches sales_quotations.status's CHECK. */
export type SalesQuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "superseded";

export const QUOTATION_STATUS_ORDER: SalesQuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "superseded"];

export const QUOTATION_STATUS_LABELS: Record<SalesQuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
};

export type SalesQuotationUnit = "pax" | "session" | "day" | "lot" | "unit";
export const QUOTATION_UNITS: SalesQuotationUnit[] = ["pax", "session", "day", "lot", "unit"];
export const QUOTATION_UNIT_LABELS: Record<SalesQuotationUnit, string> = {
  pax: "Pax",
  session: "Session",
  day: "Day",
  lot: "Lot",
  unit: "Unit",
};

/** "Original" for revision 0, otherwise "R{n}" — same convention as the demo module's revisionLabel(). */
export function revisionLabel(revisionNo: number): string {
  return revisionNo === 0 ? "Original" : `R${revisionNo}`;
}

export interface SalesQuotationRow {
  id: string;
  opportunity_id: string;
  quotation_no: string;
  revision_no: number;
  parent_quotation_id: string | null;
  status: SalesQuotationStatus;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  sst_applicable: boolean;
  sst_rate: number;
  tax: number;
  total: number;
  terms: string | null;
  notes: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  superseded_at: string | null;
}

export interface SalesQuotationItemRow {
  id: string;
  quotation_id: string;
  description: string;
  quantity: number;
  unit: SalesQuotationUnit;
  unit_price: number;
  discount: number;
  line_total: number;
  sort_order: number;
}

/**
 * Quotation money math — ported (not imported) from lib/sales/quotation-math.ts
 * to keep this file's zero-demo-dependency invariant. Same algorithm:
 * integer-sen-safe rounding, so 3 x RM10.33 never drifts by a cent versus
 * what sales_quotation_items.line_total (a GENERATED column using the same
 * formula) computes at the database level.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeLineTotal(item: { quantity: number; unitPrice: number; discount: number }): number {
  const sen = item.quantity * Math.round(item.unitPrice * 100) - Math.round(item.discount * 100);
  return round2(sen / 100);
}

export interface QuotationTotals {
  subtotal: number;
  taxableAmount: number;
  tax: number;
  total: number;
}

export function computeQuotationTotals(input: {
  items: { quantity: number; unitPrice: number; discount: number }[];
  discount: number;
  sstApplicable: boolean;
  sstRate: number;
}): QuotationTotals {
  const subtotal = round2(input.items.reduce((sum, item) => sum + computeLineTotal(item), 0));
  const taxableAmount = round2(subtotal - input.discount);
  const tax = input.sstApplicable ? round2((taxableAmount * input.sstRate) / 100) : 0;
  const total = round2(taxableAmount + tax);
  return { subtotal, taxableAmount, tax, total };
}

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
  opportunity_id: string | null;
  quotation_id: string | null;
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
