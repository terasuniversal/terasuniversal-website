"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (browser). Uses the public anon key;
 * all access is still governed by RLS. Safe to bundle.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
