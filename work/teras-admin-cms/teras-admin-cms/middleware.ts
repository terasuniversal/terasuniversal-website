import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

/**
 * Root middleware. Only runs on /admin routes (see matcher) so the public
 * website is never touched. Refreshes the Supabase session cookie and
 * enforces authentication on the admin area.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on the admin area only. The public site is completely excluded.
    "/admin/:path*",
  ],
};
