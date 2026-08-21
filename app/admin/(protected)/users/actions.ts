"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import { MODULE_CATALOG, STAFF_ROLES } from "../../../../lib/auth/rbac";
import type { UserRole } from "../../../../lib/supabase/database.types";

// Matches the live public.staff_department enum exactly (verified against
// project iagzkrzeuawaxvacqprk before writing this reconciliation) -- the
// dropdown label reads "Training Operations" but the stored/DB value is
// training_operations, not training.
const departmentValues = ["sales", "marketing", "training_operations", "finance", "administration", "management", "hr"] as const;
const editableRoles = ["super_admin", "admin", "editor", "trainer"] as const;
const moduleKeys = new Set(MODULE_CATALOG.map((module) => module.key));

export type StaffActionState = { error?: string };

// Postgres's uuid type accepts any 8-4-4-4-12 hex string -- it does not
// require RFC 4122 version/variant bits. Zod v4's built-in .uuid() does
// enforce those bits and rejects this repo's synthetic staging test ids
// (scripts/database/staff-rbac-staging-check.mjs, e.g.
// 00000000-0000-0000-0000-0000000000a3), which are otherwise valid rows.
// Real Supabase-generated UUIDs (production and staging alike) satisfy both
// checks, so this only widens acceptance for the shape Postgres itself uses.
const staffUserId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid staff id.");

const staffSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  department: z.enum(departmentValues),
  role: z.enum(["admin", "editor", "trainer"]),
  status: z.enum(["active", "inactive"]).default("active"),
});

const editStaffSchema = staffSchema.extend({
  user_id: staffUserId,
  role: z.enum(editableRoles),
});

function getModuleKeys(formData: FormData) {
  const requested = formData.getAll("module_key").filter((value): value is string => typeof value === "string");
  const unique = [...new Set(requested)];
  return unique.length === requested.length && unique.every((key) => moduleKeys.has(key)) ? unique : null;
}

/** Service-role client is used ONLY for GoTrue admin operations (invite/delete
 * a user) that have no RLS-respecting equivalent -- never for routine
 * profiles/staff_module_access writes, which go through the guarded RPCs
 * below via the normal authenticated server client. */
function serviceClientOrError() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "Staff invitations are not configured: SUPABASE_SERVICE_ROLE_KEY is missing." } as const;
  }
  return { client: createSupabaseServiceClient() } as const;
}

function invitationRedirectUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) return null;
  return `${siteUrl}/admin/reset-password`;
}

function requestedModulesOrError(formData: FormData) {
  const modules = getModuleKeys(formData);
  if (!modules) return { error: "One or more module selections are invalid." } as const;
  return { modules } as const;
}

/** Map known RPC guard errors to safe, user-facing messages -- mirrors the
 * exception codes raised by update_staff_profile / set_staff_module_access
 * (20260817000000_staff_user_management_phase1.sql). Never expose raw DB
 * error text to the client. */
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

/**
 * Invite a new staff account. Authorization: requireModuleAccess("users",
 * "admin") -- enforced via the has_module_access_level DB RPC, the same
 * source of truth app.can_manage_staff() uses (super_admin always; admin
 * only with an explicit users=admin grant, or the role-default fallback to
 * staff_module_catalog's min_role for "users", which is "admin").
 *
 * Only the Auth admin operations (inviteUserByEmail / compensating
 * deleteUser) use the service-role client. Profile and module-access writes
 * go through the guarded SECURITY DEFINER RPCs via the normal authenticated
 * server client, so app.can_manage_staff() and the admin role-floor rules
 * are enforced at the DB layer, not just in this action.
 *
 * All-or-nothing: if profile or module-access provisioning fails after the
 * auth user was created, the auth user is deleted (cascades to the
 * auto-created profile row) -- the same compensating-rollback shape already
 * used elsewhere in this module for staff creation.
 *
 * No manual audit call: the profiles row auto-created by the on_auth_user_created
 * -> handle_new_user() trigger already produces a staff_created audit event;
 * the subsequent update_staff_profile()/set_staff_module_access() calls each
 * fire the existing trg_profiles_staff_audit / trg_staff_module_access_audit
 * triggers automatically, with the real authenticated actor (not service-role,
 * not null). That's a complete, exactly-once audit trail with no separate
 * "staff_invited" event needed -- public.audit_action has no such value on
 * live production (verified before writing this), and adding one is not
 * required for a correct audit trail here.
 */
export async function inviteStaffAction(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  await requireModuleAccess("users", "admin");
  const parsed = staffSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    department: formData.get("department"),
    role: formData.get("role"),
    status: formData.get("status") || "active",
  });
  const requested = requestedModulesOrError(formData);
  if (!parsed.success) return { error: "Enter a valid name, email, department, role and status." };
  if ("error" in requested) return requested;
  if (!STAFF_ROLES.includes(parsed.data.role as UserRole)) return { error: "That role is not permitted for staff invitations." };

  const redirectTo = invitationRedirectUrl();
  if (!redirectTo) return { error: "Staff invitations are not configured: NEXT_PUBLIC_SITE_URL is missing." };
  const service = serviceClientOrError();
  if (!("client" in service)) return { error: service.error };
  const email = parsed.data.email.toLowerCase();

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingError) {
    console.error("inviteStaffAction: duplicate-email check failed", { message: existingError.message });
    return { error: "The invitation could not be sent. Please try again." };
  }
  if (existing) return { error: "An account already exists for this email. Use View/Edit or the staff member's password reset flow." };

  const { data: invitation, error: invitationError } = await service.client.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: parsed.data.full_name },
  });
  if (invitationError || !invitation.user) {
    console.error("inviteStaffAction: inviteUserByEmail failed", { message: invitationError?.message });
    return { error: "The invitation could not be sent." };
  }
  const userId = invitation.user.id;

  const { error: profileError } = await supabase.rpc("update_staff_profile", {
    p_user_id: userId,
    p_full_name: parsed.data.full_name,
    p_department: parsed.data.department,
    p_role: parsed.data.role,
    p_is_active: parsed.data.status === "active",
  });
  if (profileError) {
    console.error("inviteStaffAction: update_staff_profile failed", { message: profileError.message, userId });
    await service.client.auth.admin.deleteUser(userId);
    return { error: "The invitation was rolled back because the staff profile could not be configured." };
  }

  const { error: accessError } = await supabase.rpc("set_staff_module_access", {
    p_user_id: userId,
    p_modules: requested.modules.map((module_key) => ({ module_key, access_level: "view" })),
  });
  if (accessError) {
    console.error("inviteStaffAction: set_staff_module_access failed", { message: accessError.message, userId });
    await service.client.auth.admin.deleteUser(userId);
    return { error: "The invitation was rolled back because module access could not be saved." };
  }

  redirect(`/admin/users?invited=1`);
}

/**
 * Edit an existing staff profile + explicit module access from the combined
 * Staff User Form. Authorization: requireModuleAccess("users", "admin"),
 * matching inviteStaffAction and app.can_manage_staff().
 *
 * Writes go through update_staff_profile() then, unless the target role is
 * super_admin (the form shows no module checkboxes for super_admin -- they
 * are unrestricted by role and don't need explicit grants), set_staff_module_access().
 * These remain two separate RPC calls / two separate DB transactions -- see
 * the atomicity note below; no combined transactional RPC is introduced here.
 *
 * access_control_enabled is never set directly by this action. It is left
 * exactly as update_staff_profile's own (unmodified, 5-argument) behavior
 * already leaves it: untouched. It only changes as an existing, already-shipped
 * side effect of set_staff_module_access (which sets it true when explicit
 * module access is actually being configured) -- not from any role-derived
 * logic added here.
 *
 * Last-active-super-admin protection and the admin role-floor rules are
 * enforced by the DB (app.protect_last_super_admin() trigger + update_staff_profile's
 * own checks) -- no hand-coded duplicate of that check is kept here, since
 * mapRpcError() already turns the DB's own rejection into an equally clear
 * message with no UX loss. The "cannot grant super_admin here" guard IS kept:
 * update_staff_profile only blocks promotion to admin/super_admin for
 * non-super-admin actors, so a super_admin actor isn't stopped by the DB from
 * promoting a target to super_admin -- this app-layer check is an additional
 * safeguard, not a duplicate of an existing DB rule, so keeping it doesn't
 * create drift.
 *
 * Audit: no manual audit call. Both RPC calls fire the existing DB triggers
 * automatically, with the real authenticated actor.
 *
 * Module access is only ever submitted as a set of keys (StaffUserForm has
 * no access-level control), so set_staff_module_access -- which fully
 * replaces the target's staff_module_access rows on every call -- must never
 * be called with a manufactured level. Before writing, this reads the
 * target's CURRENT levels and reuses them for every retained key, defaulting
 * only genuinely new keys to "view"; and it skips the RPC call entirely when
 * the submitted key set is unchanged, so a profile-only edit (department,
 * name, status) never touches staff_module_access or its audit trail. A
 * production incident on 2026-08-21 confirmed the prior always-"view"
 * payload silently downgraded existing edit/admin grants on every save.
 */
export async function updateStaffAction(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  await requireModuleAccess("users", "admin");
  const parsed = editStaffSchema.safeParse({
    user_id: formData.get("user_id"),
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    department: formData.get("department"),
    role: formData.get("role"),
    status: formData.get("status") || "active",
  });
  const requested = requestedModulesOrError(formData);
  if (!parsed.success) return { error: "Enter valid staff details." };
  if ("error" in requested) return requested;

  const supabase = await createSupabaseServerClient();
  const [{ data: current, error: currentError }, { data: currentAccess, error: currentAccessError }] = await Promise.all([
    supabase.from("profiles").select("id,role").eq("id", parsed.data.user_id).maybeSingle(),
    supabase.from("staff_module_access").select("module_key,access_level").eq("user_id", parsed.data.user_id),
  ]);
  if (currentError) {
    console.error("updateStaffAction: profile lookup failed", { message: currentError.message, userId: parsed.data.user_id });
    return { error: "Staff profile could not be updated. Please try again." };
  }
  if (currentAccessError) {
    console.error("updateStaffAction: module access lookup failed", { message: currentAccessError.message, userId: parsed.data.user_id });
    return { error: "Staff profile could not be updated. Please try again." };
  }
  if (!current) return { error: "Staff profile not found." };
  if (current.role !== "super_admin" && parsed.data.role === "super_admin") {
    return { error: "Only an existing Super Admin may retain that role; it cannot be granted from Staff Users." };
  }

  const { error: profileError } = await supabase.rpc("update_staff_profile", {
    p_user_id: parsed.data.user_id,
    p_full_name: parsed.data.full_name,
    p_department: parsed.data.department,
    p_role: parsed.data.role,
    p_is_active: parsed.data.status === "active",
  });
  if (profileError) {
    console.error("updateStaffAction: update_staff_profile failed", { message: profileError.message, userId: parsed.data.user_id });
    return { error: mapRpcError(profileError.message) };
  }

  const currentLevelByKey = new Map(
    (currentAccess ?? []).map((row: { module_key: string; access_level: string }) => [row.module_key, row.access_level]),
  );
  const moduleSelectionChanged =
    currentLevelByKey.size !== requested.modules.length || requested.modules.some((key) => !currentLevelByKey.has(key));

  if (parsed.data.role !== "super_admin" && moduleSelectionChanged) {
    const { error: accessError } = await supabase.rpc("set_staff_module_access", {
      p_user_id: parsed.data.user_id,
      p_modules: requested.modules.map((module_key) => ({
        module_key,
        access_level: currentLevelByKey.get(module_key) ?? "view",
      })),
    });
    if (accessError) {
      console.error("updateStaffAction: set_staff_module_access failed", { message: accessError.message, userId: parsed.data.user_id });
      // Profile fields above were already saved and are NOT rolled back here.
      // The current architecture already treats profile and module-access
      // edits as independently-completable steps (the prior, still-committed
      // [id]/StaffUserForm.tsx submits them as two separate forms/buttons) --
      // a partial-completion state between the two is the existing accepted
      // behavior, not a new risk introduced by combining them into one submit.
      return { error: `Staff profile was updated, but module access could not be saved: ${mapRpcError(accessError.message)}` };
    }
  }

  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

/**
 * Resend a pending staff invitation. Authorization matches the other Staff
 * actions. Only the GoTrue admin resend call is performed -- no profile or
 * module-access data is touched. No manual audit call: a resend has no
 * profiles/staff_module_access write to trigger an audit row from, and
 * "staff_invited" is not a valid public.audit_action value on live
 * production, so no audit row is written for a resend. If a dedicated
 * invitation/resend audit event becomes a real product requirement, that
 * needs an additive enum migration first -- not introduced in this
 * reconciliation.
 */
export async function resendStaffInviteAction(formData: FormData): Promise<void> {
  await requireModuleAccess("users", "admin");
  const userId = staffUserId.safeParse(formData.get("user_id"));
  if (!userId.success) redirect("/admin/users?error=invalid-staff-account");
  const redirectTo = invitationRedirectUrl();
  if (!redirectTo) redirect("/admin/users?error=invite-not-configured");
  const service = serviceClientOrError();
  if (!("client" in service)) redirect("/admin/users?error=invite-not-configured");

  const supabase = await createSupabaseServerClient();
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id,email").eq("id", userId.data).maybeSingle();
  if (profileError) {
    console.error("resendStaffInviteAction: profile lookup failed", { message: profileError.message, userId: userId.data });
    redirect("/admin/users?error=staff-not-found");
  }
  if (!profile) redirect("/admin/users?error=staff-not-found");

  const { error } = await service.client.auth.admin.inviteUserByEmail(profile.email, { redirectTo });
  if (error) {
    console.error("resendStaffInviteAction: inviteUserByEmail failed", { message: error.message, userId: profile.id });
    redirect(`/admin/users/${profile.id}?error=invite-not-resent`);
  }
  redirect(`/admin/users/${profile.id}?resent=1`);
}
