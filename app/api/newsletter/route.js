import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const INTERNAL_RECIPIENT = "training@terasuniversal.com.my";
const MAX_LENGTHS = { email: 254, name: 120 };
const recentRequests = new Map();

function stripControlChars(value) {
  let output = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code > 31 && code !== 127) output += ch;
  }
  return output;
}
function clean(value, maxLength) { return stripControlChars(String(value ?? "")).trim().slice(0, maxLength); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
function getClientIp(request) { return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim(); }
function responseError(message, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const origin = request.headers.get("origin");
  const siteOrigin = new URL(request.url).origin;
  if (!apiKey) return responseError("Email service is not configured: RESEND_API_KEY is missing.", 503);
  if (!fromEmail) return responseError("Email service is not configured: RESEND_FROM_EMAIL is missing.", 503);
  if (origin && origin !== siteOrigin && !origin.endsWith(".vercel.app")) return responseError("Invalid request origin.", 403);

  const ip = getClientIp(request);
  const now = Date.now();
  if (now - (recentRequests.get(ip) || 0) < 60_000) return responseError("Please wait a minute before trying again.", 429);

  let payload;
  try { payload = await request.json(); } catch { return responseError("Invalid request."); }
  if (clean(payload.website, 200)) return NextResponse.json({ ok: true });
  if (payload.formStartedAt && now - Number(payload.formStartedAt) < 2000) return responseError("Please take a moment before submitting.");

  const email = clean(payload.email, MAX_LENGTHS.email);
  const name = clean(payload.name, MAX_LENGTHS.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responseError("Please provide a valid email address.");
  if (payload.consent !== true && payload.consent !== "on") return responseError("Please confirm the privacy notice.");

  const resend = new Resend(apiKey);
  try {
    const internal = await resend.emails.send({
      from: fromEmail,
      to: [INTERNAL_RECIPIENT],
      replyTo: email,
      subject: "New newsletter signup request",
      text: `Name: ${name || "Not provided"}\nEmail: ${email}\nSubmitted: ${new Date().toISOString()}`,
      html: `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>New newsletter signup request</h2><p><strong>Name:</strong> ${escapeHtml(name || "Not provided")}<br><strong>Email:</strong> ${escapeHtml(email)}</p></div>`,
    });
    if (internal.error) throw new Error("Internal email failed: " + internal.error.message);

    const confirmation = await resend.emails.send({
      from: fromEmail,
      to: [email],
      replyTo: INTERNAL_RECIPIENT,
      subject: "Thanks for your interest in TERAS UNIVERSAL updates",
      text: `Dear ${name || "there"}\n\nThank you for your interest in TERAS UNIVERSAL safety training and industry updates. Your request has been received and our team will confirm your subscription shortly.\n\nBuilding Competence. Creating Opportunities.`,
      html: `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>Thank you for your interest</h2><p>Dear ${escapeHtml(name || "there")},</p><p>Thank you for your interest in TERAS UNIVERSAL safety training and industry updates. Your request has been received and our team will confirm your subscription shortly.</p><p>Building Competence. Creating Opportunities.</p></div>`,
    });
    if (confirmation.error) throw new Error("Confirmation email failed: " + confirmation.error.message);

    recentRequests.set(ip, now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Newsletter signup failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return responseError("We could not process your request right now. Please try again or contact us directly.", 502);
  }
}
