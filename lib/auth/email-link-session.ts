import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import { hasRecentEmailLinkAuth } from "./email-link";

/**
 * Whether the signed-in session came from an invitation/recovery link within
 * the last hour. Reads verified JWT claims (getClaims), not the raw cookie. A
 * normal password session is refused by the set-password flow and must use
 * /admin/account/change-password, which proves the current password.
 */
export async function emailLinkSessionIsRecent(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return false;
  return hasRecentEmailLinkAuth(data.claims.amr, Math.floor(Date.now() / 1000));
}
