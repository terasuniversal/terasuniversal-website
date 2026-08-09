"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { analyzeImport, commitImport, type Analysis, type RawRow } from "./importActions";

function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const TEMPLATE = ["Participant ID", "Status", "Check-in", "Check-out", "Remarks"];

export function ImportClient({ scheduleId, sessionDate }: { scheduleId: string; sessionDate: string }) {
  const [raw, setRaw] = useState<RawRow[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [done, setDone] = useState<{ updated: number; skipped: number; message?: string } | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDone(null);
    const reader = new FileReader();
    reader.onload = () => { const rows = parseCsv(String(reader.result ?? "")); setRaw(rows); start(async () => setAnalysis(await analyzeImport(scheduleId, sessionDate, rows))); };
    reader.readAsText(file);
  }
  function downloadTemplate() {
    const blob = new Blob(["﻿" + TEMPLATE.join(",") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "attendance-import-template.csv"; a.click();
  }
  function doImport() { start(async () => { const r = await commitImport(scheduleId, sessionDate, raw); setDone(r); setAnalysis(null); setRaw([]); }); }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="ta-card ta-card-pad">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="ta-btn ta-btn-outline" onClick={downloadTemplate}>⬇ Download template</button>
          <label className="ta-btn ta-btn-primary" style={{ cursor: "pointer" }}>Choose CSV<input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} /></label>
          {pending && <span style={{ color: "var(--ta-muted)" }}>Processing…</span>}
        </div>
        <p style={{ color: "var(--ta-muted)", fontSize: 12, marginBottom: 0 }}>Columns: <strong>Participant ID, Status</strong> (present/absent/late/excused), Check-in, Check-out, Remarks. Only participants enrolled in this schedule are accepted, for the session date shown above.</p>
      </div>

      {done && (
        <div className={`ta-alert ${done.message ? "ta-alert-error" : "ta-alert-success"}`}>
          {done.message ? `Import failed: ${done.message}` : `Updated ${done.updated} attendance record(s). ${done.skipped} invalid row(s) skipped.`}{" "}
          <Link href={`/admin/attendance/${scheduleId}`} style={{ textDecoration: "underline" }}>Back to attendance →</Link>
        </div>
      )}

      {analysis && (
        <>
          <div className="ta-grid cols-3">
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value">{analysis.summary.total}</div><div className="ta-stat-label">Total rows</div></div>
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value" style={{ color: "var(--ta-success)" }}>{analysis.summary.ok}</div><div className="ta-stat-label">Valid</div></div>
            <div className="ta-card ta-card-pad ta-stat"><div className="ta-stat-value" style={{ color: "var(--ta-danger)" }}>{analysis.summary.invalid}</div><div className="ta-stat-label">Invalid (skip)</div></div>
          </div>
          <div className="ta-card">
            <div className="ta-card-head">
              <h3>Preview</h3>
              <button type="button" className="ta-btn ta-btn-primary" disabled={pending || analysis.summary.ok === 0} onClick={doImport}>{pending ? "Importing…" : `Import ${analysis.summary.ok} row(s)`}</button>
            </div>
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Row</th><th>Participant ID</th><th>Status</th><th>Result</th><th>Reason</th></tr></thead>
                <tbody>
                  {analysis.rows.map((r) => (
                    <tr key={r.index}>
                      <td>{r.index + 1}</td>
                      <td>{r.participant_id || "—"}</td>
                      <td>{r.data?.attendance_status ?? "—"}</td>
                      <td><span className={`ta-badge-pill ${r.status === "ok" ? "present" : "archived"}`}>{r.status}</span></td>
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
