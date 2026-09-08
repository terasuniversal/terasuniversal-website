"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

/**
 * Supabase client for Client Components (browser). Uses the public anon key;
 * all access is still governed by RLS. Safe to bundle.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey()
  );
}
