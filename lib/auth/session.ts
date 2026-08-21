import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "../supabase/server";
import type { Profile, UserRole } from "../supabase/database.types";
import { hasMinRole, canAccessModule, canViewAttendance, canManageAttendance, canViewAssessment, canManageAssessment, canViewCertificate, canManageCertificate } from "./rbac";

/**
 * Returns the current staff member's profile (role, status, name) or null.
 * Wrapped in React `cache` so multiple calls within one request hit the DB
 * once.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (profile as Profile) ?? null;
});

/** Load the current user's explicit module set once per server request. */
export const getCurrentModuleAccess = cache(async (): Promise<Set<string>> => {
  const profile = await getCurrentProfile();
  if (!profile || !profile.access_control_enabled || profile.role === "super_admin") return new Set();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("staff_module_access")
    .select("module_key")
    .eq("user_id", profile.id);
  return new Set((data ?? []).map((row: { module_key: string }) => row.module_key));
});

/**
 * Guard for server components / actions. Redirects to login if not signed
 * in, or to /admin/no-access if the role is insufficient. Returns the
 * profile so callers can use it directly.
 */
export async function requireRole(min: UserRole = "editor"): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  if (!hasMinRole(profile.role, min)) redirect("/admin/no-access");
  return profile;
}

/**
 * Admits any active staff member — editor/admin/super_admin OR trainer.
 * Used by the protected layout so Trainers can enter the admin area (they
 * are then gated to the modules they may use, e.g. Attendance).
 */
const STAFF_ROLES: UserRole[] = ["super_admin", "admin", "editor", "trainer"];
export async function requireStaff(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  if (!STAFF_ROLES.includes(profile.role)) redirect("/admin/no-access");
  return profile;
}

/**
 * Central module guard. It enforces the catalog role threshold and, for
 * profiles with explicit access control enabled, the stored allow-list.
 *
 * The second parameter is accepted-but-ignored for call-site compatibility
 * with callers still passing a graduated access level (this module's own
 * access check is presence-based, not leveled) -- avoids forcing every
 * existing requireModuleAccess(key, "admin")-style call site to change just
 * because of this reconciliation.
 */
export async function requireModuleAccess(moduleKey: string, _level?: string): Promise<Profile> {
  const profile = await requireStaff();
  const moduleKeys = await getCurrentModuleAccess();
  if (!canAccessModule(profile.role, moduleKey, moduleKeys, profile.access_control_enabled)) {
    redirect("/admin/no-access");
  }
  return profile;
}

/**
 * Non-redirecting module-access check for Route Handlers (export/download
 * endpoints), which return a 403 response rather than redirecting like
 * requireModuleAccess does for pages. Same underlying check, just without
 * the redirect side effect.
 */
export async function hasModuleAccess(moduleKey: string, _level?: string): Promise<boolean> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) return false;
  const moduleKeys = await getCurrentModuleAccess();
  return canAccessModule(profile.role, moduleKey, moduleKeys, profile.access_control_enabled);
}

/**
 * Attendance guard. Trainers are allowed here even though they sit below
 * Editor in the general hierarchy. `write=true` requires manage rights.
 */
export async function requireAttendance(write = false): Promise<Profile> {
  const profile = await requireModuleAccess("attendance");
  const ok = write ? canManageAttendance(profile.role) : canViewAttendance(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/** Assessment guard (same role set as attendance). */
export async function requireAssessment(write = false): Promise<Profile> {
  const profile = await requireModuleAccess("assessment");
  const ok = write ? canManageAssessment(profile.role) : canViewAssessment(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/**
 * Certificate guard. All staff (incl. Trainer) may view; `manage=true`
 * (generate/revoke/reissue/templates) requires Admin+.
 */
export async function requireCertificate(manage = false): Promise<Profile> {
  const profile = await requireModuleAccess("certificates");
  const ok = manage ? canManageCertificate(profile.role) : canViewCertificate(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}
