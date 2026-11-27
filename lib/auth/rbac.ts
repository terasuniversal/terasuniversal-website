import type { StaffDepartment, UserRole } from "../supabase/database.types";

/**
 * Role hierarchy — smaller index = more privileged. Mirrors the Postgres
 * enum order so client and server agree on precedence.
 */
export const ROLE_ORDER: UserRole[] = [
  "super_admin",
  "admin",
  "editor",
  "trainer",
  "client",
  "participant",
];

export function rank(role: UserRole): number {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

/** True if `role` is at least as privileged as `min`. */
export function hasMinRole(role: UserRole | null | undefined, min: UserRole) {
  if (!role) return false;
  return rank(role) <= rank(min);
}

/**
 * Role eligibility half of a module capability (application mirror of the
 * database helper app.can_module, RBAC M-02): admin and super_admin are
 * eligible; an editor only with Custom Module Access (access_control_enabled =
 * true). An editor on Role Default Access gets nothing from the editor role
 * alone, and trainer and below are never eligible. The module grant itself is
 * still checked by has_module_access_level (requireModuleCapability).
 */
export function isCapabilityRoleEligible(
  profile: { role: UserRole | null; is_active: boolean | null; access_control_enabled?: boolean | null } | null | undefined,
): boolean {
  if (!profile || profile.is_active !== true) return false;
  if (hasMinRole(profile.role, "admin")) return true;
  return profile.role === "editor" && profile.access_control_enabled === true;
}

export const isSuperAdmin = (r?: UserRole | null) => r === "super_admin";
export const isAdmin = (r?: UserRole | null) => hasMinRole(r, "admin");
export const isEditor = (r?: UserRole | null) => hasMinRole(r, "editor");
export const isTrainer = (r?: UserRole | null) => r === "trainer";

/**
 * Attendance access by ROLE. Trainers (who sit below Editor in the general
 * hierarchy) get explicit attendance rights: read + write; Admin/Super Admin
 * full. An Editor writes only through a module capability (Custom access +
 * Attendance Edit, e.g. Training Ops Staff, T1) -- requireAttendance(true)
 * adds that branch via isCapabilityRoleEligible.
 */
export const canViewAttendance = (r?: UserRole | null) => isEditor(r) || isTrainer(r);
export const canManageAttendance = (r?: UserRole | null) => isAdmin(r) || isTrainer(r);

// Assessment shares the same permission set as attendance.
export const canViewAssessment = (r?: UserRole | null) => isEditor(r) || isTrainer(r);
export const canManageAssessment = (r?: UserRole | null) => isAdmin(r) || isTrainer(r);

// Certificates: all staff (incl. Trainer) may view; only Admin+ may generate/manage.
export const canViewCertificate = (r?: UserRole | null) => isEditor(r) || isTrainer(r);
export const canManageCertificate = (r?: UserRole | null) => isAdmin(r);

/**
 * Which roles may access which admin module (route-level gate). This is the
 * UI-side mirror of the RLS policies — RLS remains the real enforcement.
 */
export interface ModuleDefinition {
  key: string;
  label: string;
  group: string;
  minRole: UserRole;
}

export type ModuleAccessLevel = "view" | "edit" | "admin";

export interface StaffAccessPreset {
  id: string;
  label: string;
  role: UserRole;
  department: StaffDepartment;
  accessControlEnabled: true;
  modules: readonly { moduleKey: string; accessLevel: Exclude<ModuleAccessLevel, "admin"> }[];
}

/** Application mirror of public.staff_module_catalog. */
export const MODULE_CATALOG: ModuleDefinition[] = [
  ["dashboard", "Dashboard", "Overview", "editor"],
  ["reports", "Reports & Analytics", "Overview", "editor"],
  ["courses", "Courses", "Training Operations", "editor"],
  ["trainers", "Trainers", "Training Operations", "editor"],
  ["schedules", "Training Schedule", "Training Operations", "editor"],
  ["participants", "Participants", "Training Operations", "editor"],
  ["companies", "Companies", "Training Operations", "editor"],
  ["attendance", "Attendance", "Training Operations", "trainer"],
  ["assessment", "Assessment", "Training Operations", "trainer"],
  // Live in production's staff_module_catalog (min_role: admin) with a
  // working, DB-guarded route (app/admin/(protected)/assessors/*, every
  // page/action calls requireModuleAccess("assessors")) but was missing from
  // this catalog -- reconciled here, not newly introduced. min_role matches
  // the live catalog row exactly (re-verified 2026-08-23).
  ["assessors", "Assessors", "Training Operations", "admin"],
  // Legacy Participant Migration Phase 2 review UI -- raw legacy PII and
  // participant-identity decisions, admin-only by design (see
  // LEGACY_IMPORT_PHASE2 review). Matches the live
  // staff_module_catalog row (min_role: admin).
  ["legacy_import", "Legacy Import", "Training Operations", "admin"],
  ["certificates", "Certificates", "Certification", "trainer"],
  ["certificate_templates", "Certificate Templates", "Certification", "admin"],
  ["sales", "Sales Dashboard", "Sales", "editor"],
  ["sales_leads", "Leads", "Sales", "editor"],
  ["sales_opportunities", "Opportunities", "Sales", "editor"],
  ["sales_quotations", "Quotations", "Sales", "editor"],
  // Invoice Module V1. View = editor+ (matches sales_quotations); creating a
  // draft, issuing, recording a payment, and cancelling all additionally
  // require app.is_admin() via RLS/the RPCs -- same two-layer gate as
  // Quotations. No separate "payments" module key -- payments have no
  // list/detail page of their own, always viewed inside an invoice.
  ["invoices", "Invoices", "Sales", "editor"],
  // Canonical staff_module_catalog row (hrdf_claims, sales, admin). Staff
  // User Management may explicitly assign it to non-admin staff, but the
  // HRDF operational actions remain Admin-only and non-admin assignments are
  // persisted at view level by the staff-management action.
  ["hrdf_claims", "HRDF Claims", "Sales", "admin"],
  ["sales_followups", "Follow-ups", "Sales", "editor"],
  ["sales_tasks", "Tasks", "Sales", "editor"],
  ["sales_reports", "Sales Reports", "Sales", "editor"],
  // Marketing CRM Phase 1A -- mirrors public.staff_module_catalog rows
  // added by supabase/migrations/20260827090000_create_marketing_campaigns_v1.sql.
  // marketing_reports is added in its own later phase migration (1D), not
  // here -- same one-key-per-shipped-feature discipline the Sales block
  // above already follows.
  ["marketing", "Marketing Dashboard", "Marketing", "editor"],
  ["marketing_campaigns", "Campaigns", "Marketing", "editor"],
  // Marketing CRM Phase 1B-A -- mirrors public.staff_module_catalog row
  // added by supabase/migrations/20260828090000_create_marketing_contacts_v1.sql.
  // Not applied to any database yet (schema-preparation only) -- this
  // entry is inert client-side until the migration is actually applied.
  ["marketing_contacts", "Marketing Contacts", "Marketing", "editor"],
  ["news", "News", "Website Content", "editor"],
  ["gallery", "Gallery", "Website Content", "editor"],
  ["faq", "FAQ", "Website Content", "editor"],
  ["downloads", "Downloads", "Website Content", "editor"],
  ["company", "Company Profile", "Website Content", "editor"],
  ["media", "Media Library", "Website Content", "editor"],
  ["automation", "Automation Centre", "Administration", "admin"],
  ["system", "System Health", "Administration", "admin"],
  ["backups", "Backup Manager", "Administration", "admin"],
  ["audit", "Audit Log", "Administration", "admin"],
  ["users", "Staff Users", "Administration", "admin"],
  ["feedback", "Feedback Dashboard", "Feedback", "editor"],
  ["feedback_responses", "Feedback Responses", "Feedback", "editor"],
  ["feedback_issues", "Feedback Issues", "Feedback", "editor"],
  ["feedback_actions", "Feedback Actions", "Feedback", "editor"],
].map(([key, label, group, minRole]) => ({ key, label, group, minRole } as ModuleDefinition));

export const MODULE_ACCESS: Record<string, UserRole> = {
  ...Object.fromEntries(MODULE_CATALOG.map((module) => [module.key, module.minRole])),
  // Role-gated pages with no staff_module_catalog row. They are deliberately NOT in
  // MODULE_CATALOG, so Staff User Management cannot assign them. Only Super Admin
  // reaches /admin/executive (requireRole("super_admin") in the page and loader).
  executive: "super_admin",
  // /admin/registrations: Admin and above (requireRole("admin") in the page and loader;
  // RLS on the registration tables allows only app.is_admin() reads).
  registrations: "admin",
};

export const SALES_MODULE_KEYS = [
  "sales",
  "sales_leads",
  "sales_opportunities",
  "sales_quotations",
  "invoices",
  "sales_followups",
  "sales_tasks",
  "sales_reports",
] as const;

/**
 * Department presets used by Staff User Management only. Applying one changes
 * the form draft; it is never a dynamic policy and never synchronizes existing
 * staff. Both create an Editor with Custom Module Access, which is exactly what
 * app.can_module / requireModuleCapability admit (RBAC hardening, D-05/D-06):
 *  - Sales Staff: leads, opportunities and quotations at Edit (prepare, send,
 *    accept/reject quotations; convert leads); own tasks and follow-ups. No
 *    invoice, payment, receipt, HRDF, Training, content or admin modules.
 *  - Finance Staff: invoices at Edit (create from an accepted quotation, edit
 *    drafts, issue, record manual payments, receipts, ToyyibPay link/status,
 *    cancel); quotations View only (D-05); HRDF View (HRDF edit stays Super
 *    Admin only and its actions are paused). No Sales write, Training, HR or
 *    administration modules.
 * Neither includes "companies": companies_staff_read already lets any editor read
 * company records for linking/quotations, while the Companies module itself
 * exposes participant lists (Training Operations data).
 */
export const SALES_STAFF_PRESET = {
  id: "sales_staff",
  label: "Sales Staff",
  role: "editor",
  department: "sales",
  accessControlEnabled: true,
  modules: [
    { moduleKey: "sales", accessLevel: "view" },
    { moduleKey: "sales_leads", accessLevel: "edit" },
    { moduleKey: "sales_opportunities", accessLevel: "edit" },
    { moduleKey: "sales_quotations", accessLevel: "edit" },
    { moduleKey: "sales_followups", accessLevel: "edit" },
    { moduleKey: "sales_tasks", accessLevel: "edit" },
    { moduleKey: "sales_reports", accessLevel: "view" },
  ],
} as const satisfies StaffAccessPreset;

export const FINANCE_STAFF_PRESET = {
  id: "finance_staff",
  label: "Finance Staff",
  role: "editor",
  department: "finance",
  accessControlEnabled: true,
  modules: [
    { moduleKey: "invoices", accessLevel: "edit" },
    { moduleKey: "sales_quotations", accessLevel: "view" },
    { moduleKey: "hrdf_claims", accessLevel: "view" },
    { moduleKey: "sales_reports", accessLevel: "view" },
  ],
} as const satisfies StaffAccessPreset;

/**
 * Training Ops Staff (OWNER-TRAINING-T1-20261125): an Editor with Custom Module Access who runs Training
 * Operations centrally (no Trainer or Assessor accounts). Edit on schedules, enrolments, participants, trainers,
 * assessors, attendance, draft assessments, training resources and participant feedback; View on the Training
 * dashboard, reports, courses (restricted course editing is not safely enforceable yet, so Courses stays View) and
 * certificates (issuance and corrections stay Super Admin / Admin). No Admin-level grant, so DELETE, archive/restore
 * (Admin role floor, T1-b), assessment finalisation (Super Admin), WAH corrections, public registrations, users,
 * CEO Dashboard and HRDF stay out of reach. No Sales or Finance module.
 */
export const TRAINING_OPS_STAFF_PRESET = {
  id: "training_ops_staff",
  label: "Training Ops Staff",
  role: "editor",
  department: "training_operations",
  accessControlEnabled: true,
  modules: [
    { moduleKey: "dashboard", accessLevel: "view" },
    { moduleKey: "reports", accessLevel: "view" },
    { moduleKey: "courses", accessLevel: "view" },
    { moduleKey: "schedules", accessLevel: "edit" },
    { moduleKey: "participants", accessLevel: "edit" },
    { moduleKey: "trainers", accessLevel: "edit" },
    { moduleKey: "assessors", accessLevel: "edit" },
    { moduleKey: "attendance", accessLevel: "edit" },
    { moduleKey: "assessment", accessLevel: "edit" },
    { moduleKey: "certificates", accessLevel: "view" },
    { moduleKey: "downloads", accessLevel: "edit" },
    { moduleKey: "feedback", accessLevel: "edit" },
    { moduleKey: "feedback_responses", accessLevel: "view" },
    { moduleKey: "feedback_issues", accessLevel: "edit" },
    { moduleKey: "feedback_actions", accessLevel: "edit" },
  ],
} as const satisfies StaffAccessPreset;

export const STAFF_ACCESS_PRESETS: readonly StaffAccessPreset[] = [SALES_STAFF_PRESET, FINANCE_STAFF_PRESET, TRAINING_OPS_STAFF_PRESET];

export const DEPARTMENTS: Array<{ value: StaffDepartment; label: string }> = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "training_operations", label: "Training Operations" },
  { value: "finance", label: "Finance" },
  { value: "administration", label: "Administration" },
  { value: "management", label: "Management" },
  { value: "hr", label: "HR" },
];

// Backward-compatible key-only view for consumers that only need the Sales
// module set; the form uses SALES_STAFF_PRESET for levels and profile fields.
export const SALES_PRESET = new Set<string>(SALES_STAFF_PRESET.modules.map((module) => module.moduleKey));

export const STAFF_ROLES: UserRole[] = ["super_admin", "admin", "editor", "trainer"];

export function canAccessModule(
  role: UserRole | null | undefined,
  moduleKey: string,
  moduleKeys?: ReadonlySet<string> | readonly string[],
  accessControlEnabled = false,
) {
  // Super admins are not constrained by the optional per-user module-access
  // catalog. Keep the sidebar consistent with requireModuleAccess(), which
  // already treats super_admin as an unconditional allow.
  if (role === "super_admin") return true;
  const min = MODULE_ACCESS[moduleKey];
  if (!min) return false;
  const hasExplicitModule = typeof (moduleKeys as ReadonlySet<string>).has === "function"
    ? (moduleKeys as ReadonlySet<string>).has(moduleKey)
    : (moduleKeys as readonly string[]).includes(moduleKey);
  // HRDF is metadata-admin by default, but an explicit custom view
  // assignment is valid for an Editor. Keep the sidebar aligned with
  // has_module_access_level(), whose explicit branch evaluates the assignment
  // independently of the catalog role floor.
  if (moduleKey === "hrdf_claims" && accessControlEnabled) return hasExplicitModule;
  // Assessors (catalog floor admin) is likewise valid as an explicit Custom assignment for an Editor (Training Ops
  // Staff, T1): assessors_read / can_manage_assessors use app.can_module, which honours the explicit grant.
  if (moduleKey === "assessors" && accessControlEnabled && role === "editor") return hasExplicitModule;
  if (!hasMinRole(role, min)) return false;
  if (!accessControlEnabled) return true;
  return hasExplicitModule;
}
