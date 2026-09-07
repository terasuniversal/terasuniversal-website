/**
 * Normalize values copied into deployment environments without making an
 * invalid value look valid. A UTF-8 BOM at the beginning of a secret or URL
 * can make undici reject the value while constructing a request header.
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
