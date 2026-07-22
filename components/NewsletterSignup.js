"use client";

import { useState } from "react";

/**
 * Newsletter subscription form (Module 27).
 * Posts to /api/newsletter, which requires RESEND_AUDIENCE_ID to be
 * configured. If that env var is missing, submission shows a clear error
 * instead of silently failing.
 */
export default function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [formStartedAt] = useState(() => Date.now());

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!consent) { setError("Please confirm the consent statement."); setStatus("error"); return; }
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent, formStartedAt, website: "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Subscription failed.");
      setStatus("success");
      setEmail("");
      setConsent(false);
    } catch (submitError) {
      setError(submitError.message || "We could not process your subscription right now.");
      setStatus("error");
    }
  };

  if (status === "success") {
    return <div className="newsletter-success" role="status">Thank you &mdash; please check your inbox to confirm your subscription.</div>;
  }

  return (
    <form className="newsletter-form" onSubmit={handleSubmit} noValidate>
      <div className="newsletter-field-row">
        <label className="sr-only" htmlFor="newsletter-email">Email address</label>
        <input id="newsletter-email" type="email" name="email" placeholder="Your email address" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="newsletter-honeypot" aria-hidden="true" />
        <button type="submit" className="btn btn-primary" disabled={status === "loading"}>{status === "loading" ? "Subscribing..." : "Subscribe"}</button>
      </div>
      <label className="newsletter-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>I agree to receive occasional training updates and industry insights from TERAS UNIVERSAL. You can unsubscribe at any time.</span>
      </label>
      {status === "error" && error && <p className="newsletter-error" role="alert">{error}</p>}
    </form>
  );
}
