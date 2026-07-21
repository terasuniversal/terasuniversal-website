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

/**
 * Which roles may access which admin module (route-level gate). This is the
 * UI-side mirror of the RLS policies — RLS remains the real enforcement.
 */
export const MODULE_ACCESS: Record<string, UserRole> = {
  dashboard: "editor",
  courses: "editor",
  schedules: "editor",
  participants: "editor",
  attendance: "editor",
  certificates: "editor",
  news: "editor",
  gallery: "editor",
  faq: "editor",
  downloads: "editor",
  company: "editor",
  media: "editor",
  audit: "admin",
  users: "super_admin",
};

export function canAccessModule(role: UserRole | null | undefined, moduleKey: string) {
  const min = MODULE_ACCESS[moduleKey];
  if (!min) return false;
  return hasMinRole(role, min);
}
