import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";
import { isEbookCaptureEnabled } from "./lib/marketing/ebookFlag";

/**
 * Root middleware. Runs on /admin routes (session refresh and authentication) and, only to give a genuine HTTP 404,
 * on /ebook and /privacy while EBOOK_LEAD_CAPTURE_ENABLED is off. Those two pages cannot return a real 404 status from
 * inside the page, because the root loading boundary has already started streaming (HTTP 200) when notFound() runs.
 * The rest of the public site is never touched.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/ebook" || pathname === "/privacy") {
    if (isEbookCaptureEnabled()) return NextResponse.next();
    // Rewrite to a path that has no route: the site's own not-found page, with status 404 and no eBook content.
    const url = request.nextUrl.clone();
    url.pathname = "/_feature-off";
    url.search = "";
    return NextResponse.rewrite(url, { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // The admin area, plus the two feature-flagged public pages (see above). The rest of the public site is excluded.
    "/admin/:path*",
    "/ebook",
    "/privacy",
  ],
};
