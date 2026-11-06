import { createHmac, randomBytes } from "node:crypto";
import { cleanRuntimeEnvValue, getSupabaseServiceRoleKey, getSupabaseUrl } from "./supabase/env";
import { validatePrivilegedSupabaseConfig } from "./preview-isolation";
import { createSupabaseServiceClient } from "./supabase/server";

// The database RPC is the source of truth in deployed environments. This
// bounded fallback keeps local development fail-closed when the migration has
// not been applied yet, without pretending that a per-instance Map is shared.
const fallback = new Map();
const MAX_FALLBACK_ENTRIES = 1000;

function localFallback(key, windowSeconds, maxAttempts) {
  const now = Date.now();
  const current = fallback.get(key);
  if (!current || now - current.startedAt >= windowSeconds * 1000) {
    if (!current && fallback.size >= MAX_FALLBACK_ENTRIES) {
      const oldestKey = fallback.keys().next().value;
      if (oldestKey) fallback.delete(oldestKey);
    }
    fallback.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= maxAttempts) return false;
  current.count += 1;
  return true;
}

// Client identity minimisation: the rate-limit table must not hold raw client
// IP addresses. The identity is a keyed HMAC-SHA-256 digest, so it is stable
// across serverless instances (same secret everywhere) and separate clients keep
// separate buckets, but it cannot be reversed or enumerated without the secret
// (an unkeyed hash of a 32-bit IPv4 address could be brute-forced in seconds).
//
// Secret: RATE_LIMIT_HMAC_SECRET when set (>= 32 characters), otherwise derived
// from the server-only service-role key, which the limiter needs anyway, so no
// new configuration is required. The context label separates this use from any
// other use of the key, and the digest reveals nothing about it. Rotating either
// secret only resets the current windows. When neither exists the limiter
// cannot reach the database at all, so a throwaway per-process key is enough
// for the in-memory fallback and no digest ever leaves the process.
const IDENTITY_CONTEXT = "teras:rate-limit:client-identity:v1";
const processOnlyKey = randomBytes(32);

function identityKey() {
  const dedicated = cleanRuntimeEnvValue(process.env.RATE_LIMIT_HMAC_SECRET);
  const material = dedicated.length >= 32 ? dedicated : getSupabaseServiceRoleKey();
  if (!material) return processOnlyKey;
  return createHmac("sha256", material).update(IDENTITY_CONTEXT).digest();
}

export function hashedClientId(ip) {
  const value = String(ip ?? "unknown").slice(0, 100);
  return createHmac("sha256", identityKey()).update(value).digest("hex").slice(0, 32);
}

// Privileged (service-role) client for the limiter. The RPC is no longer
// called with the public key, so execution can later be withdrawn from the
// public roles without touching this code. Returns null when the configuration
// is not usable, including a project the Preview isolation guard refuses.
function limiterClient() {
  if (!getSupabaseUrl() || !getSupabaseServiceRoleKey()) return null;
  if (!validatePrivilegedSupabaseConfig().ok) return null;
  try {
    return createSupabaseServiceClient();
  } catch {
    return null;
  }
}

export async function checkSharedRateLimit({ key, windowSeconds = 60, maxAttempts = 1, failClosed = false }) {
  const client = limiterClient();
  if (!client) {
    if (failClosed && process.env.NODE_ENV === "production") {
      console.error("Shared rate-limit configuration unavailable; rejecting protected request");
      return false;
    }
    return localFallback(key, windowSeconds, maxAttempts);
  }

  const safeKey = cleanRuntimeEnvValue(String(key)).slice(0, 256);
  if (!safeKey) return false;
  const { data, error } = await client.rpc("check_public_rate_limit", {
    p_key: safeKey,
    p_window_seconds: windowSeconds,
    p_max_attempts: maxAttempts,
  });
  if (error) {
    if (failClosed && process.env.NODE_ENV === "production") {
      console.error("Shared rate-limit unavailable; rejecting protected request", { message: error.message });
      return false;
    }
    console.error("Shared rate-limit check unavailable; using local fallback", { message: error.message });
    return localFallback(key, windowSeconds, maxAttempts);
  }
  return data === true;
}
