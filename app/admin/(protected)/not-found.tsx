import Link from "next/link";

export default function AdminNotFound() {
  return <section className="ta-card ta-card-pad" style={{ maxWidth: 620, margin: "32px auto", textAlign: "center" }}>
    <div style={{ fontSize: 34 }} aria-hidden="true">🔎</div>
    <h1 style={{ marginBottom: 8 }}>Page not found</h1>
    <p style={{ color: "var(--ta-muted)" }}>The item may have been moved, deleted, or you may not have access to it.</p>
    <Link href="/admin/dashboard" className="ta-btn ta-btn-primary">Return to dashboard</Link>
  </section>;
}
