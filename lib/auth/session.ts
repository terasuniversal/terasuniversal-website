import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "../supabase/server";
import type { Profile, UserRole, ModuleAccessLevel } from "../supabase/database.types";
import { hasMinRole, isCapabilityRoleEligible, canViewAttendance, canManageAttendance, canViewAssessment, canManageAssessment, canViewCertificate, canManageCertificate } from "./rbac";

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
 * Load the current user's explicit module set, for Sidebar/Topbar display
 * only (which items to *show*). This is NOT the authorization boundary —
 * requireModuleAccess()/hasModuleAccess() below enforce access via the
 * has_module_access_level DB RPC regardless of what this returns. A query
 * error here degrades to an empty set (fewer nav items shown) rather than
 * blocking rendering; it must never be used to grant or deny a request.
 */
export const getCurrentModuleAccess = cache(async (): Promise<Set<string>> => {
  const profile = await getCurrentProfile();
  if (!profile || !profile.access_control_enabled || profile.role === "super_admin") return new Set();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff_module_access")
    .select("module_key")
    .eq("user_id", profile.id);
  if (error) {
    console.error("getCurrentModuleAccess: staff_module_access lookup failed", { message: error.message, userId: profile.id });
    return new Set();
  }
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
 * Module-access guard (Staff User Management Phase 1).
 *
 * Enforces `public.has_module_access_level(moduleKey, level)` server-side —
 * this RPC, not any local computation, is the authorization source of
 * truth. Behavior is backward-compatible: profiles without explicit access
 * control fall back to the module catalog's role threshold
 * (`staff_module_catalog.min_role`), so existing admin/editor staff keep
 * their current access. Profiles with `access_control_enabled=true` must
 * hold an explicit `staff_module_access` row at or above `level`. Super
 * admins always pass. A failed RPC call fails closed (redirects to
 * no-access), same as an explicit denial.
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

export { isCapabilityRoleEligible };

/**
 * Capability guard for module-scoped staff operations (RBAC M-02 mirror):
 * active staff, role-eligible (see isCapabilityRoleEligible), and an explicit
 * module grant at or above `level` via has_module_access_level - the same rule
 * the database enforces in app.can_module() for RLS and the internal RPC gates.
 * It needs no new RPC, so it is safe before or after the DB migrations: for an
 * admin it is exactly the previous requireRole("admin") + requireModuleAccess
 * pair, and an Editor admitted here is still rejected by an older database.
 */
export async function requireModuleCapability(moduleKey: string, level: ModuleAccessLevel = "edit"): Promise<Profile> {
  const profile = await requireRole("editor");
  if (!isCapabilityRoleEligible(profile)) redirect("/admin/no-access");
  await requireModuleAccess(moduleKey, level);
  return profile;
}

/** Non-redirecting form of requireModuleCapability, for button visibility and in-action branches. */
export async function hasModuleCapability(
  moduleKey: string,
  level: ModuleAccessLevel = "edit",
  profile?: Profile | null,
): Promise<boolean> {
  const current = profile ?? (await getCurrentProfile());
  if (!isCapabilityRoleEligible(current)) return false;
  return hasModuleAccess(moduleKey, level);
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

/**
 * Attendance guard. Trainers are allowed here even though they sit below
 * Editor in the general hierarchy. `write=true` requires manage rights.
 */
export async function requireAttendance(write = false): Promise<Profile> {
  // Writes need Attendance at Edit, the same level the attendance write policies require (RBAC M-09).
  const profile = await requireModuleAccess("attendance", write ? "edit" : "view");
  // T1: a write is a module capability (Admin, or an Editor with Custom access + Attendance Edit, e.g. Training Ops
  // Staff), or the unchanged Trainer branch -- the same two branches as the attendance write policies.
  const ok = write ? canManageAttendance(profile.role) || isCapabilityRoleEligible(profile) : canViewAttendance(profile.role);
  if (!ok) redirect("/admin/no-access");
  return profile;
}

/** Assessment guard (same role set as attendance). */
export async function requireAssessment(write = false): Promise<Profile> {
  // Writes need Assessment at Edit, the same level the assessment write policies require (RBAC M-09).
  const profile = await requireModuleAccess("assessment", write ? "edit" : "view");
  // T1: same two branches as the assessment write policies (module capability, or the Trainer branch).
  const ok = write ? canManageAssessment(profile.role) || isCapabilityRoleEligible(profile) : canViewAssessment(profile.role);
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
