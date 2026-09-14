"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";

type ActionResult = { ok: true; certificateId?: string } | void;
type CertificateAction = (formData: FormData) => Promise<ActionResult>;

type Props = {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  action: CertificateAction;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  danger?: boolean;
  redirectOnSuccess?: boolean;
};

export function CertificateActionDialog({
  label,
  title,
  description,
  confirmLabel,
  action,
  reasonLabel,
  reasonRequired = false,
  reasonPlaceholder,
  danger = false,
  redirectOnSuccess = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const reason = String(formData.get("reason") ?? "").trim();
    if (reasonRequired && !reason) {
      setError("Please provide a reason before continuing.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (redirectOnSuccess && result && "certificateId" in result && result.certificateId) {
          window.location.assign(`/admin/certificates/${result.certificateId}`);
          return;
        }
        dialogRef.current?.close();
        window.location.reload();
      } catch {
        setError("The action could not be completed. No change was applied.");
      }
    });
  }

  return (
    <>
      <button className={`ta-btn ${danger ? "ta-btn-danger" : "ta-btn-outline"}`} type="button" onClick={open}>
        {label}
      </button>
      <dialog ref={dialogRef} aria-labelledby={`${label}-dialog-title`} style={{ maxWidth: 520, width: "calc(100% - 32px)", border: 0, borderRadius: 12, padding: 0, boxShadow: "0 24px 80px rgba(0,0,0,.28)" }}>
        <form onSubmit={submit} style={{ padding: 24 }}>
          <h2 id={`${label}-dialog-title`} style={{ margin: "0 0 10px", color: "var(--ta-navy, #0b1f3a)", fontSize: 20 }}>{title}</h2>
          <p style={{ margin: "0 0 18px", color: "var(--ta-muted, #667085)", lineHeight: 1.55 }}>{description}</p>
          {reasonLabel && (
            <label style={{ display: "grid", gap: 6, marginBottom: 16, fontSize: 13 }}>
              <span>{reasonLabel}{reasonRequired && <span className="ta-req" aria-hidden="true"> *</span>}</span>
              <textarea name="reason" required={reasonRequired} maxLength={500} placeholder={reasonPlaceholder} rows={3} style={{ width: "100%", boxSizing: "border-box" }} />
            </label>
          )}
          {error && <p role="alert" style={{ margin: "0 0 14px", color: "var(--ta-danger, #d64545)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="ta-btn ta-btn-outline" type="button" onClick={close} disabled={pending}>Cancel</button>
            <button className={`ta-btn ${danger ? "ta-btn-danger" : "ta-btn-primary"}`} type="submit" disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
