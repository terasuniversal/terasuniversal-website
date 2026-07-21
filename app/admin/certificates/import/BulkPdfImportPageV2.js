"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadCsv, extractCertificate, validateRows } from "../../../../lib/bulkCertificates";

function normaliseCertificate(value) {
  return String(value || "").toUpperCase().replace(/[.\-\/\\\s]/g, "");
}

export default function BulkPdfImportPageV2() {
  const [session, setSession] = useState(null);
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [useOcr, setUseOcr] = useState(true);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const ready = useMemo(() => rows.filter((row) => row.parse_status === "ready"), [rows]);

  useEffect(() => {
    try { setSession(JSON.parse(window.sessionStorage.getItem("teras_admin_session") || "null")); } catch { setSession(null); }
  }, []);

  async function request(body, method = "POST") {
    if (!session?.access_token) throw new Error("Log masuk di halaman admin dahulu.");
    const response = await fetch("/api/admin/certificates", { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Permintaan tidak berjaya.");
    return result;
  }

  async function processFiles() {
    setProcessing(true); setProgress(0); setError(""); setMessage("");
    try {
      const parsed = [];
      for (let index = 0; index < files.length; index += 1) {
        parsed.push(await extractCertificate(files[index], { useOcr, onProgress: (part) => setProgress(Math.round(((index + part) / files.length) * 100)) }));
        setProgress(Math.round(((index + 1) / files.length) * 100));
      }
      const checked = validateRows(parsed);
      const existing = await request({}, "GET");
      const existingNumbers = new Map((existing.rows || []).map((row) => [normaliseCertificate(row.certificate_no), row]));
      setRows(checked.map((row) => {
        const match = existingNumbers.get(normaliseCertificate(row.certificate_no));
        return match ? { ...row, parse_status: "needs_review", error_message: "No. sijil sudah wujud (" + (match.participant_name || row.certificate_no) + ")" } : row;
      }));
      setMessage(parsed.length + " PDF selesai diproses. Rekod berganda ditanda untuk semakan.");
    } catch (err) { setError(err.message || "PDF tidak dapat diproses."); }
    finally { setProcessing(false); }
  }

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value, parse_status: "ready", error_message: "" } : row));
  }

  async function importRows() {
    if (!ready.length || !window.confirm("Import " + ready.length + " rekod PDF ke database?")) return;
    setProcessing(true); setError("");
    try {
      const result = await request({ action: "bulk", source: "pdf", source_count: rows.length, rows: ready });
      await request({ action: "log", source: "pdf", source_count: rows.length, row_count: rows.length, imported_count: result.imported || 0, skipped_count: rows.length - ready.length, error_count: result.failed || 0, status: result.failed ? (result.imported ? "partial" : "failed") : "completed", errors: result.errors || [] });
      setMessage((result.imported || 0) + " rekod berjaya diimport" + (result.failed ? ", " + result.failed + " rekod gagal." : ". Log audit telah disimpan."));
      if (result.errors?.length) setError(result.errors.slice(0, 3).join(" "));
      setRows(rows.filter((row) => !ready.includes(row)));
    } catch (err) { setError(err.message); }
    finally { setProcessing(false); }
  }

  return <main className="admin-page"><div className="container"><a className="admin-back-link" href="/admin/certificates">← Kembali ke Certificate Management</a><div className="admin-topbar"><div><span className="eyebrow">BULK PDF IMPORT</span><h1>Import banyak PDF sijil</h1><p>Ekstrak, semak dan import rekod peserta secara pukal.</p></div><a className="btn btn-outline" href="/verify">Public verification</a></div>{message && <p className="admin-success">{message}</p>}{error && <p className="verify-error" role="alert">{error}</p>}<section className="admin-panel admin-pdf-panel"><div className="admin-pdf-controls"><input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { setFiles(Array.from(event.target.files || [])); setRows([]); }} disabled={processing} /><label className="admin-check"><input type="checkbox" checked={useOcr} onChange={(event) => setUseOcr(event.target.checked)} /> OCR untuk PDF scan</label><button className="btn btn-primary" type="button" onClick={processFiles} disabled={!files.length || processing}>{processing ? "Memproses " + progress + "%…" : "Proses " + (files.length || "") + " PDF"}</button>{rows.length > 0 && <><button className="btn btn-outline" type="button" onClick={() => downloadCsv(rows)}>Muat turun CSV</button><button className="btn btn-primary" type="button" onClick={importRows} disabled={!ready.length || processing}>Import {ready.length} rekod</button></>}</div><p className="admin-bulk-summary"><strong>{ready.length} sedia</strong> · {rows.length - ready.length} perlu semakan · Data sensitif kekal di browser sehingga import disahkan.</p>{rows.length > 0 && <div className="admin-table-wrap admin-bulk-table-wrap"><table><thead><tr><th>Fail</th><th>Nama peserta</th><th>No. sijil</th><th>Kursus</th><th>Tarikh</th><th>Status</th></tr></thead><tbody>{rows.map((row, index) => <tr className={row.parse_status !== "ready" ? "admin-bulk-review" : ""} key={row.source_file + "-" + index}><td title={row.error_message || row.source_file}>{row.source_file}</td><td><input value={row.participant_name} onChange={(event) => updateRow(index, "participant_name", event.target.value)} /></td><td><input value={row.certificate_no} onChange={(event) => updateRow(index, "certificate_no", event.target.value)} /></td><td><input value={row.course_name} onChange={(event) => updateRow(index, "course_name", event.target.value)} /></td><td><input type="date" value={row.course_date} onChange={(event) => updateRow(index, "course_date", event.target.value)} /></td><td><span className={"admin-status admin-status-" + row.parse_status}>{row.parse_status === "ready" ? "Sedia" : "Semak"}</span><small>{row.error_message}</small></td></tr>)}</tbody></table></div>}</section></div></main>;
}
