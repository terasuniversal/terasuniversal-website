// W9-G1 eBook lead capture: the versioned consent wording and the launch switch, in one place so the form, the API
// route and the CRM record all refer to the same text. Changing any wording means a new version string.
//
// Launch switch: the public request API answers a real 404 unless TERAS_EBOOK_PUBLIC is exactly "on". It is OFF by
// default and fails closed (any other value, including "true" or "ON", keeps it off). Turning it on needs a separate
// Owner GO together with the CRM RPCs, the private bucket, the published Privacy Notice and delivery QA.
export function ebookPublicEnabled(env = process.env) {
  return env.TERAS_EBOOK_PUBLIC === "on";
}

// A (required): the Privacy Notice acknowledgement for providing the eBook. It names exactly the data collected.
export const EBOOK_PRIVACY_ACK_VERSION = "ebook-privacy-ack-v2";
export const EBOOK_PRIVACY_ACK_TEXT =
  "I have read the TERAS UNIVERSAL Privacy Notice and agree to my name, phone number and email address being used to provide this eBook and handle my request.";

// B (optional, separate, unticked): marketing by EMAIL only. Phone calls and WhatsApp are not covered by any consent
// on this form, so collecting the phone number never implies promotional calls or WhatsApp messages.
export const EBOOK_MARKETING_TEXT_VERSION = "ebook-marketing-email-v1";
export const EBOOK_MARKETING_TEXT =
  "Optional: send me information about TERAS UNIVERSAL training courses and schedules by email. I can withdraw at any time.";

export const EBOOK_PHONE_NOTE =
  "Used only for this eBook request. We will not call you or send WhatsApp messages for promotions.";
