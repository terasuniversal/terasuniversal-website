import Link from "next/link";

export const metadata = { title: "No access — TERAS UNIVERSAL Admin" };

export default function NoAccessPage() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: 24 }}>
      <div className="ta-card ta-card-pad" style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 40 }} aria-hidden="true">
          🔒
        </div>
        <h1 style={{ fontSize: 22, margin: "10px 0" }}>Insufficient permissions</h1>
        <p style={{ color: "var(--ta-muted)" }}>
          Your role doesn&apos;t have access to that section. If you believe this is a
          mistake, contact a Super Admin.
        </p>
        <Link href="/admin/dashboard" className="ta-btn ta-btn-primary" style={{ marginTop: 14 }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
