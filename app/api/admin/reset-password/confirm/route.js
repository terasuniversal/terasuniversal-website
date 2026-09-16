import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

const GENERIC_CODE_ERROR = "The code is invalid or has expired. Request a new code and try again.";
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const attempts = new Map();

function getClientIp(request) {
  return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown")
    .split(",")[0]
    .trim();
}

function isSameOriginRequest(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function isRateLimited(key, now) {
  const prior = (attempts.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (prior.length >= MAX_ATTEMPTS) {
    attempts.set(key, prior);
    return true;
  }
  prior.push(now);
  attempts.set(key, prior);
  return false;
}

export async function POST(request) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Invalid password reset request." }, { status: 403 });
    }

    const { email, token, password } = await request.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanToken = String(token || "").replace(/\s/g, "");
    const ip = getClientIp(request);
    const attemptKey = `${ip}:${cleanEmail}`;

    if (!/^\S+@\S+\.\S+$/.test(cleanEmail) || !/^(?:\d{6}|\d{8})$/.test(cleanToken)) {
      return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 10) {
      return NextResponse.json({ error: "Use at least 10 characters for your new password." }, { status: 400 });
    }
    if (isRateLimited(attemptKey, Date.now())) {
      return NextResponse.json({ error: "Too many attempts. Wait 15 minutes before requesting a new code." }, { status: 429 });
    }

    const client = await createSupabaseServerClient();
    const { error: verifyError } = await client.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: "recovery",
    });
    if (verifyError) {
      console.warn("[admin:password-reset] server OTP verification failed", {
        status: verifyError.status,
        code: verifyError.code,
      });
      return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 400 });
    }

    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) {
      console.warn("[admin:password-reset] server password update failed", {
        status: updateError.status,
        code: updateError.code,
      });
      return NextResponse.json({ error: "Unable to update your password. Request a new code and try again." }, { status: 400 });
    }

    await client.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to verify the recovery code. Try again shortly." }, { status: 500 });
  }
}
