import { hasMinRole } from "./rbac";
import type { UserRole } from "../supabase/database.types";

/**
 * What an "Edit" module grant actually lets a staff member do, per role and access mode.
 *
 * Module access (None/View/Edit) is only one of the gates. Sales and Finance server actions use one of three guards:
 *  - "editor":     requireRole("editor") + requireModuleAccess(module, "edit")  (everyday work);
 *  - "capability": requireModuleCapability(module, "edit") — Admin, or an Editor with Custom Module Access and Edit
 *                  on the module (RBAC hardening; an Editor on Role Default access never gets these from the role);
 *  - "admin":      Admin (requireRole("admin") or an explicit Admin check inside the action);
 *  - "super_admin": Super Admin only (T1: assessment finalisation, unlock, WAH corrections; K2 G9-1: participant name
 *                  and identity details).
 * Staff User Management shows this table so the label "Edit" never promises more than the server allows (SEC-3).
 *
 * This file only DESCRIBES authorization; it grants nothing. Each entry names the exported server action it mirrors,
 * and scripts/sec3-edit-scope-contract.test.mts parses those action files and fails if a requirement here drifts from
 * the real guard. The Training Operations entries (T1) are checked the same way by
 * scripts/t1-training-ops-contract.test.mts.
 */
export type EditRequirement = "editor" | "capability" | "admin" | "super_admin";

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
const training = (file: string) => (label: string, requires: EditRequirement, fn: string): EditScopeAction => ({ label, requires, source: { file, fn } });
const sched = training("schedules/actions.ts");
const part = training("participants/actions.ts");
const trainer = training("trainers/actions.ts");
const assessor = training("assessors/actions.ts");
const attend = training("attendance/actions.ts");
const assess = training("assessment/actions.ts");

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
  // Training Operations (T1, OWNER-TRAINING-T1-20261125). "capability" = Admin, or an Editor with Custom access
  // and Edit on the module (Training Ops Staff). Archive/restore keep the Admin role (app.t1_guard_soft_delete);
  // finalising results is Super Admin only. Certificates and Courses are not listed: Training Ops Staff hold View.
  schedules: [
    sched("Create and edit schedules", "capability", "createSchedule"),
    sched("Duplicate schedules", "capability", "duplicateSchedule"),
    sched("Enrol and remove participants", "capability", "assignParticipants"),
    sched("Manage participant groups", "capability", "createGroup"),
    sched("Assign the schedule assessor (needs Assessors View)", "capability", "setScheduleAssessor"),
    sched("Archive or restore schedules", "admin", "softDeleteSchedule"),
  ],
  participants: [
    part("Create and edit participants", "capability", "createParticipant"),
    part("Correct participant names", "super_admin", "correctParticipantName"),
    { label: "Import participants (CSV)", requires: "capability", source: { file: "participants/import/importActions.ts", fn: "commitImport" } },
    part("Archive or restore participants", "admin", "softDeleteParticipant"),
  ],
  trainers: [
    trainer("Create and edit trainers", "capability", "createTrainer"),
    trainer("Archive or restore trainers", "admin", "softDeleteTrainer"),
  ],
  assessors: [
    assessor("Create, edit, activate or deactivate assessors", "capability", "createAssessor"),
  ],
  attendance: [
    attend("Mark, bulk-update and reset attendance", "capability", "markAttendance"),
  ],
  assessment: [
    assess("Enter and edit draft results with the Assessor and evidence reference", "capability", "updateAssessment"),
    assess("Record the Participant Skills Record", "capability", "updateParticipantSkillResults"),
    assess("Finalise (lock) assessments", "super_admin", "lockAssessments"),
    assess("Unlock assessments", "super_admin", "unlockAssessments"),
    assess("Correct a WAH Failed Practical Assessment", "super_admin", "correctWahFailedPracticalAssessment"),
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
  | { kind: "scoped"; allowed: string[]; needsCustomAccess: string[]; adminOnly: string[]; superAdminOnly: string[] };

function meets(requires: EditRequirement, role: UserRole | null | undefined, customModuleAccess: boolean): boolean {
  if (requires === "super_admin") return role === "super_admin";
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
  const superAdminOnly: string[] = [];
  for (const action of actions) {
    if (meets(action.requires, role, customModuleAccess)) allowed.push(action.label);
    else if (action.requires === "capability" && role === "editor") needsCustomAccess.push(action.label);
    else if (action.requires === "super_admin") superAdminOnly.push(action.label);
    else adminOnly.push(action.label);
  }
  return { kind: "scoped", allowed, needsCustomAccess, adminOnly, superAdminOnly };
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
      if (summary.superAdminOnly.length > 0) parts.push(`Super Admin only: ${summary.superAdminOnly.join(", ")}.`);
      return parts.join(" ");
    }
  }
}
