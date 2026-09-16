import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

// Module 38 — Security: this endpoint is intentionally public (a locked-out
// admin can't be logged in to reset their own password), so it needs its
// own abuse protection separate from the middleware auth gate. Same
// per-IP throttling pattern already used in request-proposal/newsletter.
const recentResetRequests = new Map();
function getClientIp(request) { return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim(); }

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const now = Date.now();
    if (now - (recentResetRequests.get(ip) || 0) < 60_000) {
      return NextResponse.json({ error: "Sila tunggu seminit sebelum cuba lagi." }, { status: 429 });
    }

    const { email } = await request.json();
    const cleanEmail = String(email || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return NextResponse.json({ error: "Masukkan email admin yang sah." }, { status: 400 });
    recentResetRequests.set(ip, now);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
      return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
    }
    const client = await createSupabaseServerClient();
    // When the staging recovery template contains {{ .Token }}, TERAS
    // verifies the six-digit code on the reset page instead of depending on
    // a one-time link surviving email scanners. The redirect remains
    // available for older/custom templates and other Auth flows.
    const callbackUrl = new URL("/auth/callback", request.url);
    callbackUrl.searchParams.set("next", "/admin/reset-password");
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo: callbackUrl.toString() });
    // Do not reveal whether an email account exists. This endpoint is public.
    if (error) console.error("[admin:password-reset] request failed", error.message);
    return NextResponse.json({ ok: true, message: "If this email belongs to an admin account, a reset code has been sent." });
  } catch (error) {
    return NextResponse.json({ error: "Unable to request a password reset." }, { status: 500 });
  }
}
