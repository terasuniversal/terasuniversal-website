"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("Unhandled root layout error", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, Helvetica, sans-serif", background: "#f4f7fb", color: "#202733" }}>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", textAlign: "center" }}>
          <div style={{ maxWidth: "480px" }}>
            <h1 style={{ color: "#0B2C56", fontSize: "28px", marginBottom: "12px" }}>TERAS UNIVERSAL</h1>
            <p style={{ color: "#687386", marginBottom: "24px" }}>Something went wrong loading this page. Please try again, or return to the homepage.</p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: "12px 20px", borderRadius: "10px", border: "1px solid #0a3d91", background: "#0a3d91", color: "#fff", fontWeight: 700, cursor: "pointer", marginRight: "10px" }}
            >
              Try Again
            </button>
            <a href="/" style={{ padding: "12px 20px", borderRadius: "10px", border: "1px solid #0a3d91", color: "#0a3d91", fontWeight: 700, textDecoration: "none", display: "inline-block" }}>
              Return Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
