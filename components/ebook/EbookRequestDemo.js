"use client";

import { useState } from "react";
import styles from "./ebook.module.css";

// LOCAL-ONLY DEMONSTRATION of the planned eBook request journey (Phase S6). Nothing leaves the browser: there is no
// fetch, no form action, no storage and no PDF. The completion state says plainly that delivery is not active, so the
// preview can never be mistaken for the real lead-capture flow, which needs separate approval (backend, CRM record,
// published Privacy Notice, delivery). Marketing consent is optional, unticked by default and independent of the
// fulfilment purpose: the demonstration completes whether or not it is ticked.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EbookRequestDemo() {
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const next = {};
    if (!name) next.name = "Please enter your name.";
    if (!EMAIL.test(email)) next.email = "Please enter a valid email address.";
    if (!form.get("fulfilment")) next.fulfilment = "Please confirm so we know how your details would be used.";
    setErrors(next);
    if (Object.keys(next).length) return;
    // Only the consent choice is kept, to show that it is recorded separately; the name and email are discarded.
    setDone({ marketing: Boolean(form.get("marketing")) });
  }

  if (done) {
    return (
      <div className={styles.result} role="status" aria-live="polite">
        <p className={styles.resultTag}>Local preview: demonstration complete</p>
        <h3>The request journey works. Delivery is not active yet.</h3>
        <p>In the live version, this is where your eBook download would appear. This local preview does not provide the PDF, and nothing you typed was sent, emailed or saved.</p>
        <dl className={styles.resultFacts}>
          <div><dt>eBook request</dt><dd>Accepted by the demonstration</dd></div>
          <div><dt>Marketing contact</dt><dd>{done.marketing ? "Opted in (optional)" : "Not given (optional)"}</dd></div>
        </dl>
        <button type="button" className={styles.reset} onClick={() => { setDone(null); setErrors({}); }}>Start the demonstration again</button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-describedby="ebook-demo-note">
      <p id="ebook-demo-note" className={styles.demoNote}><strong>Local preview.</strong> This form is a demonstration only: it does not send, store or email anything, and it does not provide the PDF.</p>
      <label className={styles.field}>
        <span>Name <span aria-hidden="true">*</span></span>
        <input name="name" type="text" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "ebook-name-error" : undefined} />
        {errors.name && <span id="ebook-name-error" className={styles.error}>{errors.name}</span>}
      </label>
      <label className={styles.field}>
        <span>Email <span aria-hidden="true">*</span></span>
        <input name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "ebook-email-error" : undefined} />
        {errors.email && <span id="ebook-email-error" className={styles.error}>{errors.email}</span>}
      </label>
      <label className={styles.check}>
        <input name="fulfilment" type="checkbox" required aria-invalid={Boolean(errors.fulfilment)} aria-describedby={errors.fulfilment ? "ebook-fulfilment-error" : undefined} />
        <span>I agree that TERAS UNIVERSAL may use my name and email to send me this free eBook. <span aria-hidden="true">*</span></span>
      </label>
      {errors.fulfilment && <span id="ebook-fulfilment-error" className={styles.error}>{errors.fulfilment}</span>}
      <label className={styles.check}>
        <input name="marketing" type="checkbox" />
        <span>Optional: TERAS UNIVERSAL may contact me about training courses and updates. You will receive the eBook whether or not you tick this.</span>
      </label>
      <button type="submit" className={styles.submit}>Get the free eBook</button>
      <p className={styles.required}><span aria-hidden="true">*</span> Required</p>
    </form>
  );
}
