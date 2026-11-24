"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ebook.module.css";
import { normalizeMalaysianPhone } from "../../lib/my-phone";
import { EBOOK_MARKETING_TEXT, EBOOK_PHONE_NOTE, EBOOK_PRIVACY_ACK_TEXT } from "../../lib/ebook-lead";

// W9-G3 live eBook request form (rendered only when TERAS_EBOOK_PUBLIC is "on"; the local preview keeps the network-free
// EbookRequestDemo). Same fields, wording and privacy hardening as the demo: method="post" with the only submit button
// disabled until React has mounted, so a native submission can never put personal data in a URL. Submits JSON to
// POST /api/ebook and shows one uniform "check your email" state, so it never reveals whether an address is known.
// Marketing is optional and unticked; the phone number carries no consent and is never shown as verified.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_S = 60;
const FIELD_FOR = { fullName: "name", phone: "phone", email: "email", privacyAck: "fulfilment" };

export default function EbookRequestForm() {
  const [errors, setErrors] = useState({});
  const [state, setState] = useState("idle"); // idle | sending | check_email | try_later | unavailable
  const [ready, setReady] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const lastRequest = useRef(null);
  const startedAt = useRef(Date.now());
  const statusRef = useRef(null);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => { if (state !== "idle" && state !== "sending") statusRef.current?.focus(); }, [state]);

  async function send(body) {
    setState("sending");
    try {
      const response = await fetch("/api/ebook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && data.errors) {
        const next = {};
        for (const [key, message] of Object.entries(data.errors)) next[FIELD_FOR[key] ?? key] = message;
        setErrors(next);
        setState("idle");
        return;
      }
      if (response.status === 202 && data.status === "check_email") { setState("check_email"); setCooldown(RESEND_COOLDOWN_S); return; }
      if (response.status === 202 && data.status === "try_later") { setState("try_later"); return; }
      setState(response.status === 400 ? "idle" : "unavailable");
      if (response.status === 400) setErrors({ form: data.error || "Please check the highlighted fields." });
    } catch {
      setState("unavailable");
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const phone = normalizeMalaysianPhone(form.get("phone"));
    const email = String(form.get("email") || "").trim();
    const next = {};
    if (name.length < 2) next.name = "Please enter your full name.";
    if (!phone.ok) next.phone = "Please enter a valid Malaysian WhatsApp or phone number, for example 012-345 6789 or +60 12-345 6789.";
    if (!EMAIL.test(email)) next.email = "Please enter a valid email address.";
    if (!form.get("fulfilment")) next.fulfilment = "Please confirm so we know how your details will be used.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      fullName: name,
      phone: String(form.get("phone") || ""),
      email,
      privacyAck: true,
      marketingEmailOptIn: Boolean(form.get("marketing")),
      website: String(form.get("website") || ""),
      formStartedAt: startedAt.current,
    };
    lastRequest.current = body;
    send(body);
  }

  if (state === "check_email" || state === "try_later" || state === "unavailable") {
    const title = state === "check_email" ? "Check your email" : state === "try_later" ? "We could not send the link right now" : "The service is temporarily unavailable";
    return (
      <div className={styles.result} role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>
        <h3>{title}</h3>
        {state === "check_email" && (
          <>
            <p>If your details are valid, we have sent a confirmation link to your email address. Open it to confirm your email and download the eBook.</p>
            <p>The link works once and expires in 60 minutes. Check your spam or promotions folder if you cannot see it.</p>
            <button type="button" className={styles.reset} disabled={cooldown > 0 || !lastRequest.current} onClick={() => send({ ...lastRequest.current, formStartedAt: startedAt.current })}>
              {cooldown > 0 ? `Send a new link (available in ${cooldown}s)` : "Send a new link"}
            </button>
            <p className={styles.hint}>A new link replaces any earlier one.</p>
          </>
        )}
        {state === "try_later" && <p>Please try again later. Your details have not been lost, and you can request a new link then.</p>}
        {state === "unavailable" && <p>Please try again in a few minutes. If the problem continues, contact us at admin@terasuniversal.com.my.</p>}
        <button type="button" className={styles.reset} onClick={() => { setState("idle"); setErrors({}); }}>Back to the form</button>
      </div>
    );
  }

  const sending = state === "sending";
  return (
    <form className={styles.form} method="post" onSubmit={handleSubmit} noValidate aria-busy={sending}>
      {errors.form && <p className={styles.error} role="alert">{errors.form}</p>}
      <label className={styles.field}>
        <span>Full name <span aria-hidden="true">*</span></span>
        <input name="name" type="text" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "ebook-live-name-error" : undefined} />
        {errors.name && <span id="ebook-live-name-error" className={styles.error}>{errors.name}</span>}
      </label>
      <label className={styles.field}>
        <span>WhatsApp / phone number <span aria-hidden="true">*</span></span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="012-345 6789" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "ebook-live-phone-note ebook-live-phone-error" : "ebook-live-phone-note"} />
        <span id="ebook-live-phone-note" className={styles.hint}>{EBOOK_PHONE_NOTE}</span>
        {errors.phone && <span id="ebook-live-phone-error" className={styles.error}>{errors.phone}</span>}
      </label>
      <label className={styles.field}>
        <span>Email address <span aria-hidden="true">*</span></span>
        <input name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "ebook-live-email-error" : undefined} />
        {errors.email && <span id="ebook-live-email-error" className={styles.error}>{errors.email}</span>}
      </label>
      <label className={styles.check}>
        <input name="fulfilment" type="checkbox" required aria-invalid={Boolean(errors.fulfilment)} aria-describedby={errors.fulfilment ? "ebook-live-fulfilment-error" : undefined} />
        <span>{EBOOK_PRIVACY_ACK_TEXT} <span aria-hidden="true">*</span></span>
      </label>
      {errors.fulfilment && <span id="ebook-live-fulfilment-error" className={styles.error}>{errors.fulfilment}</span>}
      <label className={styles.check}>
        <input name="marketing" type="checkbox" />
        <span>{EBOOK_MARKETING_TEXT} You will receive the eBook whether or not you tick this.</span>
      </label>
      <div className={styles.honeypot} aria-hidden="true">
        <label>Leave this field empty<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <noscript><p className={styles.hint} role="note">JavaScript is needed to request the eBook. Nothing you type here is sent without it.</p></noscript>
      <button type="submit" className={styles.submit} disabled={!ready || sending}>{sending ? "Sending…" : "Get the free eBook"}</button>
      <p className={styles.required}><span aria-hidden="true">*</span> Required</p>
    </form>
  );
}
