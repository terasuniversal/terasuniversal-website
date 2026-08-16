"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { requireStaff } from "../../../lib/auth/session";
import { resolveLandingRoute } from "../../../lib/auth/landing";
import { changePasswordSchema, fieldErrors } from "../../../lib/validation/schemas";

export type ChangePasswordState = { message?: string; errors?: Record<string, string> };

/**
 * Change the authenticated user's own password (first-login temporary password
 * or voluntary change). Uses the authenticated session's updateUser with
 * current_password — never service_role, never a browser-supplied userId.
 *
 * The must_change_password flag is cleared ONLY after GoTrue confirms the
 * update succeeded. If the update fails the flag stays set. Passwords are
 * never logged, stored, or returned.
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const profile = await requireStaff();

  const parsed = changePasswordSchema.safeParse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { current_password, new_password, confirm_password } = parsed.data;

  if (new_password !== confirm_password) {
    return { errors: { confirm_password: "Passwords do not match." } };
  }
  if (new_password === current_password) {
    return { errors: { new_password: "New password must be different from the current password." } };
  }

  const supabase = await createSupabaseServerClient();
  // Verify the current password deterministically by re-authenticating with it.
  // (GoTrue's updateUser current_password support varies by deployed version;
  // this approach guarantees the caller proves the current password and works
  // on any version. It also returns a fresh session for the updateUser call.)
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: current_password,
  });
  if (reauthError) {
    return { message: "The current password you entered is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password: new_password });
  if (error) {
    console.error("changePassword: auth.updateUser failed", { message: error.message });
    return { message: "Your password could not be updated. Please try again." };
  }

  // Flag cleared only on confirmed success (self-only RPC). Metadata records
  // whether this was a forced first-login change (flag was true before) or a
  // voluntary My Account change (flag was already false).
  const { error: clearError } = await supabase.rpc("clear_password_change_flag", {
    p_forced: profile.must_change_password,
  });
  if (clearError) {
    console.error("changePassword: clear first-login flag failed", { message: clearError.message });
    return { message: "Password updated, but your account setup could not be finalized. Please try once more." };
  }

  // Land on the user's best permitted module (Sales staff -> /admin/sales).
  const { data: moduleAccess } = await supabase.rpc("get_my_module_access");
  const allowed = Array.isArray(moduleAccess)
    ? moduleAccess.map((m: { module_key: string }) => m.module_key)
    : [];
  redirect(resolveLandingRoute(allowed));
}
