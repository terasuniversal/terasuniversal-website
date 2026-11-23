import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { normalizeVerificationRpcResponse } from "../../lib/public-verification-rpc";
import { socialMetadata } from "../../lib/social-metadata";
import { VerificationResult, VerifyShell, firstIp, type VerifyRow } from "./VerificationResult";

export const dynamic = "force-dynamic";

/**
 * SEO: the landing (no query) is indexable; result pages (with ?q=) are
 * noindex so individual certificate results never appear in search engines.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const hasResult = !!sp.q;
  // W6-SEO-a1 (owner-approved): a fuller description, and the page's own share metadata so og:url is /verify rather
  // than the homepage inherited from the root layout. The robots rule and the verification itself are unchanged.
  const title = hasResult ? "Verification Result" : "Verify a Certificate";
  const description = "Check that a certificate issued by TERAS UNIVERSAL SDN. BHD. is authentic, using its QR verification code or certificate number.";
  return {
    title,
    description,
    alternates: { canonical: "/verify" },
    robots: hasResult ? { index: false, follow: false } : { index: true, follow: true },
    ...socialMetadata({ title: `${title} | TERAS UNIVERSAL`, description, path: "/verify" }),
  };
}

export default async function VerifyLandingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();

  let result: VerifyRow | null = null;
  let failure: "runtime" | undefined;
  let searched = false;
  if (query) {
    searched = true;
    const h = await headers();
    const ip = firstIp(h.get("x-forwarded-for") || h.get("x-real-ip"));
    const ua = h.get("user-agent");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("verify_and_log", { p_query: query, p_method: "auto", p_ip: ip, p_ua: ua });
    const normalized = normalizeVerificationRpcResponse<VerifyRow>(data, error);
    if (normalized.kind === "error") {
      // Never surface DB internals or the submitted value. Keep the reason
      // observable in server logs without collapsing it into a confirmed miss.
      console.error("verify_and_log response failed", { reason: normalized.reason, message: error?.message });
      failure = "runtime";
    }
    result = normalized.kind === "found" ? normalized.row : null;
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
        <p style={{ color: "#667085", fontSize: 12.5, textAlign: "center", margin: "6px 0 0" }}>
          Enter the certificate number (e.g. CERT-2026-000123) or the verification token, or scan the QR code on the certificate.
        </p>
      )}

      {searched && <VerificationResult result={result} failure={failure} />}
    </VerifyShell>
  );
}
