export type VerificationRpcRow = {
  found?: boolean;
};

export type VerificationRpcNormalization<T extends VerificationRpcRow> =
  | { kind: "found"; row: T }
  | { kind: "not-found" }
  | { kind: "error"; reason: "rpc-error" | "unexpected-shape" | "multiple-rows" };

/**
 * Supabase RETURNS TABLE RPCs normally arrive as a one-row array. Keep the
 * response-shape boundary in one place because hosted clients may expose a
 * single row as an object. Never silently select the first row from an
 * unexpected multi-row response.
 */
export function normalizeVerificationRpcResponse<T extends VerificationRpcRow>(
  data: unknown,
  error: { message?: string } | null | undefined,
): VerificationRpcNormalization<T> {
  if (error) return { kind: "error", reason: "rpc-error" };

  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  if (Array.isArray(data) && data.length > 1) return { kind: "error", reason: "multiple-rows" };
  if (rows.length === 0) return { kind: "not-found" };

  const row = rows[0];
  if (!row || typeof row !== "object" || typeof row.found !== "boolean") {
    return { kind: "error", reason: "unexpected-shape" };
  }
  if (!row.found) return { kind: "not-found" };
  return { kind: "found", row: row as T };
}