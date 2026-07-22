"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

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
    const { data: profile } = await (supabase
      .from("profiles") as any)
      .select("is_active, role")
      .eq("id", user.id)
      .single();
    if (!profile?.is_active) {
      await supabase.auth.signOut();
      return { error: "This account has been deactivated. Contact an administrator." };
    }
    // Stamp last login + write an audit event.
    await (supabase.from("profiles") as any).update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    await supabase.rpc("log_event" as never, {
      p_action: "login",
      p_entity_type: "auth",
      p_summary: "Admin sign-in",
    } as never);
  }

  const dest =
    parsed.data.next && parsed.data.next.startsWith("/admin")
      ? parsed.data.next
      : "/admin/dashboard";
  redirect(dest);
}
