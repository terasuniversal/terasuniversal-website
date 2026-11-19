import { GENERIC_RETURN_VIEW } from "../../../../lib/payments/toyyibpay-return-view";

export const metadata = { title: "Payment Service Return — TERAS UNIVERSAL", robots: { index: false, follow: false } };

/**
 * Public invoice payment return page. DISPLAY-ONLY since ToyyibPay R2 (PAY-02), GENERIC since R4 Wave 1 (R4-2), wording
 * and <main> landmark fixed in Public-First G-2: it reads no query parameter, queries no table, calls no RPC and never
 * contacts ToyyibPay. Every visitor sees the same message whatever the URL contains, so the page cannot finalise,
 * mutate or disclose anything -- including whether a given attempt id exists. See lib/payments/toyyibpay-return-view.ts.
 */
export default function ToyyibpayReturnPage() {
  const view = GENERIC_RETURN_VIEW;
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", padding: 16 }}>
      <div style={{ maxWidth: 440, width: "100%", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.1)", padding: 32, textAlign: "center" }}>
        <p style={{ display: "inline-block", background: "#f1f5f9", color: "#475569", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, borderRadius: 999, padding: "6px 14px", margin: "0 0 16px" }}>
          {view.label.toUpperCase()}
        </p>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: "#1a2233", margin: "0 0 8px" }}>{view.heading}</h1>
        <p style={{ fontSize: 15, color: "#1a2233", lineHeight: 1.6, margin: 0 }}>{view.message}</p>
        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: "12px 0 0" }}>{view.followUp}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <a href="/contact" style={{ display: "inline-block", fontSize: 13, fontWeight: 700, color: "#fff", background: "#0b3a63", textDecoration: "none", borderRadius: 8, padding: "9px 16px" }}>
            Contact TERAS
          </a>
          <a href="/" style={{ display: "inline-block", fontSize: 13, fontWeight: 700, color: "#0b3a63", textDecoration: "none", border: "1px solid #d7dde5", borderRadius: 8, padding: "8px 16px" }}>
            Return to TERAS UNIVERSAL
          </a>
        </div>
      </div>
    </main>
  );
}
