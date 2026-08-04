/**
 * Public verification result card (server component, no client JS).
 * Renders ONLY publicly-safe fields returned by verify_and_log.
 */
export interface VerifyRow {
  found: boolean;
  certificate_number: string;
  holder_name: string;
  participant_code_masked: string | null;
  company: string | null;
  course_title: string | null;
  training_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  is_valid: boolean;
  verified_at: string;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : "—";

const CONTACT = "training@terasuniversal.com.my · +60 19-519 3834";

export function VerificationResult({ result }: { result: VerifyRow | null }) {
  // Not found / disabled → generic invalid message (no data leak).
  if (!result) {
    return (
      <div style={{ border: "2px solid #d64545", borderRadius: 12, padding: 20, background: "rgba(214,69,69,.06)", textAlign: "center" }}>
        <div style={{ fontSize: 26 }}>⚠️</div>
        <strong style={{ color: "#d64545", fontSize: 16 }}>Certificate Not Found</strong>
        <p style={{ color: "#667085", margin: "8px 0 0", fontSize: 13 }}>
          We couldn&apos;t verify this certificate. Please check the number/token and try again.
        </p>
        <p style={{ color: "#667085", margin: "10px 0 0", fontSize: 12 }}>
          For further verification, contact TERAS UNIVERSAL: {CONTACT}
        </p>
      </div>
    );
  }

  const valid = result.is_valid;
  const statusLabel =
    valid ? "Valid Certificate"
    : result.status === "revoked" ? "Certificate Revoked"
    : result.status === "expired" ? "Certificate Expired"
    : `Certificate ${result.status}`;
  const color = valid ? "#2e9e5b" : "#d64545";

  return (
    <div style={{ border: `2px solid ${color}`, borderRadius: 12, padding: 20, background: valid ? "rgba(46,158,91,.06)" : "rgba(214,69,69,.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>{valid ? "✅" : "⚠️"}</span>
        <strong style={{ color, fontSize: 16 }}>{statusLabel}</strong>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, margin: 0, fontSize: 14 }}>
        <dt style={{ color: "#667085" }}>Certificate No.</dt><dd style={{ margin: 0, fontFamily: "monospace" }}>{result.certificate_number}</dd>
        <dt style={{ color: "#667085" }}>Participant</dt><dd style={{ margin: 0, fontWeight: 600 }}>{result.holder_name}</dd>
        {result.participant_code_masked && (<><dt style={{ color: "#667085" }}>Participant ID</dt><dd style={{ margin: 0, fontFamily: "monospace" }}>{result.participant_code_masked}</dd></>)}
        {result.company && (<><dt style={{ color: "#667085" }}>Company</dt><dd style={{ margin: 0 }}>{result.company}</dd></>)}
        <dt style={{ color: "#667085" }}>Course</dt><dd style={{ margin: 0 }}>{result.course_title ?? "—"}</dd>
        {result.training_date && (<><dt style={{ color: "#667085" }}>Training Date</dt><dd style={{ margin: 0 }}>{fmt(result.training_date)}</dd></>)}
        <dt style={{ color: "#667085" }}>Issue Date</dt><dd style={{ margin: 0 }}>{fmt(result.issue_date)}</dd>
        {result.expiry_date && (<><dt style={{ color: "#667085" }}>Expiry Date</dt><dd style={{ margin: 0 }}>{fmt(result.expiry_date)}</dd></>)}
        <dt style={{ color: "#667085" }}>Verified</dt><dd style={{ margin: 0 }}>{new Date(result.verified_at).toLocaleString("en-MY")}</dd>
      </dl>

      {!valid && (
        <p style={{ color: "#667085", margin: "14px 0 0", fontSize: 12, borderTop: "1px solid rgba(214,69,69,.2)", paddingTop: 10 }}>
          This certificate is not currently valid. For further verification, contact TERAS UNIVERSAL: {CONTACT}
        </p>
      )}
    </div>
  );
}

/** Shared shell used by both verify pages. */
export function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "linear-gradient(135deg,#0B2C56,#09203f)", fontFamily: "var(--font-poppins), system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 540, background: "#fff", borderRadius: 16, padding: 34, boxShadow: "0 30px 70px rgba(0,0,0,.3)" }}>
        <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" style={{ width: 150, display: "block", margin: "0 auto 16px" }} />
        <h1 style={{ textAlign: "center", color: "#0B2C56", fontSize: 22, margin: "0 0 4px" }}>Certificate Verification</h1>
        <p style={{ textAlign: "center", color: "#667085", margin: "0 0 20px", fontSize: 13 }}>Verify a certificate issued by TERAS UNIVERSAL.</p>
        {children}
        <p style={{ textAlign: "center", color: "#98a2b3", fontSize: 12, marginTop: 22 }}>TERAS UNIVERSAL SDN. BHD. · Building Competence. Creating Opportunities.</p>
      </div>
    </main>
  );
}

/** IP + user-agent → passed to verify_and_log for the audit log. */
export function firstIp(forwarded: string | null): string | null {
  if (!forwarded) return null;
  return forwarded.split(",")[0].trim() || null;
}
