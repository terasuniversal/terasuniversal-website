import { z } from "zod";

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

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin.endsWith(".vercel.app");
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
