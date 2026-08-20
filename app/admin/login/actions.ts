"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

const GENERIC_LOGIN_ERROR = "Something went wrong signing you in. Please try again.";

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: "Invalid credentials, or this account is not permitted." };

  // Confirm the account is active before letting them in.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_active, role, must_change_password")
      .eq("id", user.id)
      .single();
    if (profileError) {
      // A query/connection failure here must never be read as "deactivated"
      // or "no profile" — those are business states, not system failures.
      console.error("loginAction: profile lookup failed", { message: profileError.message, code: profileError.code, userId: user.id });
      return { error: GENERIC_LOGIN_ERROR };
    }
    if (!profile?.is_active) {
      await supabase.auth.signOut();
      return { error: "This account has been deactivated. Contact an administrator." };
    }
    // Stamp last login + write an audit event. Informational only — a
    // failure here must not block an otherwise-successful login.
    const { error: lastLoginError } = await supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);
    if (lastLoginError) {
      console.error("loginAction: failed to stamp last_login_at", { message: lastLoginError.message, userId: user.id });
    }
    // `authenticated` has no EXECUTE grant on log_event (revoked in
    // 20260815120000_security_remediation_pack1.sql) -- server-side audit
    // writes must go through the service-role client calling
    // log_event_as_service, which takes the actor explicitly since there's
    // no auth.uid() session context on that client.
    const service = createSupabaseServiceClient();
    const { error: auditError } = await service.rpc("log_event_as_service" as never, {
      p_actor_id: user.id,
      p_actor_email: user.email ?? parsed.data.email,
      p_action: "login",
      p_entity_type: "auth",
      p_summary: "Admin sign-in",
    } as never);
    if (auditError) {
      console.error("loginAction: failed to write login audit event", { message: auditError.message, userId: user.id });
    }

    // First-login password change takes priority over every other landing
    // decision. The (protected) layout enforces the same gate on all other
    // admin routes, so a new staff member cannot reach their modules until
    // the temporary password is changed.
    if (profile.must_change_password) redirect("/admin/account/change-password");

    // Trainers land in their workspace (Attendance); others on the dashboard.
    if (profile?.role === "trainer") redirect("/admin/attendance");

    // Explicit-access staff without the Dashboard module must not land on the
    // training-operations dashboard. Send them to a module they actually have
    // (Sales staff -> Sales Dashboard). Legacy (role-default) staff keep the
    // existing dashboard landing because they pass the role-based fallback.
    // A failed lookup degrades to the same "no override" fallback as an
    // empty result — actual module authorization is enforced per-page by
    // requireRole()/requireModuleAccess(), not by this landing-route choice,
    // so this fallback cannot grant access the user doesn't already have.
    const { data: moduleAccess, error: moduleAccessError } = await supabase.rpc("get_my_module_access");
    if (moduleAccessError) {
      console.error("loginAction: get_my_module_access failed", { message: moduleAccessError.message, userId: user.id });
    }
    const allowed = Array.isArray(moduleAccess)
      ? moduleAccess.map((m: { module_key: string }) => m.module_key)
      : [];
    if (allowed.length > 0 && !allowed.includes("dashboard")) {
      const landing =
        allowed.includes("sales") ? "/admin/sales"
        : allowed.includes("sales_leads") ? "/admin/sales/leads"
        : allowed.includes("reports") ? "/admin/reports"
        : allowed.includes("news") ? "/admin/news"
        : "/admin/no-access";
      redirect(landing);
    }
  }

  const dest =
    parsed.data.next && parsed.data.next.startsWith("/admin")
      ? parsed.data.next
      : "/admin/dashboard";
  redirect(dest);
}
