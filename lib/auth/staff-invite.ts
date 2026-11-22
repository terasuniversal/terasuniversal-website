/**
 * Decides what "Resend Invite" may do for a staff account (AUTH-1).
 *
 * - Inactive accounts are refused: sending a link would not (and must not)
 *   activate them, and their status is a Super Admin decision.
 * - An account whose email is not confirmed has a pending invitation, so a new
 *   invitation is sent.
 * - A confirmed account (the invite link was already opened, often without a
 *   password being set) cannot be re-invited -- GoTrue answers 422 -- so it
 *   gets a password-setup (recovery) email instead.
 */
export type ResendDecision = "refuse_inactive" | "invite" | "recovery";

export function resendDecision(input: { isActive: boolean; emailConfirmedAt: string | null }): ResendDecision {
  if (!input.isActive) return "refuse_inactive";
  return input.emailConfirmedAt ? "recovery" : "invite";
}

/** Bahasa Melayu messages for the staff detail page (?error= / ?resent=). */
export const STAFF_INVITE_MESSAGES: Record<string, string> = {
  "resent:invite": "Jemputan baharu telah dihantar ke e-mel staf ini.",
  "resent:recovery": "Akaun ini sudah disahkan, jadi e-mel untuk menetapkan kata laluan telah dihantar.",
  "error:staff-inactive": "Akaun ini tidak aktif. Aktifkan akaun dahulu sebelum menghantar semula jemputan.",
  "error:resend-rate-limited": "E-mel telah dihantar baru-baru ini. Tunggu 5 minit sebelum mencuba lagi.",
  "error:invite-not-resent": "Jemputan tidak dapat dihantar semula. Cuba lagi sebentar lagi.",
  "error:invite-not-configured": "Jemputan staf belum dikonfigurasi untuk persekitaran ini.",
  "error:invite-disabled-non-production": "Jemputan staf tidak dihantar di luar Production.",
  "error:invalid-staff-account": "Akaun staf tidak sah.",
  "error:staff-not-found": "Akaun staf tidak ditemui.",
};

export function staffInviteMessage(kind: "resent" | "error", code: unknown): string | null {
  if (typeof code !== "string") return null;
  return STAFF_INVITE_MESSAGES[`${kind}:${code}`] ?? null;
}
