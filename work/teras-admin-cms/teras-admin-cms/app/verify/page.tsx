import { createSupabaseServerClient } from "../../lib/supabase/server";

export const metadata = {
  title: "Verify a Certificate | TERAS UNIVERSAL",
  description: "Confirm the authenticity of a TERAS UNIVERSAL training certificate.",
};
export const dynamic = "force-dynamic";

/**
 * PUBLIC certificate verification. No authentication. Calls the
 * verify_certificate RPC (SECURITY DEFINER) which returns only safe fields
 * for issued/expired/revoked certificates. This is a NEW standalone public
 * page — it does not touch the existing website design.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  let result: any = null;
  let notFound = false;

  if (code && code.trim()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc("verify_certificate", { code: code.trim() });
    result = data && data.length > 0 ? data[0] : null;
    notFound = !result;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(135deg,#0B2C56,#09203f)",
        fontFamily: "var(--font-poppins), system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 16, padding: 34, boxShadow: "0 30px 70px rgba(0,0,0,.3)" }}>
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" style={{ width: 150, display: "block", margin: "0 auto 18px" }} />
        <h1 style={{ textAlign: "center", color: "#0B2C56", fontSize: 22, margin: "0 0 4px" }}>Certificate Verification</h1>
        <p style={{ textAlign: "center", color: "#667085", margin: "0 0 22px", fontSize: 14 }}>
          Enter the verification code printed on the certificate.
        </p>

        <form method="get" style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          <input
            name="code"
            defaultValue={code ?? ""}
            placeholder="e.g. 8F3A9C2B4D1E"
            required
            style={{ flex: 1, padding: "12px 14px", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: 15, textTransform: "uppercase" }}
          />
          <button type="submit" style={{ padding: "12px 20px", background: "#E1A925", color: "#0B2C56", border: 0, borderRadius: 10, fontWeight: 800, cursor: "pointer" }}>
            Verify
          </button>
        </form>

        {result && (
          <div
            style={{
              border: `2px solid ${result.is_valid ? "#2e9e5b" : "#d64545"}`,
              borderRadius: 12,
              padding: 20,
              background: result.is_valid ? "rgba(46,158,91,.06)" : "rgba(214,69,69,.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>{result.is_valid ? "✅" : "⚠️"}</span>
              <strong style={{ color: result.is_valid ? "#2e9e5b" : "#d64545", fontSize: 16 }}>
                {result.is_valid ? "Valid Certificate" : `Certificate ${result.status}`}
              </strong>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, margin: 0, fontSize: 14 }}>
              <dt style={{ color: "#667085" }}>Holder</dt><dd style={{ margin: 0, fontWeight: 600 }}>{result.holder_name}</dd>
              <dt style={{ color: "#667085" }}>Course</dt><dd style={{ margin: 0 }}>{result.course_title ?? "—"}</dd>
              <dt style={{ color: "#667085" }}>Issued</dt><dd style={{ margin: 0 }}>{result.issued_at ? new Date(result.issued_at).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : "—"}</dd>
              {result.expires_at && (<><dt style={{ color: "#667085" }}>Expires</dt><dd style={{ margin: 0 }}>{new Date(result.expires_at).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" })}</dd></>)}
            </dl>
          </div>
        )}

        {notFound && (
          <div style={{ border: "2px solid #d64545", borderRadius: 12, padding: 18, background: "rgba(214,69,69,.06)", textAlign: "center" }}>
            <strong style={{ color: "#d64545" }}>No certificate found</strong>
            <p style={{ color: "#667085", margin: "6px 0 0", fontSize: 13 }}>
              Check the code and try again, or contact TERAS UNIVERSAL if you believe this is an error.
            </p>
          </div>
        )}

        <p style={{ textAlign: "center", color: "#98a2b3", fontSize: 12, marginTop: 22 }}>
          TERAS UNIVERSAL SDN. BHD. · Building Competence. Creating Opportunities.
        </p>
      </div>
    </main>
  );
}
