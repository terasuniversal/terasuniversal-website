import { createClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from "./supabase/env";
import { assertPublicSupabaseConfig } from "./preview-isolation";

export function getSupabaseClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabasePublishableKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  // Preview isolation: no anon client against the Production project from a non-Production deployment.
  assertPublicSupabaseConfig();
  return createClient(supabaseUrl, supabasePublishableKey);
}
