import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const INTERNAL_RECIPIENT = "admin@terasuniversal.com.my";
const MAX_LENGTHS = { fullName: 120, email: 254, phone: 40, position: 160, resumeLink: 300, message: 3000 };
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
  if (now - (recentRequests.get(ip) || 0) < 60_000) return responseError("Please wait a minute before sending another request.", 429);

  let payload;
  try { payload = await request.json(); } catch { return responseError("Invalid request."); }
  if (clean(payload.website, 200)) return NextResponse.json({ ok: true });
  if (payload.formStartedAt && now - Number(payload.formStartedAt) < 2500) return responseError("Please take a moment to review the form before submitting.");

  const data = Object.fromEntries(Object.entries(MAX_LENGTHS).map(([key, max]) => [key, clean(payload[key], max)]));
  const required = ["fullName", "email", "phone", "position"];
  if (required.some((key) => !data[key])) return responseError("Please complete all required fields.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return responseError("Please provide a valid email address.");
  if (payload.consent !== true && payload.consent !== "on") return responseError("Please confirm the consent statement.");

  const requestedAt = new Date().toISOString();
  const rows = [["Full Name", data.fullName], ["Email", data.email], ["Phone", data.phone], ["Position of Interest", data.position], ["Resume / Portfolio Link", data.resumeLink], ["Message", data.message], ["Submitted", requestedAt]];
  const text = rows.map(([label, value]) => `${label}: ${value || "Not provided"}`).join("\n");
  const htmlRows = rows.map(([label, value]) => `<tr><th align="left" style="padding:8px 12px;background:#f4f6f8">${escapeHtml(label)}</th><td style="padding:8px 12px">${escapeHtml(value || "Not provided").replace(/\n/g, "<br>")}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>New careers application</h2><table style="border-collapse:collapse;width:100%;max-width:720px">${htmlRows}</table></div>`;
  const resend = new Resend(apiKey);

  try {
    const internal = await resend.emails.send({ from: fromEmail, to: [INTERNAL_RECIPIENT], replyTo: data.email, subject: "New careers application - " + data.position, text, html });
    if (internal.error) throw new Error("Internal email failed: " + internal.error.message);

    const confirmation = await resend.emails.send({
      from: fromEmail,
      to: [data.email],
      replyTo: INTERNAL_RECIPIENT,
      subject: "We received your TERAS UNIVERSAL application",
      text: `Dear ${data.fullName}\n\nThank you for your interest in joining TERAS UNIVERSAL. We have received your application for ${data.position} and our team will review it.\n\nBuilding Competence. Creating Opportunities.`,
      html: `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>Thank you for your application</h2><p>Dear ${escapeHtml(data.fullName)},</p><p>We have received your application for <strong>${escapeHtml(data.position)}</strong>. Our team will review it and contact you if your profile matches a current or future opportunity.</p><p>Building Competence. Creating Opportunities.</p></div>`,
    });
    if (confirmation.error) throw new Error("Confirmation email failed: " + confirmation.error.message);

    recentRequests.set(ip, now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Careers application failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return responseError("We could not send your application right now. Please try again or contact us directly.", 502);
  }
}
