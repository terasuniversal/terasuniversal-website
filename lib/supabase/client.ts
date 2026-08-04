"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

const supabasePublicKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/**
 * Supabase client for Client Components (browser). Uses the public anon key;
 * all access is still governed by RLS. Safe to bundle.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey()
  );
}
