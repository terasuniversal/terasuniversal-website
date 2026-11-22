"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { checkSharedRateLimit, hashedClientId } from "../../../../lib/rate-limit";
import { headers } from "next/headers";
import { CONFIRM_PATH, SET_PASSWORD_PATH, mapVerifyOtpError, parseEmailLinkParams } from "../../../../lib/auth/email-link";

function fail(code: string): never {
  // Never carries the token back into the URL.
  redirect(`${CONFIRM_PATH}?error=${code}`);
}

/**
 * Spends an invitation/recovery token_hash. Runs only on an explicit button
 * press (POST), never on the GET that opens the page, so a mail scanner that
 * prefetches the link cannot consume it. Public by design: the token itself
 * is the credential, verified by GoTrue.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const parsed = parseEmailLinkParams(formData.get("token_hash"), formData.get("type"));
  if (!parsed.ok) fail("link_invalid");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await checkSharedRateLimit({ key: `auth-confirm:${hashedClientId(ip)}`, windowSeconds: 60, maxAttempts: 10, failClosed: true });
  if (!allowed) fail("rate_limited");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: parsed.type, token_hash: parsed.tokenHash });
  if (error || !data?.user) {
    console.error("confirmEmailLink: verifyOtp failed", { type: parsed.type, status: error?.status, code: error?.code });
    fail(mapVerifyOtpError(error));
  }

  // An inactive account stays inactive: a valid link must not let it in.
  const { data: profile, error: profileError } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile?.is_active) {
    if (profileError) console.error("confirmEmailLink: profile lookup failed", { code: profileError.code });
    await supabase.auth.signOut();
    fail(profileError ? "unavailable" : "account_inactive");
  }

  redirect(SET_PASSWORD_PATH);
}
