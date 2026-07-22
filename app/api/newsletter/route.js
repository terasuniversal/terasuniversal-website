import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const recentSubscriptions = new Map();

function clean(value, maxLength) { return String(value == null ? "" : value).replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, maxLength); }
function getClientIp(request) { return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim(); }
function responseError(message, status = 400) { return NextResponse.json({ error: message }, { status }); }

/**
 * Newsletter subscription endpoint (Module 27).
 *
 * Reuses the existing Resend account (same RESEND_API_KEY already used for
 * Request Proposal / Contact emails) via Resend's Audience/Contacts API, so
 * no new email service or vendor is introduced.
 *
 * Requires ONE additional environment variable that does not exist yet:
 *   RESEND_AUDIENCE_ID
 * Create an Audience in the Resend dashboard (Audiences tab) and set its ID
 * here. Until that variable is set, this endpoint responds with a clear
 * "not configured" error instead of failing silently — the same pattern
 * already used in app/api/request-proposal/route.js for its own env vars.
 */
export async function POST(request) {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim();
  const origin = request.headers.get("origin");
  const siteOrigin = new URL(request.url).origin;
  if (!apiKey) return responseError("Newsletter service is not configured: RESEND_API_KEY is missing.", 503);
  if (!audienceId) return responseError("Newsletter service is not configured: RESEND_AUDIENCE_ID is missing.", 503);
  if (origin && origin !== siteOrigin && !origin.endsWith(".vercel.app")) return responseError("Invalid request origin.", 403);

  const ip = getClientIp(request);
  const now = Date.now();
  if (now - (recentSubscriptions.get(ip) || 0) < 30_000) return responseError("Please wait a moment before trying again.", 429);

  let payload;
  try { payload = await request.json(); } catch { return responseError("Invalid request."); }

  if (clean(payload.website, 200)) return NextResponse.json({ ok: true });
  if (payload.formStartedAt && now - Number(payload.formStartedAt) < 1500) return responseError("Please take a moment before submitting.");

  const email = clean(payload.email, 254);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responseError("Please provide a valid email address.");
  if (payload.consent !== true && payload.consent !== "on") return responseError("Please confirm the consent statement.");

  const resend = new Resend(apiKey);

  try {
    const result = await resend.contacts.create({ email, unsubscribed: false, audienceId });
    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      const alreadySubscribed = message.includes("already") || message.includes("exist");
      if (!alreadySubscribed) throw new Error(result.error.message || "Resend rejected the subscription.");
    }
    recentSubscriptions.set(ip, now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Newsletter subscription failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return responseError("We could not process your subscription right now. Please try again later.", 502);
  }
}
