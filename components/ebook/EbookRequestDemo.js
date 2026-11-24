"use client";

import { useEffect, useState } from "react";
import styles from "./ebook.module.css";
import { normalizeMalaysianPhone } from "../../lib/my-phone";
import { EBOOK_MARKETING_TEXT, EBOOK_PHONE_NOTE, EBOOK_PRIVACY_ACK_TEXT } from "../../lib/ebook-lead";

// LOCAL-ONLY DEMONSTRATION of the planned eBook request journey (Phase S6). Nothing leaves the browser: there is no
// fetch, no form action, no storage and no PDF. The completion state says plainly that delivery is not active, so the
// preview can never be mistaken for the real lead-capture flow, which needs separate approval (backend, CRM record,
// published Privacy Notice, delivery). Marketing consent is optional, unticked by default and independent of the
// fulfilment purpose: the demonstration completes whether or not it is ticked.
// W9-G1: full name, Malaysian WhatsApp/phone number (normalised to +60) and email are required; the consent wording is the
// versioned text in lib/ebook-lead.js. The phone number carries no marketing consent (email-only, optional, unticked).
// W9-G1.1 privacy hardening, independent of the React submit handler: the server-rendered form is method="post" (a native
// submission can never put the name, phone or email in a URL or history entry) and its only submit button is disabled
// until React has mounted, so neither a click nor Enter (implicit submission) can submit before hydration or without
// JavaScript. A noscript note explains this to visitors without JavaScript.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EbookRequestDemo() {
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

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
    if (!form.get("fulfilment")) next.fulfilment = "Please confirm so we know how your details would be used.";
    setErrors(next);
    if (Object.keys(next).length) return;
    // Only the consent choice and the normalised number format are kept, to show what would be recorded; the details
    // themselves are discarded.
    setDone({ marketing: Boolean(form.get("marketing")), phoneType: phone.type });
  }

  if (done) {
    return (
      <div className={styles.result} role="status" aria-live="polite">
        <p className={styles.resultTag}>Local preview: demonstration complete</p>
        <h3>The request journey works. Delivery is not active yet.</h3>
        <p>In the live version, this is where your eBook download would appear. This local preview does not provide the PDF, and nothing you typed was sent, emailed or saved.</p>
        <dl className={styles.resultFacts}>
          <div><dt>eBook request</dt><dd>Accepted by the demonstration</dd></div>
          <div><dt>Phone number</dt><dd>Accepted ({done.phoneType === "fixed" ? "fixed line" : "mobile"}, stored as +60)</dd></div>
          <div><dt>Marketing email</dt><dd>{done.marketing ? "Opted in (optional)" : "Not given (optional)"}</dd></div>
          <div><dt>Promotional calls or WhatsApp</dt><dd>Not consented (not asked on this form)</dd></div>
        </dl>
        <button type="button" className={styles.reset} onClick={() => { setDone(null); setErrors({}); }}>Start the demonstration again</button>
      </div>
    );
  }

  return (
    <form className={styles.form} method="post" onSubmit={handleSubmit} noValidate aria-describedby="ebook-demo-note">
      <p id="ebook-demo-note" className={styles.demoNote}><strong>Local preview.</strong> This form is a demonstration only: it does not send, store or email anything, and it does not provide the PDF.</p>
      <label className={styles.field}>
        <span>Full name <span aria-hidden="true">*</span></span>
        <input name="name" type="text" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "ebook-name-error" : undefined} />
        {errors.name && <span id="ebook-name-error" className={styles.error}>{errors.name}</span>}
      </label>
      <label className={styles.field}>
        <span>WhatsApp / phone number <span aria-hidden="true">*</span></span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="012-345 6789" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "ebook-phone-note ebook-phone-error" : "ebook-phone-note"} />
        <span id="ebook-phone-note" className={styles.hint}>{EBOOK_PHONE_NOTE}</span>
        {errors.phone && <span id="ebook-phone-error" className={styles.error}>{errors.phone}</span>}
      </label>
      <label className={styles.field}>
        <span>Email address <span aria-hidden="true">*</span></span>
        <input name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "ebook-email-error" : undefined} />
        {errors.email && <span id="ebook-email-error" className={styles.error}>{errors.email}</span>}
      </label>
      <label className={styles.check}>
        <input name="fulfilment" type="checkbox" required aria-invalid={Boolean(errors.fulfilment)} aria-describedby={errors.fulfilment ? "ebook-fulfilment-error" : undefined} />
        <span>{EBOOK_PRIVACY_ACK_TEXT} <span aria-hidden="true">*</span></span>
      </label>
      {errors.fulfilment && <span id="ebook-fulfilment-error" className={styles.error}>{errors.fulfilment}</span>}
      <label className={styles.check}>
        <input name="marketing" type="checkbox" />
        <span>{EBOOK_MARKETING_TEXT} You will receive the eBook whether or not you tick this.</span>
      </label>
      <noscript><p className={styles.hint} role="note">JavaScript is needed to request the eBook. Nothing you type here is sent without it.</p></noscript>
      <button type="submit" className={styles.submit} disabled={!ready}>Get the free eBook</button>
      <p className={styles.required}><span aria-hidden="true">*</span> Required</p>
    </form>
  );
}
