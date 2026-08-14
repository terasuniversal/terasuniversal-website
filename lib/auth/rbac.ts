import type { UserRole } from "../supabase/database.types";

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
export const MODULE_ACCESS: Record<string, UserRole> = {
  dashboard: "editor",
  reports: "editor",
  sales: "editor",
  sales_leads: "editor",
  sales_opportunities: "editor",
  sales_quotations: "editor",
  sales_followups: "editor",
  sales_tasks: "editor",
  sales_reports: "editor",
  courses: "editor",
  trainers: "editor",
  schedules: "editor",
  participants: "editor",
  companies: "editor",
  attendance: "trainer",
  assessment: "trainer",
  certificates: "editor",
  news: "editor",
  gallery: "editor",
  faq: "editor",
  downloads: "editor",
  company: "editor",
  media: "editor",
  automation: "admin",
  audit: "admin",
  users: "super_admin",
};

export function canAccessModule(role: UserRole | null | undefined, moduleKey: string) {
  const min = MODULE_ACCESS[moduleKey];
  if (!min) return false;
  return hasMinRole(role, min);
}
