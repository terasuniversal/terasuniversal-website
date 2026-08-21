import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

const supabasePublicKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/**
 * Supabase client for React Server Components, Server Actions and Route
 * Handlers. Reads/writes the auth session from Next.js cookies so RLS runs
 * as the logged-in staff member. Never use the service-role key here.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabasePublicKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    }
  );

  // Operational migrations are intentionally shipped with this repository,
  // while the checked-in generated type snapshot is behind them. Keep the
  // fallback at this boundary (not scattered through every route) until the
  // connected Supabase schema is regenerated in CI.
  return client as any;
}

/**
 * Service-role client — BYPASSES RLS. Use ONLY in trusted server code that
 * must act without a user session (e.g. persisting a public form submission
 * server-side). Never import this into a Client Component.
 */
export function createSupabaseServiceClient() {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return client as any;
}
