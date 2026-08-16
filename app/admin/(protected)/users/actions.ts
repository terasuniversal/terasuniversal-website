"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import {
  staffProfileSchema,
  setStaffModuleAccessSchema,
  fieldErrors,
} from "../../../../lib/validation/schemas";

export type StaffActionState = { message?: string; errors?: Record<string, string> };

/** Map known RPC guard errors to safe, user-facing messages. */
function mapRpcError(raw: string | undefined): string {
  const msg = raw ?? "";
  if (msg.includes("cannot remove the last active super admin"))
    return "Cannot deactivate or demote the last active Super Admin.";
  if (msg.includes("forbidden_admin_target"))
    return "Admins cannot manage other admin or super-admin accounts.";
  if (msg.includes("forbidden_promotion"))
    return "Admins cannot assign the admin or super-admin role.";
  if (msg.includes("cannot_modify_self")) return "You cannot modify your own account here.";
  if (msg.includes("user_not_found")) return "That staff member no longer exists.";
  if (msg.includes("invalid_access_level")) return "Invalid module access level selected.";
  if (msg.includes("invalid_module_key")) return "An unknown module was submitted.";
  if (msg.includes("invalid_modules")) return "Invalid module access payload.";
  if (msg.includes("forbidden")) return "You are not permitted to perform this action.";
  if (msg.includes("invalid_user")) return "Invalid user.";
  return "The update could not be completed. Please try again.";
}

function revalidateStaff() {
  revalidatePath("/admin/users");
  revalidatePath("/admin/users/[id]");
  revalidatePath("/admin/users/new");
}

/**
 * Edit a staff profile (name / department / role / active / access-control
 * mode). Server-guarded via requireModuleAccess("users"); the database RPC
 * enforces the admin/super_admin authorization matrix + last-super-admin rule.
 */
export async function updateStaffProfile(
  userId: string,
  _prev: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requireModuleAccess("users", "admin");
  const parsed = staffProfileSchema.safeParse({
    full_name: formData.get("full_name"),
    department: formData.get("department") || null,
    role: formData.get("role"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
    access_control_enabled: formData.get("access_control_enabled") === "on" || formData.get("access_control_enabled") === "true",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_staff_profile", {
    p_user_id: userId,
    p_full_name: parsed.data.full_name,
    p_department: parsed.data.department ?? null,
    p_role: parsed.data.role,
    p_is_active: parsed.data.is_active,
  });
  if (error) return { message: mapRpcError(error.message) };

  revalidateStaff();
  return { message: "Staff profile updated." };
}

/** Activate / deactivate a staff account (same guarded RPC path). */
export async function setStaffActive(
  _prev: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requireModuleAccess("users", "admin");
  const userId = String(formData.get("user_id") ?? "");
  const active = formData.get("active") === "true";
  if (!userId) return { message: "Missing user." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_staff_profile", {
    p_user_id: userId,
    p_is_active: active,
  });
  if (error) return { message: mapRpcError(error.message) };

  revalidateStaff();
  return { message: active ? "Staff member activated." : "Staff member deactivated." };
}

/**
 * Replace a profile's explicit module grants. modules come as a JSON string
 * in the form (the client matrix serializes to [{module_key, access_level}]).
 */
export async function saveStaffModuleAccess(
  userId: string,
  _prev: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requireModuleAccess("users", "admin");

  let modules: unknown;
  try {
    modules = JSON.parse(String(formData.get("modules") ?? "[]"));
  } catch {
    return { message: "Invalid module access payload." };
  }

  const parsed = setStaffModuleAccessSchema.safeParse({ user_id: userId, modules });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_module_access", {
    p_user_id: parsed.data.user_id,
    p_modules: parsed.data.modules as unknown as Record<string, unknown>,
  });
  if (error) return { message: mapRpcError(error.message) };

  revalidateStaff();
  return { message: "Module access updated." };
}
