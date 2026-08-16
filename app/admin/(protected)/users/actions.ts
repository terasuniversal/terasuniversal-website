"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import {
  staffProfileSchema,
  setStaffModuleAccessSchema,
  createStaffSchema,
  fieldErrors,
} from "../../../../lib/validation/schemas";

export type StaffActionState = {
  message?: string;
  errors?: Record<string, string>;
  /** Set when a staff account was successfully created (Add Staff flow). */
  created?: boolean;
  /** One-time initial password for the new account (returned to the creating admin only, and only on complete success). */
  password?: string;
  email?: string;
  userId?: string;
  /** Set when compensating cleanup could not remove a partially-created account (Super Admin manual recovery). */
  recoveryUserId?: string;
};

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
 * Compensating rollback for a partially-created staff account.
 *
 * If profile/module configuration fails after auth.createUser succeeded, the
 * auth user (and the profile auto-created by handle_new_user) must be removed
 * so Add Staff behaves as all-or-nothing. Deleting the auth user cascades to
 * profiles (profiles.id -> auth.users.id ON DELETE CASCADE), so deleteUser is
 * the single compensating action.
 *
 * Returns true when the account was fully removed. The generated password is
 * NEVER returned on any failure path — only after COMPLETE success.
 */
async function rollbackCreatedUser(
  service: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  stage: string
): Promise<StaffActionState> {
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) {
    console.error("createStaff: compensating deleteUser failed", { message: error.message });
    return {
      message: `Account creation failed during ${stage} and the created account could NOT be automatically removed. Contact a Super Admin to remove the recovery id below before retrying.`,
      recoveryUserId: userId,
    };
  }
  return {
    message: `Account creation failed during ${stage} and was rolled back. No account was created.`,
  };
}

/**
 * Create a new staff account (Add Staff flow).
 *
 * Authorization: requireModuleAccess("users", "admin") — the same gate the
 * DB management RPCs enforce (app.can_manage_staff: super_admin always;
 * admin only with users=admin level). The admin role-floor rules are enforced
 * by update_staff_profile (no promotion to admin/super_admin, no admin targets
 * for non-super admins).
 *
 * All-or-nothing flow (no direct table writes from this action; all DB changes
 * go through the existing SECURITY DEFINER RPCs):
 *   1. Duplicate-email pre-check (profiles, citext).
 *   2. auth.admin.createUser via the SERVER-ONLY service client (GoTrue
 *      handles password hashing + email confirmation; the service key never
 *      reaches the browser). on_auth_user_created -> handle_new_user() creates
 *      the profiles row.
 *   3. update_staff_profile(userId, name/department/role/is_active) as the
 *      acting admin/super-admin.
 *   4. set_staff_module_access(userId, modules) -> explicit access (Add Staff
 *      always creates explicit-mode accounts; there is no role-default choice
 *      on this form).
 *   Audit: the profiles INSERT triggers staff_created; the profile update and
 *   module changes are audited by the staff audit triggers.
 *
 * If step 3 or 4 fails, step 2 is compensated with auth.admin.deleteUser
 * (cascade removes the profile) and NO password/created flag is returned. The
 * one-time initial password is returned ONLY on complete success, once, and is
 * never logged. If GoTrue SMTP were configured, an invite email could be sent
 * instead; this project's SMTP is not assumed, so we use the server-side
 * creation path and recommend a password change on first login.
 */
export async function createStaff(
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

  const parsed = createStaffSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    department: formData.get("department") || null,
    role: formData.get("role"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
    modules,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { full_name, email, department, role, is_active, modules: grants } = parsed.data;

  // 1. Duplicate email guard (profiles.email is citext -> case-insensitive).
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { message: "A staff account with this email already exists." };

  // 2. Create the auth account (server-only service client; password hashed by GoTrue).
  const service = createSupabaseServiceClient();
  const password = randomBytes(15).toString("base64url");
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createError) {
    if (/already registered|already been registered|already exists|duplicate/i.test(createError.message)) {
      return { message: "A staff account with this email already exists." };
    }
    console.error("createStaff: auth.createUser failed", { message: createError.message });
    return { message: "The account could not be created. Please try again." };
  }
  const userId = created?.user?.id;
  if (!userId) {
    console.error("createStaff: auth.createUser returned no user id");
    return { message: "The account could not be created. Please try again." };
  }

  // 3. Configure profile via the guarded RPC (actor = the creating admin/super-admin).
  const { error: profileError } = await supabase.rpc("update_staff_profile", {
    p_user_id: userId,
    p_full_name: full_name,
    p_department: department ?? null,
    p_role: role,
    p_is_active: is_active,
  });
  if (profileError) return rollbackCreatedUser(service, userId, "profile configuration");

  // 4. Apply explicit module access (always on for Add Staff).
  const { error: moduleError } = await supabase.rpc("set_staff_module_access", {
    p_user_id: userId,
    p_modules: grants as unknown as Record<string, unknown>,
  });
  if (moduleError) return rollbackCreatedUser(service, userId, "module access configuration");

  // 5. Mark the account so it must change its one-time temporary password on
  //    first login. Treated as onboarding failure like the other steps.
  const { error: flagError } = await supabase.rpc("set_must_change_password", {
    p_user_id: userId,
    p_value: true,
  });
  if (flagError) return rollbackCreatedUser(service, userId, "first-login password setup");

  revalidateStaff();
  return {
    message: "Staff account created.",
    created: true,
    userId,
    email,
    password,
  };
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
