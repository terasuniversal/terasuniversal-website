import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "../supabase/server";
import type { Profile, UserRole } from "../supabase/database.types";
import { hasMinRole } from "./rbac";

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
