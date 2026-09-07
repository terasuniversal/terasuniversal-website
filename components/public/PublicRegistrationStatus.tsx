"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = {
  registration_reference: string;
  course_title: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  training_mode: string | null;
  registration_status: string;
  payment_status: string;
  attendee_count: number;
  amount: number;
  currency: string;
  hold_expires_at: string | null;
};

const activeKey = (reference: string | null) => Object.keys(sessionStorage).find((key) => {
  if (!key.startsWith("teras.registration.")) return false;
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    return reference ? stored?.reference === reference : true;
  } catch {
    return false;
  }
});

const formatDate = (value: string) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const money = (value: number, currency: string) => new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(value);
const terminalRegistrationStates = ["confirmed", "cancelled", "expired"];

export default function PublicRegistrationStatus({ reference: initialReference }: { reference?: string } = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [reference, setReference] = useState(initialReference || "");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const load = async (poll = false) => {
    if (typeof window === "undefined") return;
    try {
      const key = activeKey(reference || null);
      const stored = key ? JSON.parse(sessionStorage.getItem(key) || "null") : null;
      const ref = reference || stored?.reference || "";
      const token = secret || stored?.secret || "";
      if (!ref || !token) {
        setLoading(false);
        setError("Open this page from the same browser used for registration, or contact TERAS with your reference.");
        return;
      }
      setReference(ref);
      setSecret(token);
      const response = await fetch("/api/registration/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration_reference: ref, registration_secret: token }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 429 ? "Please wait a moment before checking again." : body.error || "We could not verify that registration.");
      const nextStatus = body.registration as Status;
      setStatus(nextStatus);
      setError("");
      setNotice("");
      if (terminalRegistrationStates.includes(nextStatus.registration_status) && key) {
        sessionStorage.setItem(key, JSON.stringify({ reference: ref }));
        setSecret("");
      }
      if (poll && !terminalRegistrationStates.includes(nextStatus.registration_status) && attempts < 5) window.setTimeout(() => setAttempts((value) => value + 1), 5000);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "We could not verify that registration.");
    } finally {
      setLoading(false);
    }
  };

  const retryPayment = async () => {
    if (!reference || !secret) {
      setError("Open this page from the same browser used for registration, or contact TERAS with your reference.");
      return;
    }
    setRetrying(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/registration/payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration_reference: reference, registration_secret: secret, provider: "toyyibpay" }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 202) { setNotice("Payment setup is still in progress. Please wait a moment and refresh this page."); return; }
      if (!response.ok) throw new Error(response.status === 429 ? "Please wait a moment before trying again." : body.error || "We could not restart payment.");
      if (!body.payment_url || !/^https:\/\//i.test(body.payment_url)) throw new Error("TERAS could not provide a secure payment link.");
      window.location.assign(body.payment_url);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "We could not restart payment. Please contact TERAS.");
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => { void load(true); }, [attempts]);

  if (loading) return <main className="registration-status-page"><div className="registration-status-card" role="status"><span className="eyebrow">TERAS UNIVERSAL</span><h1>Checking your registration…</h1><p>We are checking the latest server-verified payment status.</p></div></main>;

  const terminal = status && terminalRegistrationStates.includes(status.registration_status);
  const failed = status?.registration_status === "failed" || status?.payment_status === "failed";
  const supportHref = status ? `https://wa.me/60195193834?text=Hi%20TERAS%2C%20I%20need%20help%20with%20registration%20reference%20${encodeURIComponent(status.registration_reference)}.` : "https://wa.me/60195193834";

  return <main className="registration-status-page"><div className="registration-status-card"><span className="eyebrow">TERAS UNIVERSAL</span>{status ? <>
    <div className={`registration-status-mark is-${status.registration_status}`} aria-hidden="true">{status.registration_status === "confirmed" ? "✓" : "i"}</div>
    <h1>{status.registration_status === "confirmed" ? "Registration confirmed" : status.registration_status === "expired" ? "Registration hold expired" : status.registration_status === "cancelled" ? "Registration cancelled" : failed ? "Payment unsuccessful" : "Payment is being verified"}</h1>
    <p className="registration-reference">Reference: {status.registration_reference}</p>
    <dl className="registration-summary"><div><dt>Programme</dt><dd>{status.course_title}</dd></div><div><dt>Training date</dt><dd>{formatDate(status.start_date)}{status.end_date !== status.start_date ? ` – ${formatDate(status.end_date)}` : ""}</dd></div><div><dt>Location</dt><dd>{[status.training_mode, status.venue].filter(Boolean).join(" · ") || "To be confirmed"}</dd></div><div><dt>Payment status</dt><dd>{status.payment_status}</dd></div><div><dt>Total</dt><dd>{money(Number(status.amount), status.currency)}</dd></div></dl>
    <p>{status.registration_status === "confirmed" ? "Your place has been confirmed. TERAS will share the next training information with you." : status.registration_status === "expired" ? "The temporary payment hold has ended. Please return to the calendar to select an available session." : status.registration_status === "cancelled" ? "This registration is no longer active. Please contact TERAS if you need assistance." : failed ? "The payment was not completed. You may try again while your temporary registration hold remains active, or contact TERAS for assistance." : "Your registration has been received. Payment is confirmed only after server-side verification."}</p>
    {status.registration_status === "expired" || status.registration_status === "cancelled" ? <><Link className="btn btn-primary" href="/calendar">Choose another session</Link><a className="btn btn-outline" href={supportHref} target="_blank" rel="noreferrer">Contact TERAS on WhatsApp</a></> : failed ? <><button className="btn btn-primary" type="button" onClick={() => void retryPayment()} disabled={retrying || !secret}>{retrying ? "Preparing payment…" : "Try Payment Again"}</button><a className="btn btn-outline" href={supportHref} target="_blank" rel="noreferrer">Contact TERAS on WhatsApp</a></> : status.registration_status === "confirmed" ? <a className="btn btn-primary" href={supportHref} target="_blank" rel="noreferrer">Contact TERAS on WhatsApp</a> : <><button className="btn btn-outline" type="button" onClick={() => void load(false)} disabled={Boolean(!terminal && attempts >= 5)}>Refresh status</button><a className="btn btn-primary" href={supportHref} target="_blank" rel="noreferrer">Contact TERAS on WhatsApp</a></>}
    {notice && <p className="registration-alert" role="status">{notice}</p>}{error && <p className="registration-alert" role="alert">{error}</p>}
  </> : <><h1>Registration status</h1><p role="alert">{error || "We could not find an active registration in this browser."}</p><Link className="btn btn-primary" href="/calendar">Return to training calendar</Link></>}</div></main>;
}
