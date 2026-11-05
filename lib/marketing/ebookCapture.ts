import { z } from "zod";

/**
 * /ebook lead capture: pure rules (the only import is zod), shared by the public form, the API route and tests.
 *
 * Source documents: the Owner's launch-readiness plan and privacy draft for the eBook "Dari Zero Ke Dunia
 * Industri". Wording marked DRAFT below has NOT been legally reviewed and is NOT approved for publication.
 */

// The on/off flag lives in ./ebookFlag (a tiny module the edge middleware can import without bundling zod).

export const EBOOK_CATALOG = [
  {
    id: "dari-zero-ke-dunia-industri",
    title: "Dari Zero Ke Dunia Industri",
    subtitle: "Panduan Santai Untuk Kenal Scaffolding & Kerjaya Scaffold Erector",
    kicker: "eBook Percuma",
    /** Fingerprint of the Owner-approved distribution PDF. A file placed in storage later must match it. */
    pdfFileName: "TERAS_eBook_DariZeroKeDuniaIndustri.pdf",
    pdfSha256: "fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc",
    /** The PDF is NOT in this repository and no download exists until storage and delivery are approved. */
    delivery: "not_active",
  },
] as const;

export type EbookId = (typeof EBOOK_CATALOG)[number]["id"];
export const EBOOK_IDS = EBOOK_CATALOG.map((e) => e.id) as [EbookId, ...EbookId[]];

/** Versions stored with every submission as consent evidence. DRAFT text: NOT LEGALLY REVIEWED. */
export const PRIVACY_NOTICE_VERSION = "draft-2026-11-02-unreviewed";
export const CONSENT_TEXT_VERSION = "ebook-form-draft-2026-11-05-unreviewed";

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmValues = Partial<Record<UtmKey, string>>;

const UTM_MAX = 200;

/** Keeps only the five known UTM keys; values are trimmed, stripped of control characters and capped at 200. */
export function sanitizeUtm(input: unknown): UtmValues {
  const out: UtmValues = {};
  if (!input || typeof input !== "object") return out;
  for (const key of UTM_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const value = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, UTM_MAX);
    if (value) out[key] = value;
  }
  return out;
}

export function utmFromSearchParams(params: URLSearchParams): UtmValues {
  const picked: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) picked[key] = value;
  }
  return sanitizeUtm(picked);
}

export const MIN_FILL_TIME_MS = 3000;
/** A form older than a day, or one claiming to start in the future, is not a normal human fill. */
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

export function fillTimeStatus(startedAt: number, now: number): "ok" | "too_fast" | "invalid" {
  if (!Number.isFinite(startedAt)) return "invalid";
  const elapsed = now - startedAt;
  if (elapsed < 0 || elapsed > MAX_FORM_AGE_MS) return "invalid";
  return elapsed < MIN_FILL_TIME_MS ? "too_fast" : "ok";
}

/** Phone numbers: digits, spaces and + ( ) . / - only, 3 to 40 characters. */
const PHONE_PATTERN = /^[0-9+()./ -]{3,40}$/;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const ebookLeadSchema = z.object({
  email: z.string().trim().min(1, "email_required").max(254, "email_invalid").email("email_invalid"),
  full_name: optionalText(200),
  // Trim first so a whitespace-only phone counts as blank (the field is optional) before the pattern is applied.
  phone: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(40).regex(PHONE_PATTERN, "phone_invalid").optional().or(z.literal(""))),
  ebook_id: z.enum(EBOOK_IDS),
  /** Required. Acknowledging the Privacy Notice is NOT marketing consent. */
  privacy_acknowledged: z.literal(true, { message: "privacy_acknowledgement_required" }),
  /** Optional and separate. Never inferred from submitting the form. */
  marketing_opt_in: z.boolean(),
  request_id: z.string().uuid(),
  utm: z.record(z.string(), z.unknown()).optional(),
  /** Honeypot: humans never see or fill this field. */
  website: z.string().max(500).optional(),
  formStartedAt: z.number(),
});
export type EbookLeadInput = z.infer<typeof ebookLeadSchema>;

/** Rate-limit key part for an email: a truncated SHA-256 of the normalised address, so no address is stored. */
export async function emailRateKeyPart(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Stable database error codes mapped to a visitor-safe message. Anything unknown gets the generic message. */
export function captureErrorMessage(rawMessage: string): { status: number; message: string } {
  if (rawMessage.includes("invalid_email")) return { status: 400, message: "Sila masukkan alamat e-mel yang sah." };
  if (rawMessage.includes("privacy_acknowledgement_required")) return { status: 400, message: "Sila sahkan bahawa anda telah membaca Notis Privasi." };
  if (rawMessage.includes("invalid_phone")) return { status: 400, message: "Sila semak nombor telefon anda." };
  if (rawMessage.includes("invalid_name") || rawMessage.includes("invalid_ebook") || rawMessage.includes("invalid_version") || rawMessage.includes("invalid_request_id")) {
    return { status: 400, message: "Sila semak maklumat borang dan cuba lagi." };
  }
  return { status: 502, message: "Kami tidak dapat merekod permintaan anda sekarang. Sila cuba lagi sebentar lagi." };
}
