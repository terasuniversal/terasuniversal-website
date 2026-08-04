import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

const supabasePublicKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/**
 * Refreshes the Supabase auth session on every request and guards the
 * /admin area. Called from the root middleware.ts.
 *
 * Rules:
 *   - Unauthenticated user hitting /admin/**  → redirect to /admin/login
 *   - Authenticated user hitting /admin/login → redirect to /admin/dashboard
 *   - Everything else passes through untouched (public site unaffected).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const isAdminArea = pathname.startsWith("/admin");
  const isLogin = pathname === "/admin/login";
  const isPasswordRecovery = pathname === "/admin/reset-password";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = supabasePublicKey();

  // A preview without its Supabase variables should remain viewable instead of
  // failing inside middleware. Protected routes continue to resolve to login.
  if (!supabaseUrl || !publicKey) {
    if (isAdminArea && !isLogin && !isPasswordRecovery) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient<Database>(
    supabaseUrl,
    publicKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run any code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The password-recovery link carries its short-lived session in the URL;
  // allow that public entry page to load so the browser client can consume it.
  if (isAdminArea && !isLogin && !isPasswordRecovery && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isLogin && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
