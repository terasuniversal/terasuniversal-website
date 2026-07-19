"use client";

import { useState } from "react";

export default function NewsletterSignup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [formStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!consent) { setError("Please confirm the privacy notice to continue."); return; }
    setStatus("submitting");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, consent, website, formStartedAt }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Something went wrong. Please try again.");
      setStatus("success");
      setName("");
      setEmail("");
      setConsent(false);
    } catch (submitError) {
      setStatus("idle");
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="newsletter-signup newsletter-success" role="status">
        <h3>You&apos;re on the list.</h3>
        <p>Thank you for your interest. A confirmation email is on its way, and our team will keep you updated on safety training insights and industry updates.</p>
      </div>
    );
  }

  return (
    <form className="newsletter-signup" onSubmit={handleSubmit} noValidate>
      <h3>Stay informed on safety training &amp; industry updates.</h3>
      <p>Occasional updates on new programmes, safety insights and industry news. No spam, unsubscribe anytime.</p>
      <div className="newsletter-fields">
        <label>
          <span className="sr-only">Full name</span>
          <input type="text" name="name" placeholder="Full name (optional)" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        </label>
        <label>
          <span className="sr-only">Email address</span>
          <input type="email" name="email" placeholder="Your email address" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <input type="text" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden="true" />
        <button type="submit" className="btn btn-primary" disabled={status === "submitting"}>{status === "submitting" ? "Submitting..." : "Subscribe"}</button>
      </div>
      <label className="newsletter-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
        <span>I agree to receive email updates from TERAS UNIVERSAL and understand I can unsubscribe at any time. See how we handle your data in our privacy notice.</span>
      </label>
      {error ? <p className="newsletter-error" role="alert">{error}</p> : null}
    </form>
  );
}
