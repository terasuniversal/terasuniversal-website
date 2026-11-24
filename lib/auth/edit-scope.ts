import { hasMinRole } from "./rbac";
import type { UserRole } from "../supabase/database.types";

/**
 * What an "Edit" module grant actually lets a staff member do, per role.
 *
 * Module access (None/View/Edit) is only one of two gates: every Sales and
 * Finance server action also calls requireRole(...). An Editor with Edit on
 * Quotations therefore still cannot create or accept a quotation, because those
 * actions require Admin. Staff User Management shows this table so the label
 * "Edit" never promises more than the server allows (finding SEC-3).
 *
 * This file only DESCRIBES authorization; it grants nothing. Each entry names
 * the exported server action it mirrors, and
 * scripts/sec3-edit-scope-contract.test.mts parses those action files and fails
 * if a role or module requirement here drifts from the real guard.
 */
export interface EditScopeAction {
  /** Short staff-facing description of the action. */
  label: string;
  /** Least privileged role the server action admits (its requireRole argument). */
  minRole: Extract<UserRole, "admin" | "editor">;
  /** Source file (relative to app/admin/(protected)) and exported function it mirrors. */
  source: { file: string; fn: string };
}

const lead = (label: string, minRole: EditScopeAction["minRole"], fn: string): EditScopeAction => ({ label, minRole, source: { file: "sales/leads/actions.ts", fn } });
const opp = (label: string, minRole: EditScopeAction["minRole"], fn: string): EditScopeAction => ({ label, minRole, source: { file: "sales/opportunities/actions.ts", fn } });
const quote = (label: string, fn: string): EditScopeAction => ({ label, minRole: "admin", source: { file: "sales/quotations/actions.ts", fn } });
const task = (label: string, minRole: EditScopeAction["minRole"], fn: string): EditScopeAction => ({ label, minRole, source: { file: "sales/tasks/actions.ts", fn } });
const invoice = (label: string, fn: string, file = "invoices/actions.ts"): EditScopeAction => ({ label, minRole: "admin", source: { file, fn } });

export const EDIT_SCOPE: Readonly<Record<string, readonly EditScopeAction[]>> = {
  sales_leads: [
    lead("Create leads", "editor", "createLead"),
    lead("Set marketing attribution", "editor", "setLeadAttribution"),
    lead("Add notes", "editor", "addLeadNote"),
    lead("Correct contact details", "editor", "updateLeadContact"),
    lead("Change pipeline status", "admin", "updateLeadStatus"),
    lead("Assign leads", "admin", "assignLead"),
    lead("Set or clear follow-ups", "admin", "setLeadFollowUp"),
    lead("Update qualification", "admin", "updateLeadQualification"),
    lead("Update temperature", "admin", "updateLeadTemperature"),
    lead("Convert to opportunity", "admin", "convertLeadToOpportunity"),
    lead("Mark as Test/Demo", "admin", "markLeadTest"),
  ],
  sales_opportunities: [
    opp("Add notes", "editor", "addOpportunityNote"),
    opp("Update stage", "admin", "updateOpportunityStage"),
    opp("Assign opportunities", "admin", "assignOpportunity"),
    opp("Set expected close date", "admin", "setOpportunityExpectedClose"),
    opp("Mark lost", "admin", "markOpportunityLost"),
    opp("Link a company", "admin", "linkCompany"),
  ],
  sales_quotations: [
    quote("Create quotations", "createQuotation"),
    quote("Edit draft quotations", "updateQuotationDraft"),
    quote("Mark as Sent", "markQuotationSent"),
    quote("Accept quotations", "acceptQuotationAction"),
    quote("Reject quotations", "rejectQuotationAction"),
    quote("Create revisions", "createRevision"),
  ],
  sales_tasks: [
    task("Create own tasks", "editor", "createTask"),
    task("Update own tasks", "editor", "updateTask"),
    task("Complete or reschedule own tasks", "editor", "setTaskStatus"),
    task("Delete tasks", "admin", "deleteTask"),
  ],
  invoices: [
    invoice("Create invoices from accepted quotations", "createInvoiceFromQuotationAction"),
    invoice("Edit draft invoices", "updateInvoiceDraft"),
    invoice("Issue invoices", "issueInvoiceAction"),
    invoice("Record manual payments", "recordManualPaymentAction"),
    invoice("Generate receipts", "generateReceiptAction"),
    invoice("Cancel invoices", "cancelInvoiceAction"),
    invoice("ToyyibPay payment links and status checks", "generateToyyibpayPaymentLinkAction", "invoices/toyyibpayActions.ts"),
  ],
  // Rescheduling from the Follow-ups queue writes the lead (setLeadFollowUp), which needs Admin and Leads edit.
  sales_followups: [],
  // Read-only modules: there is nothing to edit, so Edit behaves exactly like View.
  sales: [],
  sales_reports: [],
};

export type EditScopeSummary =
  | { kind: "unrestricted" }
  | { kind: "not_applicable" }
  | { kind: "read_only_module" }
  | { kind: "scoped"; allowed: string[]; adminOnly: string[] };

/**
 * Summarise what Edit on `moduleKey` lets `role` do. Returns "not_applicable"
 * for modules this table does not describe, so callers show nothing rather than
 * guess. Super Admin passes every module gate and every role gate.
 */
export function summariseEditScope(role: UserRole | null | undefined, moduleKey: string): EditScopeSummary {
  if (role === "super_admin") return { kind: "unrestricted" };
  const actions = EDIT_SCOPE[moduleKey];
  if (!actions) return { kind: "not_applicable" };
  if (actions.length === 0) return { kind: "read_only_module" };
  const allowed = actions.filter((action) => hasMinRole(role, action.minRole)).map((action) => action.label);
  const adminOnly = actions.filter((action) => !hasMinRole(role, action.minRole)).map((action) => action.label);
  return { kind: "scoped", allowed, adminOnly };
}

/** One-line description for Staff User Management, or null when there is nothing useful to say. */
export function describeEditScope(role: UserRole | null | undefined, moduleKey: string): string | null {
  const summary = summariseEditScope(role, moduleKey);
  switch (summary.kind) {
    case "unrestricted":
    case "not_applicable":
      return null;
    case "read_only_module":
      return "Read-only module: Edit gives no extra actions.";
    case "scoped":
      if (summary.allowed.length === 0) return `Edit gives this role no actions here (Admin only: ${summary.adminOnly.join(", ")}).`;
      if (summary.adminOnly.length === 0) return `Edit allows: ${summary.allowed.join(", ")}.`;
      return `Edit allows: ${summary.allowed.join(", ")}. Admin only: ${summary.adminOnly.join(", ")}.`;
  }
}
