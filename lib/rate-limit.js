import { createClient } from "@supabase/supabase-js";

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

export async function checkSharedRateLimit({ key, windowSeconds = 60, maxAttempts = 1, failClosed = false }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    if (failClosed && process.env.NODE_ENV === "production") {
      console.error("Shared rate-limit configuration unavailable; rejecting protected request");
      return false;
    }
    return localFallback(key, windowSeconds, maxAttempts);
  }

  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("check_public_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_attempts: maxAttempts,
  });
  if (error) {
    console.error("Shared rate-limit check unavailable; using local fallback", { message: error.message });
    if (failClosed && process.env.NODE_ENV === "production") {
      console.error("Shared rate-limit unavailable; rejecting protected request", { message: error.message });
      return false;
    }
    return localFallback(key, windowSeconds, maxAttempts);
  }
  return data === true;
}
