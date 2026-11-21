import { z } from "zod";
// Explicit extension: this module is also loaded directly by Node-run contracts that have no resolver hook.
import { APEX_ORIGIN, WWW_ORIGIN } from "./canonical-origin.js";

const trimmedText = (max: number) => z.string().trim().max(max);

export function generateRegistrationSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export const publicRegistrationAttendeeSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required").max(200),
  ic_passport_no: trimmedText(120).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address").max(254).optional().or(z.literal("")),
  phone: trimmedText(40).optional().or(z.literal("")),
  company: trimmedText(200).optional().or(z.literal("")),
});

export const publicRegistrationCreateSchema = z.object({
  schedule_id: z.string().uuid("Select a valid training session"),
  idempotency_key: z.string().trim().min(16).max(200),
  registration_secret: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Invalid registration secret"),
  attendees: z.array(publicRegistrationAttendeeSchema).min(1).max(100),
});

export const publicRegistrationStatusSchema = z.object({
  registration_reference: z.string().trim().min(8).max(64),
  registration_secret: z.string().trim().regex(/^[a-f0-9]{64}$/i, "Invalid registration secret"),
});

export const publicRegistrationPaymentSchema = publicRegistrationStatusSchema.extend({
  provider: z.literal("toyyibpay").default("toyyibpay"),
});

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  ).split(",")[0].trim().slice(0, 100);
}

// PKG-1b: the two public registration write endpoints (create and payment) are only ever called by the registration
// page's own fetch, which is same-origin, so a legitimate browser POST always carries an Origin equal to this
// deployment's own origin or a canonical TERAS host (plus NEXT_PUBLIC_SITE_URL where an environment configures one).
// Anything else -- no Origin, "null", a malformed value, another scheme, a look-alike host or an arbitrary *.vercel.app
// deployment -- is refused before rate limiting, parsing or any database call. The ToyyibPay callback is server-to-server
// and keeps its own checks; the read-only status route still uses isAllowedOrigin below.
export function trustedRegistrationOrigins(request: Request): Set<string> {
  const trusted = new Set<string>([new URL(request.url).origin, WWW_ORIGIN, APEX_ORIGIN]);
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try { trusted.add(new URL(configured).origin); } catch { /* a malformed configuration adds nothing */ }
  }
  return trusted;
}

export function isTrustedRegistrationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Exact string match against serialised origins only: a path, trailing slash, port, credentials, other scheme or
  // alternative spelling never matches.
  return trustedRegistrationOrigins(request).has(origin);
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin.endsWith(".vercel.app");
}

// PKG-1b: the per-registration payment rate-limit bucket. Case, whitespace and Unicode compatibility forms are folded
// so trivially different spellings of one reference share one bucket.
export function registrationReferenceBucket(reference: string): string {
  return reference.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("schedule_unavailable")) return "This training session is no longer available for registration.";
  if (message.includes("capacity_exceeded")) return "This session is full. Please choose another training date.";
  if (message.includes("duplicate_registration") || message.includes("duplicate_attendee")) return "One or more attendees already have a registration for this session.";
  if (message.includes("registration_expired")) return "This registration hold has expired. Please start again.";
  if (message.includes("registration_not_payable")) return "This registration is no longer available for payment.";
  if (message.includes("unsupported_payment_provider")) return "Online payment is not available at the moment.";
  return "We could not complete that request. Please try again or contact TERAS UNIVERSAL.";
}
