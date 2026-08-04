"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { analyzeImport, commitImport, type ImportAnalysis, type RawRow } from "./importActions";

/** Minimal, dependency-free CSV parser (handles quoted fields + commas/newlines). */
function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const TEMPLATE_HEADERS = [
  "Full Name", "IC / Passport", "Company", "Phone", "Email", "Nationality",
  "Position", "Gender", "Date of Birth", "Address", "Emergency Contact", "Emergency Phone",
];

export function ImportClient() {
  const [raw, setRaw] = useState<RawRow[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [done, setDone] = useState<{ inserted: number; skipped: number; message?: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [pending, startTransition] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    setAnalysis(null);
    setRaw([]);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Please choose a CSV file using the provided template.");
      e.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("The CSV file is too large. Maximum size is 5 MB.");
      e.target.value = "";
      return;
    }
    setDone(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ""));
      if (rows.length === 0) {
        setFileError("The file does not contain any participant rows.");
        return;
      }
      setRaw(rows);
      startTransition(async () => setAnalysis(await analyzeImport(rows)));
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = TEMPLATE_HEADERS.join(",") + "\n";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "teras-participant-import-template.csv";
    a.click();
  }

  function doImport() {
    startTransition(async () => {
      const result = await commitImport(raw);
      setDone(result);
      setAnalysis(null);
      setRaw([]);
    });
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="ta-card ta-card-pad">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="ta-btn ta-btn-outline" onClick={downloadTemplate}>⬇ Download CSV template</button>
          <label className="ta-btn ta-btn-primary" style={{ cursor: "pointer" }}>
            Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          {pending && <span style={{ color: "var(--ta-muted)" }}>Processing…</span>}
        </div>
        <p style={{ color: "var(--ta-muted)", fontSize: 12, marginBottom: 0 }}>
          Required columns: <strong>Full Name, IC / Passport, Company, Phone</strong>. Others optional.
          Duplicates (by IC / Passport) and invalid rows are skipped automatically.
        </p>
        {fileError && <div className="ta-alert ta-alert-error" role="alert">{fileError}</div>}
      </div>

      {done && (
        <div className={`ta-alert ${done.message ? "ta-alert-error" : "ta-alert-success"}`}>
          {done.message
            ? `Import failed: ${done.message}`
            : `Imported ${done.inserted} participant(s). ${done.skipped} row(s) skipped (invalid or duplicate).`}
          {" "}
          <Link href="/admin/participants" style={{ textDecoration: "underline" }}>View participants →</Link>
        </div>
      )}

      {analysis && (
        <>
          <div className="ta-grid cols-4">
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value">{analysis.summary.total}</div><div className="ta-stat-label">Total rows</div></div>
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value" style={{ color: "var(--ta-success)" }}>{analysis.summary.ok}</div><div className="ta-stat-label">Ready to import</div></div>
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value" style={{ color: "#a9791a" }}>{analysis.summary.duplicate}</div><div className="ta-stat-label">Duplicates (skip)</div></div>
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value" style={{ color: "var(--ta-danger)" }}>{analysis.summary.invalid}</div><div className="ta-stat-label">Invalid (skip)</div></div>
          </div>

          <div className="ta-card">
            <div className="ta-card-head">
              <h3>Preview</h3>
              <button type="button" className="ta-btn ta-btn-primary" disabled={pending || analysis.summary.ok === 0} onClick={doImport}>
                {pending ? "Importing…" : `Import ${analysis.summary.ok} participant(s)`}
              </button>
            </div>
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Row</th><th>Status</th><th>Name</th><th>IC / Passport</th><th>Company</th><th>Reason</th></tr></thead>
                <tbody>
                  {analysis.rows.map((r) => (
                    <tr key={r.index}>
                      <td>{r.index + 1}</td>
                      <td><span className={`ta-badge-pill ${r.status === "ok" ? "published" : r.status === "duplicate" ? "scheduled" : "archived"}`}>{r.status}</span></td>
                      <td>{r.data?.full_name ?? "—"}</td>
                      <td>{r.data?.ic_passport_no ?? "—"}</td>
                      <td>{r.data?.company ?? "—"}</td>
                      <td style={{ color: "var(--ta-muted)" }}>{r.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
