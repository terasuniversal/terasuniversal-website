import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const INTERNAL_RECIPIENT = "training@terasuniversal.com.my";
const GOOGLE_SHEETS_TIMEOUT_MS = 10_000;
const MAX_LENGTHS = { companyName: 160, contactPerson: 120, jobTitle: 120, email: 254, phone: 40, industry: 80, category: 80, programme: 160, participants: 8, location: 160, month: 7, budget: 80, objectives: 3000, notes: 3000 };
const ALLOWED_INDUSTRIES = ["Oil & Gas", "Petrochemical", "Construction", "Manufacturing", "Marine & Offshore", "Power & Utilities", "Government & GLC", "Others"];
const ALLOWED_CATEGORIES = ["Industrial Safety", "Technical Competency", "Industrial Consultancy", "Workforce Development"];
const recentRequests = new Map();

function clean(value, maxLength) { return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
function getClientIp(request) { return (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim(); }
function responseError(message, status = 400) { return NextResponse.json({ error: message }, { status }); }

async function saveLeadToGoogleSheets(data, submitted) {
  const webAppUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL?.trim();
  if (!webAppUrl) throw new Error("Google Sheets CRM is not configured: GOOGLE_SHEETS_WEB_APP_URL is missing.");

  let parsedUrl;
  try { parsedUrl = new URL(webAppUrl); } catch { throw new Error("Google Sheets CRM is not configured: GOOGLE_SHEETS_WEB_APP_URL is invalid."); }
  if (parsedUrl.protocol !== "https:") throw new Error("Google Sheets CRM is not configured: GOOGLE_SHEETS_WEB_APP_URL must use HTTPS.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_SHEETS_TIMEOUT_MS);
  const lead = {
    submitted, status: "New", company: data.companyName, contactPerson: data.contactPerson,
    jobTitle: data.jobTitle, businessEmail: data.email, phone: data.phone, industry: data.industry,
    trainingCategory: data.category, specificProgramme: data.programme, participants: data.participants,
    trainingLocation: data.location, preferredMonth: data.month, budget: data.budget,
    trainingObjectives: data.objectives, additionalNotes: data.notes,
  };

  try {
    const response = await fetch(webAppUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead), signal: controller.signal, redirect: "follow", cache: "no-store" });
    const responseText = await response.text();
    let result;
    try { result = JSON.parse(responseText); } catch { throw new Error(`Google Sheets CRM returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok || result?.success !== true) {
      const reason = typeof result?.error === "string" ? result.error : `HTTP ${response.status}`;
      throw new Error(`Google Sheets CRM rejected the lead: ${reason}`);
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Google Sheets CRM did not respond within 10 seconds.");
    throw error;
  } finally { clearTimeout(timeout); }
}

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
  const required = ["companyName", "contactPerson", "email", "phone", "industry", "category", "objectives"];
  if (required.some((key) => !data[key])) return responseError("Please complete all required fields.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return responseError("Please provide a valid business email address.");
  if (!ALLOWED_INDUSTRIES.includes(data.industry)) return responseError("Please select a valid industry.");
  if (!ALLOWED_CATEGORIES.includes(data.category)) return responseError("Please select a valid training category.");
  if (data.participants && (!/^\d+$/.test(data.participants) || Number(data.participants) < 1 || Number(data.participants) > 1_000_000)) return responseError("Please provide a valid participant number.");
  if (payload.consent !== true && payload.consent !== "on") return responseError("Please confirm the consent statement.");

  const requestedAt = new Date().toISOString();
  const rows = [["Company Name", data.companyName], ["Contact Person", data.contactPerson], ["Job Title", data.jobTitle], ["Business Email", data.email], ["Phone Number", data.phone], ["Industry", data.industry], ["Training Category", data.category], ["Specific Programme", data.programme], ["Participants", data.participants], ["Training Location", data.location], ["Preferred Month", data.month], ["Budget", data.budget], ["Training Objectives", data.objectives], ["Additional Notes", data.notes], ["Submitted", requestedAt]];
  const text = rows.map(([label, value]) => `${label}: ${value || "Not provided"}`).join("\n");
  const htmlRows = rows.map(([label, value]) => `<tr><th align="left" style="padding:8px 12px;background:#f4f6f8">${escapeHtml(label)}</th><td style="padding:8px 12px">${escapeHtml(value || "Not provided").replace(/\n/g, "<br>")}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#172b45"><h2>New TERAS UNIVERSAL proposal request</h2><table style="border-collapse:collapse;width:100%;max-width:720px">${htmlRows}</table></div>`;
  const resend = new Resend(apiKey);

  try {
    const internal = await resend.emails.send({ from: fromEmail, to: [INTERNAL_RECIPIENT], replyTo: data.email, subject: "New proposal request - " + data.companyName, text, html });
    if (internal.error) throw new Error("Internal email failed: " + internal.error.message);
    const confirmation = await resend.emails.send({ from: fromEmail, to: [data.email], replyTo: INTERNAL_RECIPIENT, subject: "We received your TERAS UNIVERSAL proposal request", text: "Dear " + data.contactPerson + "\n\nThank you for contacting TERAS UNIVERSAL. We have received your proposal request and our team will review the requirements provided.\n\nOur team: " + INTERNAL_RECIPIENT + "\nPhone: +60 19-519 3834\n\nBuilding Competence. Creating Opportunities.", html: "<div style=\"font-family:Arial,sans-serif;color:#172b45\"><h2>Thank you for contacting TERAS UNIVERSAL</h2><p>Dear " + escapeHtml(data.contactPerson) + ",</p><p>We have received your proposal request. Our team will review the requirements provided and follow up with you.</p><p><strong>Email:</strong> " + INTERNAL_RECIPIENT + "<br><strong>Phone:</strong> +60 19-519 3834</p><p>Building Competence. Creating Opportunities.</p></div>" });
    if (confirmation.error) throw new Error("Confirmation email failed: " + confirmation.error.message);
    await saveLeadToGoogleSheets(data, requestedAt);
    recentRequests.set(ip, now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Proposal submission failed", { message: error instanceof Error ? error.message : "Unknown error" });
    const isSheetsFailure = error instanceof Error && error.message.startsWith("Google Sheets CRM");
    return responseError(isSheetsFailure ? "Your emails were sent, but we could not record the request in our CRM. Please try again or contact us directly." : "We could not send your request right now. Please try again or contact us directly.", 502);
  }
}


