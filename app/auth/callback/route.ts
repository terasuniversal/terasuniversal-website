import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const DEFAULT_NEXT = "/admin/reset-password";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT;
  try {
    const parsed = new URL(value, "http://internal.local");
    if (parsed.origin !== "http://internal.local") return DEFAULT_NEXT;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createSupabaseServerClient();

  if (!code) {
    const errorUrl = new URL("/admin/login", request.url);
    errorUrl.searchParams.set("error", "recovery");
    return NextResponse.redirect(errorUrl);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const errorUrl = new URL("/admin/login", request.url);
    errorUrl.searchParams.set("error", "recovery");
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(new URL(next, request.url));
}