import { NextResponse } from "next/server";
import { Resend } from "resend";
import { contactEnquirySchema, fieldErrors } from "../../../lib/validation/schemas";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

const INTERNAL_RECIPIENT = "training@terasuniversal.com.my";
const MIN_FILL_TIME_MS = 2500;
const CONTROL_CHARS_PATTERN = new RegExp("[\\x00-\\x1F\\x7F]", "g");

function clean(value, maxLength) {
  return String(value == null ? "" : value).replace(CONTROL_CHARS_PATTERN, "").trim().slice(0, maxLength);
}
function getClientIp(request) {
  return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function jsonError(message, status = 400, extra) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Best-effort internal notification. Never throws -- the enquiry is already
 * persisted by the time this runs, and a notification failure must not turn
 * a successful lead capture into an error response for the visitor (see
 * CONTACT LEAD CAPTURE UPGRADE task: "Submission should NOT be lost just
 * because notification email fails").
 */
async function notifyInternal(data) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !fromEmail) {
    console.error("Contact enquiry notification skipped: Resend not configured");
    return;
  }
  try {
    const resend = new Resend(apiKey);
    const rows = [
      ["Name", data.name], ["Company", data.company || "Not provided"], ["Email", data.email],
      ["Phone", data.phone], ["Enquiry Type", data.enquiryType], ["Subject", data.subject],
      ["Source", data.sourcePage], ["Message", data.message],
    ];
    const html = `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>New TERAS UNIVERSAL website enquiry</h2><table style="border-collapse:collapse;width:100%;max-width:720px">${rows.map(([label, value]) => `<tr><th align="left" style="padding:8px 12px;background:#f4f6f8">${escapeHtml(label)}</th><td style="padding:8px 12px">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table></div>`;
    const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    const result = await resend.emails.send({ from: fromEmail, to: [INTERNAL_RECIPIENT], replyTo: data.email, subject: `New website enquiry — ${data.name}`, text, html });
    if (result.error) throw new Error(result.error.message);
  } catch (error) {
    console.error("Contact enquiry notification failed", { message: error instanceof Error ? error.message : "Unknown error" });
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  const siteOrigin = new URL(request.url).origin;
  if (origin && origin !== siteOrigin && !origin.endsWith(".vercel.app")) {
    return jsonError("Invalid request origin.", 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid request.");
  }

  // Honeypot: a hidden field real visitors never fill. Any non-empty value
  // is treated as a bot -- respond as if successful so the bot doesn't learn
  // to adapt, matching the existing request-proposal/newsletter pattern.
  if (clean(payload.website, 200)) {
    return NextResponse.json({ ok: true });
  }
  // Minimum-completion-time gate, same threshold family as request-proposal.
  if (payload.formStartedAt && Date.now() - Number(payload.formStartedAt) < MIN_FILL_TIME_MS) {
    return jsonError("Please take a moment to review the form before submitting.");
  }

  const parsed = contactEnquirySchema.safeParse({
    name: payload.name,
    company: payload.company,
    email: payload.email,
    phone: payload.phone,
    enquiryType: payload.enquiryType,
    subject: payload.subject,
    message: payload.message,
    sourcePage: payload.sourcePage,
  });
  if (!parsed.success) {
    return jsonError("Please check the highlighted fields.", 400, { errors: fieldErrors(parsed.error) });
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: enquiryId, error } = await supabase.rpc("submit_public_enquiry", {
    p_name: data.name,
    p_company: data.company || null,
    p_email: data.email,
    p_phone: data.phone,
    p_enquiry_type: data.enquiryType,
    p_subject: data.subject,
    p_message: data.message,
    p_source_page: data.sourcePage,
  });

  if (error) {
    if (error.message?.includes("rate_limited")) {
      return jsonError("You've already sent an enquiry moments ago. Please wait a minute before sending another.", 429);
    }
    // Never surface raw DB error text (table/column/constraint names) to a
    // public endpoint -- generic message only, real detail server-side.
    console.error("Contact enquiry persistence failed", { message: error.message, ip: getClientIp(request) });
    return jsonError("We could not send your enquiry right now. Please try again or contact us directly.", 502);
  }

  // Persisted successfully -- notification is best-effort from here on and
  // must not affect the success response returned to the visitor.
  await notifyInternal(data);

  return NextResponse.json({ ok: true, id: enquiryId });
}
