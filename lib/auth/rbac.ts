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

export const isSuperAdmin = (r?: UserRole | null) => r === "super_admin";
export const isAdmin = (r?: UserRole | null) => hasMinRole(r, "admin");
export const isEditor = (r?: UserRole | null) => hasMinRole(r, "editor");
export const isTrainer = (r?: UserRole | null) => r === "trainer";

/**
 * Attendance access. Trainers (who sit below Editor in the general
 * hierarchy) get explicit attendance rights: read + write. Editors read
 * only; Admin/Super Admin full.
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
  ["certificates", "Certificates", "Certification", "trainer"],
  ["certificate_templates", "Certificate Templates", "Certification", "admin"],
  ["sales", "Sales Dashboard", "Sales", "editor"],
  ["sales_leads", "Leads", "Sales", "editor"],
  ["sales_opportunities", "Opportunities", "Sales", "editor"],
  ["sales_quotations", "Quotations", "Sales", "editor"],
  ["sales_followups", "Follow-ups", "Sales", "editor"],
  ["sales_tasks", "Tasks", "Sales", "editor"],
  ["sales_reports", "Sales Reports", "Sales", "editor"],
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

export const MODULE_ACCESS: Record<string, UserRole> = Object.fromEntries(
  MODULE_CATALOG.map((module) => [module.key, module.minRole])
);

export const SALES_MODULE_KEYS = [
  "sales",
  "sales_leads",
  "sales_opportunities",
  "sales_quotations",
  "sales_followups",
  "sales_tasks",
  "sales_reports",
] as const;

export const DEPARTMENTS: Array<{ value: StaffDepartment; label: string }> = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "training_operations", label: "Training Operations" },
  { value: "finance", label: "Finance" },
  { value: "administration", label: "Administration" },
  { value: "management", label: "Management" },
  { value: "hr", label: "HR" },
];

export const SALES_PRESET = new Set<string>(SALES_MODULE_KEYS);

export const STAFF_ROLES: UserRole[] = ["super_admin", "admin", "editor", "trainer"];

export function canAccessModule(
  role: UserRole | null | undefined,
  moduleKey: string,
  moduleKeys?: ReadonlySet<string> | readonly string[],
  accessControlEnabled = false,
) {
  const min = MODULE_ACCESS[moduleKey];
  if (!min) return false;
  if (!hasMinRole(role, min)) return false;
  if (role === "super_admin" || !accessControlEnabled) return true;
  if (typeof (moduleKeys as ReadonlySet<string>).has === "function") {
    return (moduleKeys as ReadonlySet<string>).has(moduleKey);
  }
  return (moduleKeys as readonly string[]).includes(moduleKey);
}
