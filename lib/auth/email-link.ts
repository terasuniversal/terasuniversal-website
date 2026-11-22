/**
 * Pure helpers for staff email links (invitation and password recovery).
 *
 * Why this exists (AUTH-1, 2026-11-22): GoTrue's default email links redirect
 * with the session in the URL hash (implicit flow), but the browser client from
 * @supabase/ssr is PKCE-only and rejects such a URL ("Not a valid PKCE flow
 * url"), so invited staff never got a session and could not set a password.
 * The supported fix is a server-side token_hash confirmation (verifyOtp) behind
 * a deliberate button press, so an email scanner's GET cannot spend the token.
 *
 * Kept dependency-free so the contract tests can import it directly.
 */

export const EMAIL_LINK_TYPES = ["invite", "recovery"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/** The only place a confirmed link may send the user. Never taken from the request. */
export const SET_PASSWORD_PATH = "/admin/auth/set-password";
export const CONFIRM_PATH = "/admin/auth/confirm";

// GoTrue token hashes are hex digests (optionally "pkce_"-prefixed); anything
// else is rejected before it reaches the Auth server.
const TOKEN_HASH_PATTERN = /^(?:pkce_)?[A-Za-z0-9_-]{20,256}$/;

export type ParsedEmailLink = { ok: true; tokenHash: string; type: EmailLinkType } | { ok: false };

export function parseEmailLinkParams(tokenHash: unknown, type: unknown): ParsedEmailLink {
  if (typeof tokenHash !== "string" || typeof type !== "string") return { ok: false };
  const hash = tokenHash.trim();
  if (!TOKEN_HASH_PATTERN.test(hash)) return { ok: false };
  if (!(EMAIL_LINK_TYPES as readonly string[]).includes(type)) return { ok: false };
  return { ok: true, tokenHash: hash, type: type as EmailLinkType };
}

export const CONFIRM_ERROR_CODES = ["link_expired", "link_invalid", "account_inactive", "rate_limited", "unavailable"] as const;
export type ConfirmErrorCode = (typeof CONFIRM_ERROR_CODES)[number];

export const CONFIRM_ERROR_MESSAGES: Record<ConfirmErrorCode, string> = {
  link_expired:
    "Pautan ini telah tamat tempoh atau sudah digunakan. Minta pautan baharu melalui \"Forgot password?\" di halaman log masuk, atau minta pentadbir menghantar semula jemputan.",
  link_invalid: "Pautan ini tidak sah. Buka pautan terkini daripada e-mel anda, atau minta pautan baharu di halaman log masuk.",
  account_inactive: "Akaun ini tidak aktif. Hubungi Super Admin untuk mengaktifkannya.",
  rate_limited: "Terlalu banyak cubaan. Tunggu beberapa minit, kemudian cuba lagi.",
  unavailable: "Pengesahan tidak dapat diselesaikan sekarang. Cuba lagi sebentar lagi.",
};

export function confirmErrorCode(value: unknown): ConfirmErrorCode | null {
  return typeof value === "string" && (CONFIRM_ERROR_CODES as readonly string[]).includes(value) ? (value as ConfirmErrorCode) : null;
}

/** Maps a verifyOtp failure to a user-facing code without echoing the raw error. */
export function mapVerifyOtpError(error: { status?: number; code?: string; message?: string } | null | undefined): ConfirmErrorCode {
  if (!error) return "unavailable";
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  if (error.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return "rate_limited";
  if (code === "otp_expired" || /expired|invalid or has expired|not found/.test(message)) return "link_expired";
  if (code === "validation_failed" || code === "bad_jwt" || /invalid/.test(message)) return "link_invalid";
  if (typeof error.status === "number" && error.status >= 400 && error.status < 500) return "link_invalid";
  return "unavailable";
}

// Authentication methods GoTrue records when a session comes from an email link
// (token_hash verification or a legacy hash link). A password login is not one.
export const EMAIL_LINK_AMR_METHODS = ["otp", "invite", "recovery", "magiclink", "email/signup"] as const;
/** How long after the link was used the user may set a password without the current one. */
export const EMAIL_LINK_SESSION_MAX_AGE_SECONDS = 60 * 60;

type AmrEntry = { method?: unknown; timestamp?: unknown };

/**
 * True when the current session was established by an email link recently.
 * This is what lets /admin/auth/set-password skip the current-password check:
 * an ordinary password session must keep using the change-password page.
 */
export function hasRecentEmailLinkAuth(amr: unknown, nowSeconds: number, maxAgeSeconds = EMAIL_LINK_SESSION_MAX_AGE_SECONDS): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: AmrEntry | string) => {
    if (typeof entry === "string") return false; // RFC-8176 strings carry no timestamp; fail closed.
    const method = typeof entry?.method === "string" ? entry.method : "";
    const timestamp = typeof entry?.timestamp === "number" ? entry.timestamp : NaN;
    if (!(EMAIL_LINK_AMR_METHODS as readonly string[]).includes(method)) return false;
    return Number.isFinite(timestamp) && timestamp <= nowSeconds + 60 && nowSeconds - timestamp <= maxAgeSeconds;
  });
}

export type LegacyHashTokens = { accessToken: string; refreshToken: string; type: EmailLinkType };

/**
 * Reads a legacy implicit-flow link (#access_token=...&refresh_token=...&type=invite).
 * Only invite and recovery are accepted; anything else is ignored.
 */
export function parseLegacyHashTokens(hash: string): LegacyHashTokens | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  const type = params.get("type") ?? "";
  if (!accessToken || !refreshToken) return null;
  if (!(EMAIL_LINK_TYPES as readonly string[]).includes(type)) return null;
  if (accessToken.length > 4096 || refreshToken.length > 512) return null;
  return { accessToken, refreshToken, type: type as EmailLinkType };
}

/** Error parameters GoTrue appends to the hash when a link is already used or expired. */
export function legacyHashErrorCode(hash: string): ConfirmErrorCode | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (!params.get("error") && !params.get("error_code")) return null;
  return params.get("error_code") === "otp_expired" ? "link_expired" : "link_invalid";
}

/**
 * redirect_to for invitation/recovery emails sent with GoTrue's default template.
 * It stays on /admin/reset-password, the path already in the project's
 * Redirect URLs (an unlisted path silently falls back to the Site URL root),
 * and that page forwards the link to /admin/auth/confirm. Once
 * /admin/auth/confirm is allowlisted this can point there directly.
 */
export const EMAIL_LINK_REDIRECT_PATH = "/admin/reset-password";

/** Absolute redirect_to for the current deployment; null when the site URL is missing or malformed. */
export function emailLinkRedirectUrl(siteUrl: string | undefined): string | null {
  const base = (siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(base)) return null;
  return `${base}${EMAIL_LINK_REDIRECT_PATH}`;
}
