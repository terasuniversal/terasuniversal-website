"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ReissueAction = (formData: FormData) => Promise<void>;
type SavedRequest = { key: string; eventType: "reissue" | "reprint"; reason: string };
const REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ReissueCertificateForm({ action, certificateId }: { action: ReissueAction; certificateId: string }) {
  const router = useRouter();
  const storageKey = `teras:certificate-reissue:${certificateId}`;
  const requestKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<"reissue" | "reprint">("reissue");
  const [reason, setReason] = useState("");
  const locked = pending || success || Boolean(error);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<SavedRequest>;
      if (!parsed.key || !REQUEST_KEY_PATTERN.test(parsed.key) || (parsed.eventType !== "reissue" && parsed.eventType !== "reprint") || typeof parsed.reason !== "string") return;
      requestKey.current = parsed.key;
      setEventType(parsed.eventType);
      setReason(parsed.reason);
      setError("A previous request may have completed. Retry this saved request to confirm its original event.");
    } catch {
      // Storage can be unavailable in restricted browser contexts; the form
      // still supports in-page retries with its in-memory request key.
    }
  }, [storageKey]);

  function startNewOperation() {
    requestKey.current = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Storage can be unavailable; the new operation still gets a fresh key.
    }
    setEventType("reissue");
    setReason("");
    setSuccess(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    submitting.current = true;
    setPending(true);
    setError(null);
    requestKey.current ??= crypto.randomUUID();
    const formData = new FormData(event.currentTarget);
    formData.set("idempotency_key", requestKey.current);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ key: requestKey.current, eventType, reason } satisfies SavedRequest));
    } catch {
      // Keep the in-memory key so a retry in this page instance remains safe.
    }

    try {
      await action(formData);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // A stale session entry is harmless; it can only replay this same key.
      }
      requestKey.current = null;
      setSuccess(true);
      router.refresh();
    } catch {
      // Keep this operation's key so a retry safely resolves to its original
      // event if the server committed but the response was lost.
      setError("Could not confirm the event was recorded. Retry to safely check this same request.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12 }}>Event
        <select name="event_type" value={eventType} onChange={(event) => setEventType(event.target.value as "reissue" | "reprint")} disabled={locked} style={{ display: "block", marginTop: 4 }}>
          <option value="reissue">Reissue</option>
          <option value="reprint">Reprint</option>
        </select>
      </label>
      <label style={{ fontSize: 12 }}>Reason
        <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} disabled={locked} style={{ display: "block", marginTop: 4 }} />
      </label>
      <button className="ta-btn ta-btn-gold" type="submit" disabled={pending || success}>
        {pending ? "Recording…" : "Record event"}
      </button>
      {success && <>
        <span role="status" style={{ color: "var(--ta-success, #16804a)", fontSize: 13 }}>Event recorded successfully.</span>
        <button className="ta-btn ta-btn-outline ta-btn-sm" type="button" onClick={startNewOperation}>Record another event</button>
      </>}
      {error && <span role="alert" style={{ color: "var(--ta-danger, #d64545)", fontSize: 13 }}>{error}</span>}
    </form>
  );
}
