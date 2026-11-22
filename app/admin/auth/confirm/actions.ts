"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { checkSharedRateLimit, hashedClientId } from "../../../../lib/rate-limit";
import { headers } from "next/headers";
import {
  CONFIRM_PATH,
  SET_PASSWORD_PATH,
  classifySessionError,
  hasRecentEmailLinkAuth,
  legacyTokensWellFormed,
  mapVerifyOtpError,
  parseEmailLinkParams,
  type ConfirmErrorCode,
} from "../../../../lib/auth/email-link";

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

export type LegacySessionResult = { ok: true; next: typeof SET_PASSWORD_PATH } | { ok: false; error: ConfirmErrorCode };

/**
 * Establishes the session from a legacy email link (session tokens in the URL
 * hash, GoTrue's default template), on the server.
 *
 * AUTH-1 Gate B: the browser-side setSession failed without ever reaching
 * Supabase, and every failure was shown as "expired or used". Here the tokens
 * are posted same-origin, set with the SSR server client (so the session
 * cookies come back on this response, exactly like the token_hash path), and
 * each failure is classified and logged by name/status/code only.
 *
 * Public by design, like confirmEmailLink: the tokens are the credential and
 * GoTrue verifies them. Only a recent invite/recovery session is accepted, so
 * this cannot be used to plant an ordinary password session.
 */
export async function establishLegacySession(formData: FormData): Promise<LegacySessionResult> {
  const accessToken = formData.get("access_token");
  const refreshToken = formData.get("refresh_token");
  if (!legacyTokensWellFormed(accessToken, refreshToken)) return { ok: false, error: "malformed_link" };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await checkSharedRateLimit({ key: `auth-legacy-session:${hashedClientId(ip)}`, windowSeconds: 60, maxAttempts: 10, failClosed: true });
  if (!allowed) return { ok: false, error: "rate_limited" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken as string, refresh_token: refreshToken as string });
    if (error || !data?.user) {
      console.error("establishLegacySession: setSession failed", { name: error?.name, status: error?.status, code: error?.code });
      return { ok: false, error: classifySessionError(error) };
    }

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !hasRecentEmailLinkAuth(claimsData?.claims?.amr, Math.floor(Date.now() / 1000))) {
      console.error("establishLegacySession: not a recent email-link session", { name: claimsError?.name, status: claimsError?.status });
      await supabase.auth.signOut();
      return { ok: false, error: "session_failed" };
    }

    // An inactive account stays inactive: a valid link must not let it in.
    const { data: profile, error: profileError } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
    if (profileError || !profile?.is_active) {
      if (profileError) console.error("establishLegacySession: profile lookup failed", { code: profileError.code });
      await supabase.auth.signOut();
      return { ok: false, error: profileError ? "unavailable" : "account_inactive" };
    }

    return { ok: true, next: SET_PASSWORD_PATH };
  } catch (error) {
    const e = error as { name?: string; status?: number; code?: string };
    console.error("establishLegacySession: unexpected failure", { name: e?.name, status: e?.status, code: e?.code });
    return { ok: false, error: e?.name === "AuthRetryableFetchError" ? "network_failed" : "unavailable" };
  }
}
