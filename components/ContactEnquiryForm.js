"use client";

import { useRef, useState } from "react";

export default function ContactEnquiryForm() {
  const [state, setState] = useState({ status: "idle", message: "", errors: {} });
  const formStartedAt = useRef(Date.now());

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setState({ status: "submitting", message: "", errors: {} });

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          company: data.get("company"),
          email: data.get("email"),
          phone: data.get("phone"),
          enquiryType: data.get("enquiryType"),
          subject: data.get("course"),
          message: data.get("message"),
          sourcePage: "contact_page",
          website: data.get("website"),
          formStartedAt: formStartedAt.current,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ status: "error", message: result.error || "We could not send your enquiry. Please try again.", errors: result.errors || {} });
        return;
      }
      form.reset();
      setState({ status: "success", message: "Thank you — your enquiry has been sent. Our team will get back to you shortly.", errors: {} });
    } catch {
      setState({ status: "error", message: "We could not send your enquiry. Please check your connection and try again.", errors: {} });
    }
  }

  const submitting = state.status === "submitting";

  return (
    <form className="contact-page-form" onSubmit={handleSubmit} noValidate>
      <p className="contact-form-required-note"><span aria-hidden="true">*</span> Required fields</p>
      {/* Honeypot: hidden from real visitors, bots often fill every field. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="cef-website">Leave this field empty</label>
        <input id="cef-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="contact-page-form-grid">
        <label>Name <span aria-hidden="true">*</span><input name="name" type="text" autoComplete="name" required aria-invalid={!!state.errors.name} />
          {state.errors.name && <span className="form-field-error" role="alert">{state.errors.name}</span>}
        </label>
        <label>Company<input name="company" type="text" autoComplete="organization" /></label>
        <label>Email <span aria-hidden="true">*</span><input name="email" type="email" autoComplete="email" required aria-invalid={!!state.errors.email} />
          {state.errors.email && <span className="form-field-error" role="alert">{state.errors.email}</span>}
        </label>
        <label>Phone <span aria-hidden="true">*</span><input name="phone" type="tel" autoComplete="tel" required aria-invalid={!!state.errors.phone} />
          {state.errors.phone && <span className="form-field-error" role="alert">{state.errors.phone}</span>}
        </label>
      </div>
      <label>Enquiry Type <span aria-hidden="true">*</span><select name="enquiryType" defaultValue="Corporate" required><option>Corporate</option><option>Individual</option><option>Government</option><option>Training</option></select></label>
      <label>Course Interested <span aria-hidden="true">*</span><select name="course" defaultValue="" required aria-invalid={!!state.errors.subject}><option value="" disabled>Select an option</option><option>Industrial Safety Training</option><option>Technical Competency</option><option>Industrial Consultancy</option><option>Workforce Development</option><option>Custom Corporate Training</option><option>Other Enquiry</option></select>
        {state.errors.subject && <span className="form-field-error" role="alert">{state.errors.subject}</span>}
      </label>
      <label>Message <span aria-hidden="true">*</span><textarea name="message" rows="6" required aria-invalid={!!state.errors.message} />
        {state.errors.message && <span className="form-field-error" role="alert">{state.errors.message}</span>}
      </label>
      <button className="btn btn-gold contact-submit" type="submit" disabled={submitting}>
        {submitting ? "Sending..." : "Submit Enquiry"}
      </button>
      {state.status === "success" && <p className="contact-form-status contact-form-status-success" aria-live="polite">{state.message}</p>}
      {state.status === "error" && <p className="contact-form-status contact-form-status-error" role="alert" aria-live="assertive">{state.message}</p>}
      <p className="contact-form-note">
        Prefer email? Contact us directly at <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>.
      </p>
    </form>
  );
}
