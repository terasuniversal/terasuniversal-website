"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import QRCode from "qrcode";
import { getOrCreateClassFeedbackLink } from "../actions";

interface Props {
  scheduleId: string;
  courseName: string;
  scheduleCode: string;
  baseUrl: string;
  initialPublicToken: string | null;
}

export function ClassFeedbackQrCard({ scheduleId, courseName, scheduleCode, baseUrl, initialPublicToken }: Props) {
  const [publicToken, setPublicToken] = useState(initialPublicToken);
  const [open, setOpen] = useState(false);
  const [qrData, setQrData] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [isPending, startTransition] = useTransition();
  const url = publicToken ? `${baseUrl}${publicToken}` : "";

  useEffect(() => {
    if (!open || !url) return;
    let active = true;
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then((data) => {
      if (active) setQrData(data);
    });
    return () => { active = false; };
  }, [open, url]);

  useEffect(() => {
    if (!open || !qrData || !printRequested) return;
    setPrintRequested(false);
    window.print();
  }, [open, printRequested, qrData]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = useMemo(() => `${courseName} — ${scheduleCode}`, [courseName, scheduleCode]);

  function showOrGenerate() {
    setMessage("");
    if (publicToken) {
      setOpen(true);
      return;
    }
    startTransition(async () => {
      const result = await getOrCreateClassFeedbackLink(scheduleId);
      if (!result.ok || !result.publicToken) {
        setMessage(result.message ?? "Unable to prepare the class feedback link.");
        return;
      }
      setPublicToken(result.publicToken);
      setOpen(true);
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("Copy is unavailable in this browser.");
    }
  }

  function openPrintDialog() {
    setPrintRequested(true);
    setOpen(true);
  }

  return (
    <section className="ta-card ta-class-feedback-card" style={{ marginBottom: 22 }}>
      <div className="ta-card-pad">
        <p className="ta-card-eyebrow">Class Feedback QR</p>
        <h2>One QR for this training schedule</h2>
        <p className="ta-lead-sub">Participants scan the QR and enter their IC/Passport number to open only their own feedback form.</p>
        {message && <p className="ta-alert ta-alert-error" role="alert">{message}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <button className="ta-btn ta-btn-primary" onClick={showOrGenerate} disabled={isPending}>
            {isPending ? "Preparing…" : publicToken ? "Show Class QR" : "Generate Class Feedback QR"}
          </button>
          {publicToken && <button className="ta-btn ta-btn-outline" onClick={copyLink}>{copied ? "Copied ✓" : "Copy Class Link"}</button>}
          {publicToken && <button className="ta-btn ta-btn-outline" onClick={openPrintDialog}>Print QR</button>}
        </div>
      </div>

      {open && publicToken && (
        <div className="ta-dialog-overlay" onClick={() => setOpen(false)}>
          <div className="ta-dialog ta-class-feedback-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Class feedback QR code">
            <div className="ta-dialog-head">
              <h3>Class Feedback QR</h3>
              <button className="ta-dialog-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="ta-dialog-body ta-class-feedback-print" style={{ textAlign: "center" }}>
              <p className="ta-card-eyebrow">TERAS UNIVERSAL</p>
              <h4>Participant Feedback</h4>
              <p><strong>Programme:</strong> {courseName}</p>
              <p><strong>Schedule:</strong> {scheduleCode}</p>
              {qrData && <img src={qrData} alt={`Class feedback QR for ${label}`} width={320} height={320} />}
              <p>Scan and enter your IC/Passport number to submit feedback.</p>
              <p className="ta-lead-sub" style={{ overflowWrap: "anywhere" }}>{url}</p>
              <p className="ta-lead-sub">Building Competence. Creating Opportunities.</p>
            </div>
            <div className="ta-dialog-foot">
              <button className="ta-btn ta-btn-primary ta-btn-sm" onClick={copyLink}>{copied ? "Copied ✓" : "Copy Link"}</button>
              <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={openPrintDialog}>Print QR</button>
              <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
