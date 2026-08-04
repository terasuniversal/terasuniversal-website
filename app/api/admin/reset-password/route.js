import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${new URL(request.url).origin}/admin/reset-password` });
    // Do not reveal whether an email account exists. This endpoint is public.
    if (error) console.error("[admin:password-reset] request failed", error.message);
    return NextResponse.json({ ok: true, message: "If this email belongs to an admin account, a reset link has been sent." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset kata laluan tidak berjaya." }, { status: 500 });
  }
}
