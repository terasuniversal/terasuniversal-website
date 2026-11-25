import { hasMinRole } from "./rbac";
import type { UserRole } from "../supabase/database.types";

/**
 * What an "Edit" module grant actually lets a staff member do, per role and access mode.
 *
 * Module access (None/View/Edit) is only one of the gates. Sales and Finance server actions use one of three guards:
 *  - "editor":     requireRole("editor") + requireModuleAccess(module, "edit")  (everyday work);
 *  - "capability": requireModuleCapability(module, "edit") — Admin, or an Editor with Custom Module Access and Edit
 *                  on the module (RBAC hardening; an Editor on Role Default access never gets these from the role);
 *  - "admin":      Admin (requireRole("admin") or an explicit Admin check inside the action).
 * Staff User Management shows this table so the label "Edit" never promises more than the server allows (SEC-3).
 *
 * This file only DESCRIBES authorization; it grants nothing. Each entry names the exported server action it mirrors,
 * and scripts/sec3-edit-scope-contract.test.mts parses those action files and fails if a requirement here drifts from
 * the real guard.
 */
export type EditRequirement = "editor" | "capability" | "admin";

export interface EditScopeAction {
  /** Short staff-facing description of the action. */
  label: string;
  /** Which guard the server action applies (see above). */
  requires: EditRequirement;
  /** Source file (relative to app/admin/(protected)) and exported function it mirrors. */
  source: { file: string; fn: string };
}

const lead = (label: string, requires: EditRequirement, fn: string): EditScopeAction => ({ label, requires, source: { file: "sales/leads/actions.ts", fn } });
const opp = (label: string, requires: EditRequirement, fn: string): EditScopeAction => ({ label, requires, source: { file: "sales/opportunities/actions.ts", fn } });
const quote = (label: string, fn: string): EditScopeAction => ({ label, requires: "capability", source: { file: "sales/quotations/actions.ts", fn } });
const task = (label: string, requires: EditRequirement, fn: string): EditScopeAction => ({ label, requires, source: { file: "sales/tasks/actions.ts", fn } });
const invoice = (label: string, fn: string, file = "invoices/actions.ts"): EditScopeAction => ({ label, requires: "capability", source: { file, fn } });

export const EDIT_SCOPE: Readonly<Record<string, readonly EditScopeAction[]>> = {
  sales_leads: [
    lead("Create leads", "editor", "createLead"),
    lead("Set marketing attribution", "editor", "setLeadAttribution"),
    lead("Add notes", "editor", "addLeadNote"),
    lead("Correct contact details", "editor", "updateLeadContact"),
    lead("Change pipeline status", "capability", "updateLeadStatus"),
    lead("Assign leads", "capability", "assignLead"),
    lead("Set or clear follow-ups", "capability", "setLeadFollowUp"),
    lead("Update qualification", "capability", "updateLeadQualification"),
    lead("Update temperature", "capability", "updateLeadTemperature"),
    lead("Convert to opportunity", "capability", "convertLeadToOpportunity"),
    lead("Mark as Test/Demo", "admin", "markLeadTest"),
  ],
  sales_opportunities: [
    opp("Add notes", "editor", "addOpportunityNote"),
    opp("Update stage", "capability", "updateOpportunityStage"),
    opp("Assign opportunities", "capability", "assignOpportunity"),
    opp("Set expected close date", "capability", "setOpportunityExpectedClose"),
    opp("Mark lost", "capability", "markOpportunityLost"),
    opp("Link a company", "capability", "linkCompany"),
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
  // Rescheduling from the Follow-ups queue writes the lead (setLeadFollowUp), which needs Leads capability.
  sales_followups: [],
  // Read-only modules: there is nothing to edit, so Edit behaves exactly like View.
  sales: [],
  sales_reports: [],
};

export type EditScopeSummary =
  | { kind: "unrestricted" }
  | { kind: "not_applicable" }
  | { kind: "read_only_module" }
  | { kind: "scoped"; allowed: string[]; needsCustomAccess: string[]; adminOnly: string[] };

function meets(requires: EditRequirement, role: UserRole | null | undefined, customModuleAccess: boolean): boolean {
  if (requires === "admin") return hasMinRole(role, "admin");
  if (requires === "capability") return hasMinRole(role, "admin") || (role === "editor" && customModuleAccess);
  return hasMinRole(role, "editor");
}

/**
 * Summarise what Edit on `moduleKey` lets `role` do. `customModuleAccess` is the account's Custom Module Access
 * setting (module grants only take effect in that mode, so the form passes its current mode). Returns
 * "not_applicable" for modules this table does not describe, so callers show nothing rather than guess. Super Admin
 * passes every gate.
 */
export function summariseEditScope(role: UserRole | null | undefined, moduleKey: string, customModuleAccess = true): EditScopeSummary {
  if (role === "super_admin") return { kind: "unrestricted" };
  const actions = EDIT_SCOPE[moduleKey];
  if (!actions) return { kind: "not_applicable" };
  if (actions.length === 0) return { kind: "read_only_module" };
  const allowed: string[] = [];
  const needsCustomAccess: string[] = [];
  const adminOnly: string[] = [];
  for (const action of actions) {
    if (meets(action.requires, role, customModuleAccess)) allowed.push(action.label);
    else if (action.requires === "capability" && role === "editor") needsCustomAccess.push(action.label);
    else adminOnly.push(action.label);
  }
  return { kind: "scoped", allowed, needsCustomAccess, adminOnly };
}

/** One-line description for Staff User Management, or null when there is nothing useful to say. */
export function describeEditScope(role: UserRole | null | undefined, moduleKey: string, customModuleAccess = true): string | null {
  const summary = summariseEditScope(role, moduleKey, customModuleAccess);
  switch (summary.kind) {
    case "unrestricted":
    case "not_applicable":
      return null;
    case "read_only_module":
      return "Read-only module: Edit gives no extra actions.";
    case "scoped": {
      const parts: string[] = [];
      parts.push(summary.allowed.length > 0 ? `Edit allows: ${summary.allowed.join(", ")}.` : "Edit gives this role no actions here.");
      if (summary.needsCustomAccess.length > 0) parts.push(`Needs Custom Module Access: ${summary.needsCustomAccess.join(", ")}.`);
      if (summary.adminOnly.length > 0) parts.push(`Admin only: ${summary.adminOnly.join(", ")}.`);
      return parts.join(" ");
    }
  }
}
