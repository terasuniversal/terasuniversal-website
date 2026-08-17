"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface FeedbackLinkRow {
  id: string;
  participantName: string;
  participantCode: string | null;
  company: string | null;
  status: string;
  url: string;
}

export function FeedbackLinkCard({ links, baseUrl }: { links: FeedbackLinkRow[]; baseUrl: string }) {
  const [selectedLink, setSelectedLink] = useState<FeedbackLinkRow | null>(null);
  const [qrLabel, setQrLabel] = useState("");
  const [qrData, setQrData] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);

  async function showQr(row: FeedbackLinkRow) {
    const data = await QRCode.toDataURL(row.url, { width: 240, margin: 1 });
    setQrLabel(`${row.participantName} — ${row.participantCode ?? ""}`.trim());
    setSelectedLink(row);
    setQrData(data);
  }

  function closeQr() {
    setSelectedLink(null);
    setQrData("");
  }

  useEffect(() => {
    if (!selectedLink) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQr();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedLink]);

  async function copy(row: FeedbackLinkRow) {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopied(row.id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable — fall back to nothing
    }
  }

  return (
    <>
      <div className="ta-table-wrap">
        <table className="ta-table">
          <thead>
            <tr>
              <th>Participant</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.participantName}</strong>
                  <div className="ta-lead-sub">{row.participantCode ?? ""}{row.company ? ` · ${row.company}` : ""}</div>
                </td>
                <td>
                  <span className={`ta-fb-pill ta-fb-action ${row.status}`}>{row.status === "submitted" ? "Submitted" : "Pending"}</span>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => copy(row)}>{copied === row.id ? "Copied ✓" : "Copy Link"}</button>{" "}
                  <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => showQr(row)}>Show QR</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedLink && (
        <div className="ta-dialog-overlay" onClick={closeQr}>
          <div className="ta-dialog" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Feedback QR code">
            <div className="ta-dialog-head">
              <h3>Feedback QR</h3>
              <button className="ta-dialog-close" onClick={closeQr} aria-label="Close">×</button>
            </div>
            <div className="ta-dialog-body" style={{ textAlign: "center" }}>
              <img src={qrData} alt={`QR code for ${qrLabel}`} width={240} height={240} />
              <p style={{ margin: "10px 0 4px", fontWeight: 700, color: "var(--ta-navy)" }}>{qrLabel}</p>
              <p className="ta-lead-sub" style={{ wordBreak: "break-all" }}>{selectedLink.url}</p>
            </div>
            <div className="ta-dialog-foot">
              <button className="ta-btn ta-btn-primary ta-btn-sm" onClick={() => copy(selectedLink)}>Copy Link</button>
              <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={closeQr}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
