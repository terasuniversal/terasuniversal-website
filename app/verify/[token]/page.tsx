import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { VerificationResult, VerifyShell, firstIp, type VerifyRow } from "../VerificationResult";

export const dynamic = "force-dynamic";

// Result pages are never indexed.
export const metadata = {
  title: "Verification Result | TERAS UNIVERSAL",
  description: "Certificate verification result.",
  robots: { index: false, follow: false },
};

/**
 * QR target: /verify/{verification_token}. Verifies by token (falls back to
 * auto so a certificate number pasted into the URL also resolves) and logs
 * the attempt with IP + user-agent.
 */
export default async function VerifyTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = firstIp(h.get("x-forwarded-for") || h.get("x-real-ip"));
  const ua = h.get("user-agent");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("verify_and_log", { p_query: token, p_method: "auto", p_ip: ip, p_ua: ua });
  const result: VerifyRow | null = data && data.length > 0 ? (data[0] as VerifyRow) : null;

  return (
    <VerifyShell>
      <VerificationResult result={result} />
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <a href="/verify" style={{ color: "#0B2C56", fontSize: 13, textDecoration: "underline" }}>Verify another certificate</a>
      </p>
    </VerifyShell>
  );
}
