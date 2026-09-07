"use client";

import Link from "next/link";
import { useState } from "react";
import { generateRegistrationSecret } from "../../lib/public-registration";
import type { PublicRegistrationSchedule } from "../../lib/public-content";

type Attendee = { full_name: string; ic_passport_no: string; email: string; phone: string; company: string };
type RegistrationResult = { registration_reference: string; registration_status: string; payment_status: string; amount: number; currency: string; hold_expires_at?: string | null };
const emptyAttendee = (): Attendee => ({ full_name: "", ic_passport_no: "", email: "", phone: "", company: "" });
const storageKey = (scheduleId: string) => `teras.registration.${scheduleId}`;
const money = (value: number | null | undefined) => value == null ? "To be confirmed" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
const friendlyError = (status: number, body: any) => status === 429 ? "Please wait a moment and try again." : body?.error || "We could not complete your registration. Please try again or contact TERAS.";

function readSession(scheduleId: string) {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.sessionStorage.getItem(storageKey(scheduleId)) || "null"); } catch { return null; }
}
function writeSession(scheduleId: string, value: Record<string, string>) {
  try { window.sessionStorage.setItem(storageKey(scheduleId), JSON.stringify(value)); } catch { /* private browsing may deny storage; in-memory state still works */ }
}

export default function PublicRegistrationFlow({ schedule }: { schedule: PublicRegistrationSchedule }) {
  const [step, setStep] = useState<"details" | "review" | "payment">("details");
  const [attendees, setAttendees] = useState<Attendee[]>([emptyAttendee()]);
  const [session, setSession] = useState(() => readSession(schedule.schedule_id));
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [method, setMethod] = useState<"toyyibpay" | "bank_transfer">("toyyibpay");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const total = result?.amount ?? null;
  const perPax = total == null || !attendees.length ? null : total / attendees.length;
  const unavailable = !schedule.registration_available || schedule.fee == null || schedule.available_seats < 1;
  const updateAttendee = (index: number, field: keyof Attendee, value: string) => setAttendees((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));

  const validate = () => {
    const invalid = attendees.findIndex((attendee) => !attendee.full_name.trim() || !attendee.email.trim() || !attendee.phone.trim());
    if (invalid >= 0) { setError(`Please complete the name, email and phone for attendee ${invalid + 1}.`); return false; }
    if (attendees.some((attendee) => !/^\S+@\S+\.\S+$/.test(attendee.email.trim()))) { setError("Please enter a valid email address for each attendee."); return false; }
    return true;
  };

  const submitRegistration = async () => {
    if (!validate()) return;
    setBusy(true); setError("");
    const current = session || { secret: generateRegistrationSecret(), idempotencyKey: crypto.randomUUID() };
    setSession(current); writeSession(schedule.schedule_id, current);
    try {
      const response = await fetch("/api/registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule_id: schedule.schedule_id, idempotency_key: current.idempotencyKey, registration_secret: current.secret, attendees }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyError(response.status, body));
      const registration = body.registration as RegistrationResult;
      setResult(registration); writeSession(schedule.schedule_id, { ...current, reference: registration.registration_reference }); setStep("review");
    } catch (submissionError) { setError(submissionError instanceof Error ? submissionError.message : "We could not complete your registration. Please try again."); }
    finally { setBusy(false); }
  };

  const startPayment = async () => {
    if (!session?.reference || !session.secret) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/registration/payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration_reference: session.reference, registration_secret: session.secret, provider: "toyyibpay" }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 202) { setError("Payment setup is still in progress. Please wait a moment and check your status again."); return; }
      if (!response.ok) throw new Error(friendlyError(response.status, body));
      if (!body.payment_url || !/^https:\/\//i.test(body.payment_url)) throw new Error("TERAS could not provide a secure payment link.");
      window.location.assign(body.payment_url);
    } catch (paymentError) { setError(paymentError instanceof Error ? paymentError.message : "We could not start payment."); }
    finally { setBusy(false); }
  };

  if (unavailable) return <section className="registration-state" aria-labelledby="registration-unavailable"><span className="eyebrow">Registration</span><h1 id="registration-unavailable">This session is not available</h1><p>This training date may be full, closed, or awaiting its confirmed fee. Please choose another date or contact TERAS for assistance.</p><Link className="btn btn-primary" href={`/calendar${schedule.course_slug ? `?course=${encodeURIComponent(schedule.course_slug)}` : ""}`}>View Training Calendar</Link></section>;

  return <section className="registration-shell" aria-labelledby="registration-title">
    <div className="registration-intro"><span className="eyebrow">Public Registration</span><h1 id="registration-title">Reserve your place</h1><p>Complete the details below for this confirmed TERAS training session. Your place is held temporarily while payment is arranged.</p><div className="registration-session-card"><strong>{schedule.course_title}</strong><span>{date(schedule.start_date)}{schedule.end_date !== schedule.start_date ? ` – ${date(schedule.end_date)}` : ""}</span><span>{[schedule.delivery_mode, schedule.venue].filter(Boolean).join(" · ") || "Venue to be confirmed"}</span><span>{money(schedule.fee)} per attendee · {schedule.available_seats} place{schedule.available_seats === 1 ? "" : "s"} available</span></div></div>
    <div className="registration-progress" aria-label="Registration progress"><span className={step === "details" ? "is-current" : "is-complete"}>1. Details</span><span className={step === "review" ? "is-current" : step === "payment" ? "is-complete" : ""}>2. Review</span><span className={step === "payment" ? "is-current" : ""}>3. Payment</span></div>
    {error && <p className="registration-alert" role="alert">{error}</p>}
    {step === "details" && <div className="registration-form-card"><div className="registration-card-heading"><h2>Participant details</h2><p>For company-sponsored attendance, add each participant who will attend.</p></div>{attendees.map((attendee, index) => <fieldset className="attendee-card" key={index}><legend>Attendee {index + 1}</legend><div className="registration-fields"><label>Full name *<input value={attendee.full_name} onChange={(event) => updateAttendee(index, "full_name", event.target.value)} autoComplete="name" required /></label><label>IC / Passport number<input value={attendee.ic_passport_no} onChange={(event) => updateAttendee(index, "ic_passport_no", event.target.value)} autoComplete="off" /></label><label>Email address *<input type="email" value={attendee.email} onChange={(event) => updateAttendee(index, "email", event.target.value)} autoComplete="email" required /></label><label>Phone number *<input type="tel" value={attendee.phone} onChange={(event) => updateAttendee(index, "phone", event.target.value)} autoComplete="tel" required /></label><label className="registration-field-wide">Company / organisation<input value={attendee.company} onChange={(event) => updateAttendee(index, "company", event.target.value)} autoComplete="organization" /></label></div>{attendees.length > 1 && <button className="registration-remove" type="button" onClick={() => setAttendees((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove attendee</button>}</fieldset>)}{attendees.length < schedule.available_seats && <button className="btn btn-outline registration-add" type="button" onClick={() => setAttendees((current) => [...current, emptyAttendee()])}>+ Add another attendee</button>}<button className="btn btn-primary registration-submit" type="button" onClick={submitRegistration} disabled={busy}>{busy ? "Saving registration…" : "Continue to review"}</button><p className="registration-privacy">Only information needed to process this registration is collected. TERAS will use it to arrange training and payment verification.</p></div>}
    {step === "review" && result && <div className="registration-form-card"><div className="registration-card-heading"><h2>Review your registration</h2><p>Review the attendees and server-confirmed amount before choosing payment.</p></div><dl className="registration-summary"><div><dt>Programme</dt><dd>{schedule.course_title}</dd></div><div><dt>Training date</dt><dd>{date(schedule.start_date)}{schedule.end_date !== schedule.start_date ? ` – ${date(schedule.end_date)}` : ""}</dd></div><div><dt>Attendees</dt><dd>{attendees.length}</dd></div><div><dt>Fee per attendee</dt><dd>{money(perPax)}</dd></div><div><dt>Total payable</dt><dd className="registration-total">{money(total)}</dd></div></dl><div className="registration-actions"><button className="btn btn-outline" type="button" onClick={() => setStep("details")} disabled={busy}>Back to details</button><button className="btn btn-primary" type="button" onClick={() => setStep("payment")} disabled={busy}>Choose payment</button></div></div>}
    {step === "payment" && result && <div className="registration-form-card"><div className="registration-card-heading"><h2>Choose payment method</h2><p>Total payable: <strong>{money(total)}</strong>. The amount is confirmed by TERAS server records.</p></div><div className="payment-options"><label className={method === "toyyibpay" ? "is-selected" : ""}><input type="radio" name="payment-method" checked={method === "toyyibpay"} onChange={() => setMethod("toyyibpay")} /><span><strong>Online payment</strong><small>Continue securely with ToyyibPay.</small></span></label><label className={method === "bank_transfer" ? "is-selected" : ""}><input type="radio" name="payment-method" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} /><span><strong>Bank transfer / manual verification</strong><small>TERAS will provide payment instructions and verify the transfer before confirming your place.</small></span></label></div>{method === "bank_transfer" ? <div className="payment-note"><strong>Payment verification pending</strong><p>Contact TERAS for the approved bank-transfer instructions and quote reference <strong>{session?.reference}</strong>. Do not mark a transfer as paid yourself.</p><div className="registration-actions"><a className="btn btn-outline" href="https://wa.me/60195193834?text=Hi%20TERAS%2C%20I%20need%20bank%20transfer%20instructions%20for%20a%20training%20registration." target="_blank" rel="noreferrer">Contact TERAS on WhatsApp</a><Link className="btn btn-primary" href="/registration/status">View registration status</Link></div></div> : <div className="registration-actions"><button className="btn btn-outline" type="button" onClick={() => setStep("review")} disabled={busy}>Back</button><button className="btn btn-primary" type="button" onClick={startPayment} disabled={busy}>{busy ? "Preparing payment…" : "Continue to ToyyibPay"}</button></div>}<p className="registration-privacy">Your payment is confirmed only after server-side verification. Returning from the payment provider does not by itself confirm payment.</p></div>}
  </section>;
}
