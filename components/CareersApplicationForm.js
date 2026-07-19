"use client";

import { useState } from "react";

const positions = ["Trainer / Facilitator", "Technical Assessor", "Training Coordinator", "Business Development", "Internship", "General Enquiry"];

export default function CareersApplicationForm() {
  const [fields, setFields] = useState({ fullName: "", email: "", phone: "", position: positions[0], resumeLink: "", message: "" });
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [formStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const update = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!consent) { setError("Please confirm the consent statement to continue."); return; }
    setStatus("submitting");
    try {
      const response = await fetch("/api/careers-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, consent, website, formStartedAt }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Something went wrong. Please try again.");
      setStatus("success");
    } catch (submitError) {
      setStatus("idle");
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="careers-form careers-success" role="status">
        <h3>Application received.</h3>
        <p>Thank you for your interest in TERAS UNIVERSAL. A confirmation email is on its way, and our team will review your application and follow up if your profile matches a current or future opportunity.</p>
      </div>
    );
  }

  return (
    <form className="careers-form" onSubmit={handleSubmit} noValidate>
      <div className="field-grid">
        <label>Full Name<input type="text" required value={fields.fullName} onChange={update("fullName")} autoComplete="name" /></label>
        <label>Email Address<input type="email" required value={fields.email} onChange={update("email")} autoComplete="email" /></label>
        <label>Phone Number<input type="tel" required value={fields.phone} onChange={update("phone")} autoComplete="tel" /></label>
        <label>Position of Interest<select required value={fields.position} onChange={update("position")}>{positions.map((position) => <option key={position} value={position}>{position}</option>)}</select></label>
      </div>
      <label>Resume / Portfolio / LinkedIn Link (optional)<input type="url" placeholder="https://..." value={fields.resumeLink} onChange={update("resumeLink")} /></label>
      <label>Message<textarea rows={5} placeholder="Tell us about your experience and why you're interested in TERAS UNIVERSAL." value={fields.message} onChange={update("message")} /></label>
      <input type="text" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" className="form-honeypot" aria-hidden="true" />
      <label className="newsletter-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
        <span>I consent to TERAS UNIVERSAL storing and reviewing the information above for recruitment purposes.</span>
      </label>
      {error ? <p className="newsletter-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary form-submit" disabled={status === "submitting"}>{status === "submitting" ? "Submitting..." : "Submit Application"}</button>
      <p className="form-note">You may also email your resume directly to admin@terasuniversal.com.my.</p>
    </form>
  );
}
