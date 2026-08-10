import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { VerificationResult, VerifyShell, firstIp, type VerifyRow } from "./VerificationResult";

export const dynamic = "force-dynamic";

/**
 * SEO: the landing (no query) is indexable; result pages (with ?q=) are
 * noindex so individual certificate results never appear in search engines.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const hasResult = !!sp.q;
  return {
    title: hasResult ? "Verification Result | TERAS UNIVERSAL" : "Verify a Certificate | TERAS UNIVERSAL",
    description: "Verify the authenticity of a certificate issued by TERAS UNIVERSAL SDN. BHD.",
    robots: hasResult ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function VerifyLandingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();

  let result: VerifyRow | null = null;
  let searched = false;
  if (query) {
    searched = true;
    const h = await headers();
    const ip = firstIp(h.get("x-forwarded-for") || h.get("x-real-ip"));
    const ua = h.get("user-agent");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("verify_and_log", { p_query: query, p_method: "auto", p_ip: ip, p_ua: ua });
    if (error) {
      // Never surface DB internals on a public page, and never log the
      // submitted value itself — it can be a certificate number, token, or
      // (if a confused visitor pastes one) an IC/passport number. Log
      // server-side only, then fall through to the same "not found" UI a
      // genuine miss would show.
      console.error("verify_and_log RPC failed", { message: error.message });
    }
    result = !error && data && data.length > 0 ? (data[0] as VerifyRow) : null;
  }

  return (
    <VerifyShell>
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: searched ? 22 : 4 }}>
        <input
          name="q"
          defaultValue={query}
          placeholder="Certificate number or verification token"
          aria-label="Certificate number or verification token"
          required
          style={{ flex: 1, padding: "12px 14px", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: 15 }}
        />
        <button type="submit" style={{ padding: "12px 20px", background: "#E1A925", color: "#0B2C56", border: 0, borderRadius: 10, fontWeight: 800, cursor: "pointer" }}>Verify</button>
      </form>

      {!searched && (
        <p style={{ color: "#98a2b3", fontSize: 12.5, textAlign: "center", margin: "6px 0 0" }}>
          Enter the certificate number (e.g. CERT-2026-000123) or the verification token, or scan the QR code on the certificate.
        </p>
      )}

      {searched && <VerificationResult result={result} />}
    </VerifyShell>
  );
}
