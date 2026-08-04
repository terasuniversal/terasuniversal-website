"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Admin route error", error); }, [error]);
  return <section className="ta-card ta-card-pad" role="alert" style={{ maxWidth: 620, margin: "32px auto", textAlign: "center" }}>
    <div style={{ fontSize: 34 }} aria-hidden="true">⚠️</div>
    <h1 style={{ marginBottom: 8 }}>This admin page could not be loaded</h1>
    <p style={{ color: "var(--ta-muted)" }}>Your work has not been changed. Try again; if the problem continues, contact a system administrator with the time of this error.</p>
    <button type="button" className="ta-btn ta-btn-primary" onClick={reset}>Try again</button>
  </section>;
}
