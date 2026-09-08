/**
 * Normalize values copied into deployment environments. A UTF-8 BOM at the
 * beginning of a Supabase key makes undici reject the request header.
 */
export function cleanRuntimeEnvValue(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/^\uFEFF/, "").trim();
  if (/[\u0000-\u001F\u007F\uFEFF]/.test(normalized)) return "";
  return normalized;
}

export function getSupabaseUrl(): string {
  return cleanRuntimeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabasePublishableKey(): string {
  return cleanRuntimeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function getSupabaseServiceRoleKey(): string {
  return cleanRuntimeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
