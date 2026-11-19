/**
 * Public-First launch (F-1): server-side kill switch for NEW public course registration and payment initiation.
 *
 * `registration_available` from get_public_registration_schedule is derived from CRM schedule data (published, open,
 * future, positive fee, capacity) -- it is not an on/off control, and POST /api/registration accepts any eligible
 * schedule even when no Register button is shown. This gate is that control. It FAILS CLOSED: only the exact value
 * TERAS_PUBLIC_REGISTRATION=enabled turns public registration on; unset, empty or any other value keeps it off.
 *
 * When off: the public site offers Enquire instead of Register, /registration/[scheduleId] is a 404, and
 * POST /api/registration and POST /api/registration/payment answer 503 before any database call or ToyyibPay request.
 * Deliberately NOT gated: /registration/status and /api/registration/status (read-only), the ToyyibPay callbacks and
 * every RPC -- obligations created before the switch was turned off still settle exactly as before.
 * Read at request time (route handlers) or build/revalidate time (cached schedule data); changing it needs a redeploy.
 */
export const PUBLIC_REGISTRATION_FLAG = "TERAS_PUBLIC_REGISTRATION";

export function publicRegistrationEnabled(): boolean {
  return process.env.TERAS_PUBLIC_REGISTRATION === "enabled";
}

export const REGISTRATION_DISABLED_MESSAGE =
  "Online registration is not available at the moment. Please contact TERAS to enquire about this session.";
