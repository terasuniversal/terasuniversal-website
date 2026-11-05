/**
 * Preview isolation guards.
 *
 * Purpose: a Vercel Preview (or any non-Production deployment) must never be
 * able to reach Production Supabase with privileged credentials, send email
 * through Production Resend, write to the Production Google Sheet, or start a
 * live ToyyibPay payment, even if an environment variable is mis-scoped.
 *
 * Design rules:
 * - Self-contained and dependency-free so it can be unit-tested with plain
 *   `node --experimental-transform-types` (no Next.js runtime needed).
 * - Production behavior is unchanged: when the resolved target is exactly
 *   "production" every check here returns "allowed" without reading any other
 *   configuration.
 * - Everything else (preview, development, custom environments such as
 *   "staging", local runs, and any missing or unexpected value) is restricted
 *   and fails closed.
 * - No function here ever returns, logs or throws a secret value. Service keys
 *   are inspected in memory only; at most a non-secret project reference
 *   (already public in the project URL) is compared.
 */

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// 1. Deployment target
// ---------------------------------------------------------------------------

export type DeploymentTarget = "production" | "preview" | "development" | "custom" | "local" | "unknown";

export interface ResolvedDeploymentTarget {
  target: DeploymentTarget;
  /** The Vercel target name when known ("production", "preview", "staging", ...). Never a secret. */
  name: string | null;
  reason: string;
}

const CUSTOM_ENVIRONMENT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * Resolve the deployment target from VERCEL_TARGET_ENV.
 *
 * VERCEL_TARGET_ENV is "production", "preview", "development" or the name of a
 * custom environment. VERCEL_ENV is NOT used to classify (custom environments
 * report "preview" there) but is used as a cross-check: a "production" target
 * paired with a non-production VERCEL_ENV, or the reverse, is treated as
 * unknown rather than trusted.
 */
export function resolveDeploymentTarget(env: Env = process.env): ResolvedDeploymentTarget {
  const rawTarget = typeof env.VERCEL_TARGET_ENV === "string" ? env.VERCEL_TARGET_ENV.trim() : "";
  const rawVercelEnv = typeof env.VERCEL_ENV === "string" ? env.VERCEL_ENV.trim() : "";
  const onVercel = Boolean(env.VERCEL) || rawVercelEnv !== "";

  if (rawTarget === "") {
    return onVercel
      ? { target: "unknown", name: null, reason: "vercel_target_env_missing_on_vercel" }
      : { target: "local", name: null, reason: "not_running_on_vercel" };
  }

  if (rawTarget === "production") {
    if (rawVercelEnv !== "" && rawVercelEnv !== "production") {
      return { target: "unknown", name: null, reason: "vercel_env_conflicts_with_target" };
    }
    return { target: "production", name: "production", reason: "vercel_target_env_production" };
  }

  if (rawVercelEnv === "production") {
    return { target: "unknown", name: null, reason: "vercel_env_conflicts_with_target" };
  }
  if (rawTarget === "preview") return { target: "preview", name: "preview", reason: "vercel_target_env_preview" };
  if (rawTarget === "development") return { target: "development", name: "development", reason: "vercel_target_env_development" };
  if (CUSTOM_ENVIRONMENT_NAME.test(rawTarget)) {
    return { target: "custom", name: rawTarget, reason: "vercel_target_env_custom" };
  }
  return { target: "unknown", name: null, reason: "vercel_target_env_unrecognized" };
}

export function isProductionTarget(env: Env = process.env): boolean {
  return resolveDeploymentTarget(env).target === "production";
}

// ---------------------------------------------------------------------------
// 2. Privileged Supabase configuration
// ---------------------------------------------------------------------------

/** Public, non-secret project reference of the Production Supabase project (already present in this repo's config). */
export const PRODUCTION_SUPABASE_PROJECT_REF = "iagzkrzeuawaxvacqprk";
/** Non-secret, per-environment: the one Supabase project this non-production deployment is approved to use. */
export const APPROVED_SUPABASE_REF_ENV = "TERAS_APPROVED_SUPABASE_PROJECT_REF";
/** Non-secret, per-environment attestation, needed only when the service key carries no readable project reference. */
export const SERVICE_KEY_REF_ATTESTATION_ENV = "TERAS_SERVICE_KEY_PROJECT_REF";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const SUPABASE_HOST_PATTERN = /^([a-z]{20})\.supabase\.co$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]+$/;

export type PrivilegedGuardCode =
  | "target_unknown"
  | "approved_ref_missing"
  | "approved_ref_invalid"
  | "approved_ref_is_production"
  | "url_missing"
  | "url_not_supabase_host"
  | "url_ref_mismatch"
  | "service_key_missing"
  | "service_key_unrecognized"
  | "service_key_role_invalid"
  | "service_key_ref_mismatch"
  | "service_key_attestation_missing"
  | "service_key_attestation_invalid"
  | "service_key_attestation_mismatch";

export type PrivilegedGuardResult =
  | { ok: true; target: DeploymentTarget; projectRef: string | null; keyCheck: "production_unrestricted" | "jwt_ref_matched" | "attested" | "local_loopback" }
  | { ok: false; target: DeploymentTarget; code: PrivilegedGuardCode; message: string };

function clean(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/^﻿/, "").trim();
  return /[\u0000-\u001F\u007F﻿]/.test(normalized) ? "" : normalized;
}

/**
 * True only for a plain loopback URL (localhost, 127.0.0.1 or [::1], http or
 * https, no embedded credentials). This is the shape of a local Supabase
 * stack. It is honored ONLY for the "local" deployment target (no Vercel
 * variables at all), never for preview, development, custom or unknown
 * deployments, and it is not a flag anyone can set.
 */
export function isLoopbackSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

function projectRefFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const match = SUPABASE_HOST_PATTERN.exec(parsed.hostname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

type ServiceKeyShape =
  | { format: "legacy_jwt"; ref: string | null; role: string | null }
  | { format: "secret_key" }
  | { format: "unknown" };

/**
 * Classify a service key WITHOUT returning or logging it. Legacy `service_role`
 * keys are JWTs whose payload carries a project `ref`; new `sb_secret_...` keys
 * are opaque and carry no readable project reference. Only the non-secret
 * `ref` and `role` claims ever leave this function.
 */
function classifyServiceKey(key: string): ServiceKeyShape {
  if (SECRET_KEY_PATTERN.test(key)) return { format: "secret_key" };
  if (!JWT_PATTERN.test(key)) return { format: "unknown" };
  try {
    const payloadPart = key.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return { format: "unknown" };
    return {
      format: "legacy_jwt",
      ref: typeof payload.ref === "string" ? payload.ref : null,
      role: typeof payload.role === "string" ? payload.role : null,
    };
  } catch {
    return { format: "unknown" };
  }
}

const GUARD_MESSAGES: Record<PrivilegedGuardCode, string> = {
  target_unknown: "Deployment target could not be determined.",
  approved_ref_missing: "No approved Supabase project is configured for this environment.",
  approved_ref_invalid: "The approved Supabase project reference is malformed.",
  approved_ref_is_production: "Production Supabase project cannot be approved for a non-production environment.",
  url_missing: "Supabase URL is not configured.",
  url_not_supabase_host: "Supabase URL is not a recognized project host.",
  url_ref_mismatch: "Supabase URL does not match the approved project for this environment.",
  service_key_missing: "Privileged Supabase credential is not configured.",
  service_key_unrecognized: "Privileged Supabase credential has an unrecognized format.",
  service_key_role_invalid: "Privileged Supabase credential is not a service-role credential.",
  service_key_ref_mismatch: "Privileged Supabase credential belongs to a different project than approved.",
  service_key_attestation_missing: "Privileged credential project cannot be verified; an environment attestation is required.",
  service_key_attestation_invalid: "The credential project attestation is malformed.",
  service_key_attestation_mismatch: "The credential project attestation does not match the approved project.",
};

function fail(target: DeploymentTarget, code: PrivilegedGuardCode): PrivilegedGuardResult {
  return { ok: false, target, code, message: GUARD_MESSAGES[code] };
}

/**
 * Validate that the effective privileged Supabase configuration is safe to use
 * in this deployment. Production is returned as-is (unchanged behavior).
 * Anything else must (a) resolve to a known target, (b) declare one approved,
 * non-Production project reference, (c) have a URL on that project, and
 * (d) have a service key that is verifiably, or by explicit attestation, for
 * that same project.
 */
export function validatePrivilegedSupabaseConfig(env: Env = process.env): PrivilegedGuardResult {
  const resolved = resolveDeploymentTarget(env);
  if (resolved.target === "production") {
    return { ok: true, target: "production", projectRef: null, keyCheck: "production_unrestricted" };
  }
  if (resolved.target === "unknown") return fail("unknown", "target_unknown");

  const target = resolved.target;

  // Local development against a local Supabase stack: a verified loopback URL
  // cannot reach Production, so no approved project reference is needed. The
  // credential must still be present and recognizable. Local target only.
  if (target === "local" && isLoopbackSupabaseUrl(clean(env.NEXT_PUBLIC_SUPABASE_URL))) {
    const localKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
    if (localKey === "") return fail(target, "service_key_missing");
    if (classifyServiceKey(localKey).format === "unknown") return fail(target, "service_key_unrecognized");
    return { ok: true, target, projectRef: null, keyCheck: "local_loopback" };
  }

  const approvedRef = clean(env[APPROVED_SUPABASE_REF_ENV]);
  if (approvedRef === "") return fail(target, "approved_ref_missing");
  if (!PROJECT_REF_PATTERN.test(approvedRef)) return fail(target, "approved_ref_invalid");
  if (approvedRef === PRODUCTION_SUPABASE_PROJECT_REF) return fail(target, "approved_ref_is_production");

  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (url === "") return fail(target, "url_missing");
  const urlRef = projectRefFromUrl(url);
  if (urlRef === null) return fail(target, "url_not_supabase_host");
  if (urlRef !== approvedRef) return fail(target, "url_ref_mismatch");

  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (key === "") return fail(target, "service_key_missing");
  const shape = classifyServiceKey(key);
  if (shape.format === "unknown") return fail(target, "service_key_unrecognized");

  if (shape.format === "legacy_jwt") {
    if (shape.role !== null && shape.role !== "service_role") return fail(target, "service_key_role_invalid");
    if (shape.ref !== null) {
      return shape.ref === approvedRef
        ? { ok: true, target, projectRef: approvedRef, keyCheck: "jwt_ref_matched" }
        : fail(target, "service_key_ref_mismatch");
    }
  }

  // Opaque `sb_secret_` keys (and JWTs without a ref claim) cannot be tied to a
  // project by inspection. Require an explicit, per-environment attestation of
  // the key's project; it must equal the approved project. This does not
  // weaken the URL check above, which always applies.
  const attested = clean(env[SERVICE_KEY_REF_ATTESTATION_ENV]);
  if (attested === "") return fail(target, "service_key_attestation_missing");
  if (!PROJECT_REF_PATTERN.test(attested)) return fail(target, "service_key_attestation_invalid");
  if (attested !== approvedRef) return fail(target, "service_key_attestation_mismatch");
  return { ok: true, target, projectRef: approvedRef, keyCheck: "attested" };
}

// ---------------------------------------------------------------------------
// 2b. Anon / authenticated (non-privileged) Supabase clients
// ---------------------------------------------------------------------------

export type PublicGuardCode =
  | "production_project_in_non_production"
  | "approved_ref_invalid"
  | "approved_ref_is_production"
  | "url_ref_mismatch";

export type PublicGuardResult =
  | { ok: true; target: DeploymentTarget }
  | { ok: false; target: DeploymentTarget; code: PublicGuardCode; message: string };

const PUBLIC_GUARD_MESSAGES: Record<PublicGuardCode, string> = {
  production_project_in_non_production: "This environment is not allowed to use the Production Supabase project.",
  approved_ref_invalid: "The approved Supabase project reference is malformed.",
  approved_ref_is_production: "Production Supabase project cannot be approved for a non-production environment.",
  url_ref_mismatch: "Supabase URL does not match the approved project for this environment.",
};

function publicFail(target: DeploymentTarget, code: PublicGuardCode): PublicGuardResult {
  return { ok: false, target, code, message: PUBLIC_GUARD_MESSAGES[code] };
}

/**
 * Server-side check for anon and authenticated Supabase clients (public
 * registration, staff sign-in, password reset, user-session certificate
 * operations). It is intentionally narrower than the privileged check so
 * read-only Preview pages keep working without extra configuration:
 *
 * - Production: unchanged (returns ok immediately).
 * - Known non-Production targets (preview, development, custom, local): the
 *   URL must NOT be the Production project; and if an approved project
 *   reference is configured the URL must match it.
 * - Unknown target (VERCEL_TARGET_ENV missing or conflicting): allowed,
 *   because a Production deployment whose system variables are hidden would
 *   look identical and must not be taken down. The privileged check still
 *   fails closed for unknown targets.
 * - A missing URL is left to the caller's existing "not configured" handling.
 *
 * Browser-side clients cannot call this (no deployment variables in the
 * browser); they use the same NEXT_PUBLIC values, and the server-side checks
 * plus the /admin middleware cover the pages that depend on them.
 */
export function validatePublicSupabaseConfig(env: Env = process.env): PublicGuardResult {
  const resolved = resolveDeploymentTarget(env);
  const target = resolved.target;
  if (target === "production" || target === "unknown") return { ok: true, target };

  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (url === "") return { ok: true, target };
  if (target === "local" && isLoopbackSupabaseUrl(url)) return { ok: true, target };

  const urlRef = projectRefFromUrl(url);
  if (urlRef === PRODUCTION_SUPABASE_PROJECT_REF) return publicFail(target, "production_project_in_non_production");

  const approvedRef = clean(env[APPROVED_SUPABASE_REF_ENV]);
  if (approvedRef !== "") {
    if (!PROJECT_REF_PATTERN.test(approvedRef)) return publicFail(target, "approved_ref_invalid");
    if (approvedRef === PRODUCTION_SUPABASE_PROJECT_REF) return publicFail(target, "approved_ref_is_production");
    if (urlRef !== approvedRef) return publicFail(target, "url_ref_mismatch");
  }
  return { ok: true, target };
}

/** Throws PreviewIsolationError (code + generic message only) when an anon/auth client would use a disallowed project. */
export function assertPublicSupabaseConfig(env: Env = process.env): void {
  const result = validatePublicSupabaseConfig(env);
  if (!result.ok) {
    console.error("Supabase client blocked by preview isolation guard", { code: result.code, target: result.target });
    throw new PreviewIsolationError(result.code, result.message);
  }
}

/** Works across module instances (bundlers can duplicate classes), so match on name as well as instanceof. */
export function isPreviewIsolationError(error: unknown): error is PreviewIsolationError {
  return error instanceof PreviewIsolationError || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "PreviewIsolationError");
}

/** Body for a provider-facing callback that was blocked: an explicit non-success, never an "OK" acknowledgement. */
export function blockedCallbackBody() {
  return { error: "Payment callbacks are disabled in this environment.", code: "callback_disabled_non_production" };
}

export class PreviewIsolationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PreviewIsolationError";
    this.code = code;
  }
}

/** Throws PreviewIsolationError (code + generic message only) when the privileged configuration is not safe. */
export function assertPrivilegedSupabaseConfig(env: Env = process.env): void {
  const result = validatePrivilegedSupabaseConfig(env);
  if (!result.ok) {
    console.error("Privileged Supabase client blocked by preview isolation guard", { code: result.code, target: result.target });
    throw new PreviewIsolationError(result.code, result.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Outbound side effects
// ---------------------------------------------------------------------------

export type OutboundChannel = "email" | "google_sheets" | "staff_invite";

export type OutboundDecision =
  | { allowed: true }
  | { allowed: false; status: 503; code: "outbound_disabled_non_production"; channel: OutboundChannel; message: string };

const OUTBOUND_MESSAGES: Record<OutboundChannel, string> = {
  email: "Email sending is disabled in this environment.",
  google_sheets: "Google Sheets sync is disabled in this environment.",
  staff_invite: "Staff invitations are disabled in this environment.",
};

/**
 * Outbound integrations are allowed ONLY in the Production target. There is
 * deliberately no override flag here: enabling a channel for a non-Production
 * environment needs a reviewed code change with its own dedicated test
 * credentials, never a shared switch.
 */
export function outboundDecision(channel: OutboundChannel, env: Env = process.env): OutboundDecision {
  if (isProductionTarget(env)) return { allowed: true };
  return { allowed: false, status: 503, code: "outbound_disabled_non_production", channel, message: OUTBOUND_MESSAGES[channel] };
}

/** JSON body for a blocked route response. Explicit failure -- never a simulated success. */
export function blockedOutboundBody(decision: Extract<OutboundDecision, { allowed: false }>) {
  return { error: decision.message, code: decision.code, channel: decision.channel };
}

// ---------------------------------------------------------------------------
// 4. ToyyibPay live-payment gate
// ---------------------------------------------------------------------------

/**
 * "sandbox" mode is permitted in any target (no real money). "production" mode
 * is permitted only in the Production target.
 */
export function isToyyibpayModeAllowed(mode: "sandbox" | "production", env: Env = process.env): boolean {
  return mode === "sandbox" || isProductionTarget(env);
}
