"use client";

import { useState } from "react";

/**
 * CSV/Excel export as a client-side fetch + Blob download instead of a plain
 * <a href> navigation. Top-level document navigations to this Route Handler
 * return HTTP 503 on production (Vercel), while an identical same-origin
 * fetch() to the same URL reliably succeeds — this sidesteps that by never
 * issuing a document-mode navigation for the download.
 */
export function ExportButtons({ exportQs }: { exportQs: string }) {
  const [loading, setLoading] = useState<"csv" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "csv" | "excel") {
    setLoading(format);
    setError(null);
    try {
      const url = `/admin/certificates/export?format=${format}${exportQs ? "&" + exportQs : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}). Please try again.`);
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] ?? `certificate-register.${format === "excel" ? "xls" : "csv"}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => download("csv")} disabled={loading !== null}>
        {loading === "csv" ? "Exporting…" : "⬇ CSV"}
      </button>
      <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => download("excel")} disabled={loading !== null}>
        {loading === "excel" ? "Exporting…" : "⬇ Excel"}
      </button>
      {error && <span style={{ color: "var(--ta-danger)", fontSize: 12, fontWeight: 600 }}>{error}</span>}
    </>
  );
}
