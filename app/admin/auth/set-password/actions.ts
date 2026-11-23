"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireStaff } from "../../../../lib/auth/session";
import { resolveLandingRoute } from "../../../../lib/auth/landing";
import { emailLinkSessionIsRecent } from "../../../../lib/auth/email-link-session";
import { setPasswordSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type SetPasswordState = { message?: string; errors?: Record<string, string> };

export async function setPasswordFromEmailLink(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  // Active staff only: requireStaff() redirects inactive or unknown accounts and never activates anyone.
  const profile = await requireStaff();
  if (!(await emailLinkSessionIsRecent())) {
    return { message: "Sesi pautan e-mel ini telah tamat. Minta pautan baharu melalui \"Forgot password?\" di halaman log masuk." };
  }

  const parsed = setPasswordSchema.safeParse({
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (parsed.data.new_password !== parsed.data.confirm_password) {
    return { errors: { confirm_password: "Kata laluan tidak sepadan." } };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password });
  if (error) {
    console.error("setPasswordFromEmailLink: auth.updateUser failed", { status: error.status, code: error.code });
    if (error.code === "same_password") return { errors: { new_password: "Gunakan kata laluan yang berbeza daripada kata laluan lama." } };
    if (error.code === "weak_password") return { errors: { new_password: "Kata laluan terlalu lemah. Gunakan gabungan huruf, nombor dan simbol." } };
    return { message: "Kata laluan tidak dapat dikemas kini. Cuba lagi." };
  }

  // Same self-only RPC as the change-password flow; only clears the first-login flag.
  if (profile.must_change_password) {
    const { error: clearError } = await supabase.rpc("clear_password_change_flag", { p_forced: true });
    if (clearError) {
      console.error("setPasswordFromEmailLink: clear first-login flag failed", { code: clearError.code });
      return { message: "Kata laluan telah dikemas kini, tetapi persediaan akaun belum selesai. Cuba sekali lagi." };
    }
  }

  const { data: moduleAccess } = await supabase.rpc("get_my_module_access");
  const allowed = Array.isArray(moduleAccess) ? moduleAccess.map((m: { module_key: string }) => m.module_key) : [];
  redirect(resolveLandingRoute(allowed));
}
