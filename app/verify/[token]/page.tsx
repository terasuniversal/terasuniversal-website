import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { normalizeVerificationRpcResponse } from "../../../lib/public-verification-rpc";
import { VerificationResult, VerifyShell, firstIp, type VerifyRow } from "../VerificationResult";

export const dynamic = "force-dynamic";

// Result pages are never indexed.
export const metadata = {
  title: "Verification Result | TERAS UNIVERSAL",
  description: "Certificate verification result.",
  robots: { index: false, follow: false },
};

/**
 * A dynamic route segment's percent-encoding is never decoded by Next.js
 * (confirmed: a %2F in the URL arrives here still as the literal string
 * "%2F", not "/"). Certificate numbers routinely contain "/" (e.g.
 * "TU/AWA/2026/0001") and the QR target encodes them with
 * encodeURIComponent, so this decode is required for every real-format
 * certificate number to verify at all. Malformed percent-encoding
 * (`decodeURIComponent` throws `URIError` on it, e.g. a truncated "%E0%A4%A")
 * must not crash the page — fall back to the raw segment, which will then
 * simply fail to match anything and render as "not found".
 */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * QR target: /verify/{certificate_number} (certData.ts prefers the
 * certificate's own stored verification_url when set, falling back to
 * building one from certificate_number). verify_and_log's p_method:'auto'
 * matches on either verification_token or certificate_number, so either
 * identifier resolves here — same RPC, same enabled/deleted semantics as
 * the landing page's search.
 */
export default async function VerifyTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = safeDecodeURIComponent(rawToken);
  const h = await headers();
  const ip = firstIp(h.get("x-forwarded-for") || h.get("x-real-ip"));
  const ua = h.get("user-agent");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("verify_and_log", { p_query: token, p_method: "auto", p_ip: ip, p_ua: ua });
  const normalized = normalizeVerificationRpcResponse<VerifyRow>(data, error);
  if (normalized.kind === "error") {
    // Never surface DB internals or the submitted value. Keep the reason
    // observable in server logs without collapsing it into a confirmed miss.
    console.error("verify_and_log response failed", { reason: normalized.reason, message: error?.message });
  }
  const result = normalized.kind === "found" ? normalized.row : null;

  return (
    <VerifyShell>
      <VerificationResult result={result} failure={normalized.kind === "error" ? "runtime" : undefined} />
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <a href="/verify" style={{ color: "#0B2C56", fontSize: 13, textDecoration: "underline" }}>Verify another certificate</a>
      </p>
    </VerifyShell>
  );
}
