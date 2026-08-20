import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "../supabase/server";
import type { Profile, UserRole, ModuleAccessLevel } from "../supabase/database.types";
import { hasMinRole, canViewAttendance, canManageAttendance, canViewAssessment, canManageAssessment, canViewCertificate, canManageCertificate } from "./rbac";

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

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    // PGRST116 = no matching row — a genuinely missing profile, which the
    // existing null-profile handling in every guard below already covers
    // correctly. Any other code is a real Supabase/PostgREST failure; log it
    // so it's distinguishable from a legitimate missing profile. Either way
    // this still returns null (fail closed) — a query error must never be
    // treated as a valid, authorized profile.
    if (error.code !== "PGRST116") {
      console.error("getCurrentProfile: profile lookup failed", { message: error.message, code: error.code, userId: user.id });
    }
    return null;
  }

  return (profile as Profile) ?? null;
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
 * Attendance guard. Trainers are allowed here even though they sit below
 * Editor in the general hierarchy. `write=true` requires manage rights.
 */
export async function requireAttendance(write = false): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  const ok = write ? canManageAttendance(profile.role) : canViewAttendance(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/** Assessment guard (same role set as attendance). */
export async function requireAssessment(write = false): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  const ok = write ? canManageAssessment(profile.role) : canViewAssessment(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/**
 * Certificate guard. All staff (incl. Trainer) may view; `manage=true`
 * (generate/revoke/reissue/templates) requires Admin+.
 */
export async function requireCertificate(manage = false): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  const ok = manage ? canManageCertificate(profile.role) : canViewCertificate(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/**
 * Module-access guard (Staff User Management Phase 1).
 *
 * Enforces `public.has_module_access_level(moduleKey, level)` server-side.
 * Behavior is backward-compatible: profiles without explicit access control
 * fall back to the module catalog's role threshold (`staff_module_catalog.min_role`),
 * so existing admin/editor staff keep their current access. Profiles with
 * `access_control_enabled=true` must hold an explicit `staff_module_access` row.
 * Super admins always pass.
 *
 * Callers should ALSO keep their existing `requireRole(...)` guard where one
 * exists — this guard is additive, not a replacement, during incremental
 * integration.
 */
export async function requireModuleAccess(
  moduleKey: string,
  level: ModuleAccessLevel = "view"
): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!profile.is_active) redirect("/admin/login?error=inactive");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_module_access_level", {
    p_module_key: moduleKey,
    p_level: level,
  });
  if (error || data !== true) redirect("/admin/no-access");
  return profile;
}

/**
 * Module-access check for Route Handlers (export/download endpoints), which
 * return a 403 response rather than redirecting like `requireModuleAccess`
 * does for pages. Same enforcement, same `has_module_access_level` RPC —
 * this is not a second authorization model, just a non-redirecting caller
 * for the one that already exists. Callers must still check `profile` /
 * `profile.is_active` / the existing role-based guard themselves first, the
 * same way every export route already does.
 */
export async function hasModuleAccess(
  moduleKey: string,
  level: ModuleAccessLevel = "view"
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_module_access_level", {
    p_module_key: moduleKey,
    p_level: level,
  });
  return !error && data === true;
}
