"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const requiredFields = {
  companyName: "Company Name",
  contactPerson: "Contact Person",
  email: "Business Email",
  phone: "Phone Number",
  industry: "Industry",
  category: "Training Category",
  objectives: "Training Objectives",
  consent: "Consent",
};

export default function ProposalForm() {
  const router = useRouter();
  const formRef = useRef(null);
  const startedAtRef = useRef(Date.now());
  const [errors, setErrors] = useState({});
  const [submitState, setSubmitState] = useState({ status: "idle", message: "" });

  function handleChange(event) {
    const field = event.target.name;
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const nextErrors = {};

    Object.entries(requiredFields).forEach(([name, label]) => {
      const value = name === "consent" ? form.elements.consent.checked : String(data.get(name) || "").trim();
      if (!value) nextErrors[name] = `${label} is required.`;
    });
    if (data.get("email") && !/^\S+@\S+\.\S+$/.test(String(data.get("email")))) nextErrors.email = "Enter a valid business email address.";
    if (data.get("participants") && Number(data.get("participants")) < 1) nextErrors.participants = "Enter at least one participant.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstInvalid = form.querySelector(`[name="${Object.keys(nextErrors)[0]}"]`);
      firstInvalid?.focus();
      return;
    }

    setErrors({});
    setSubmitState({ status: "submitting", message: "Sending your request securely…" });
    try {
      const response = await fetch("/api/request-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "We could not send your request. Please try again or contact us directly.");
      router.push("/request-proposal/success");
    } catch (submissionError) {
      setSubmitState({ status: "error", message: submissionError.message || "We could not send your request. Please try again." });
    }
  }

  const error = (name) => errors[name] ? <span id={`${name}-error`} className="proposal-field-error" role="alert">{errors[name]}</span> : null;
  const describedBy = (name) => errors[name] ? `${name}-error` : undefined;

  return (
    <form className="proposal-form" ref={formRef} onSubmit={handleSubmit} onChange={handleChange} noValidate>
      <input type="hidden" name="formStartedAt" value={startedAtRef.current} readOnly />
      <div className="proposal-form-grid">
        <label>Company Name *<input name="companyName" type="text" autoComplete="organization" aria-invalid={Boolean(errors.companyName)} aria-describedby={describedBy("companyName")} />{error("companyName")}</label>
        <label>Contact Person *<input name="contactPerson" type="text" autoComplete="name" aria-invalid={Boolean(errors.contactPerson)} aria-describedby={describedBy("contactPerson")} />{error("contactPerson")}</label>
        <label>Job Title<input name="jobTitle" type="text" autoComplete="organization-title" /></label>
        <label>Business Email *<input name="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={describedBy("email")} />{error("email")}</label>
        <label>Phone Number *<input name="phone" type="tel" autoComplete="tel" aria-invalid={Boolean(errors.phone)} aria-describedby={describedBy("phone")} />{error("phone")}</label>
        <label>Industry *<select name="industry" defaultValue="" aria-invalid={Boolean(errors.industry)} aria-describedby={describedBy("industry")}><option value="" disabled>Select an industry</option><option>Oil &amp; Gas</option><option>Petrochemical</option><option>Construction</option><option>Manufacturing</option><option>Marine &amp; Offshore</option><option>Power &amp; Utilities</option><option>Government &amp; GLC</option><option>Others</option></select>{error("industry")}</label>
        <label>Training Category *<select name="category" defaultValue="" aria-invalid={Boolean(errors.category)} aria-describedby={describedBy("category")}><option value="" disabled>Select a category</option><option>Industrial Safety</option><option>Technical Competency</option><option>Industrial Consultancy</option><option>Workforce Development</option></select>{error("category")}</label>
        <label>Specific Programme<input name="programme" type="text" placeholder="e.g. Working at Height" /></label>
        <label>Number of Participants<input name="participants" type="number" min="1" inputMode="numeric" aria-invalid={Boolean(errors.participants)} aria-describedby={describedBy("participants")} />{error("participants")}</label>
        <label>Training Location<input name="location" type="text" placeholder="City, site or facility" /></label>
        <label>Preferred Month<input name="month" type="month" /></label>
        <label>Budget Range (Optional)<input name="budget" type="text" inputMode="decimal" /></label>
      </div>
      <label>Training Objectives *<textarea name="objectives" rows="5" placeholder="Tell us what you would like the programme to achieve." aria-invalid={Boolean(errors.objectives)} aria-describedby={describedBy("objectives")} />{error("objectives")}</label>
      <label>Additional Notes<textarea name="notes" rows="5" placeholder="Share any other useful requirements or context." /></label>
      <div className="proposal-honeypot" aria-hidden="true"><label>Website<input name="website" type="text" tabIndex="-1" autoComplete="off" /></label></div>
      <label className="proposal-consent"><input name="consent" type="checkbox" aria-invalid={Boolean(errors.consent)} aria-describedby={describedBy("consent")} /> <span>I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry.</span>{error("consent")}</label>
      {Object.keys(errors).length > 0 && <p className="proposal-form-error-summary" role="alert">Please review the highlighted fields before submitting.</p>}
      {submitState.status === "error" && <p className="proposal-form-error-summary" role="alert">{submitState.message}</p>}
      <button className="btn btn-gold proposal-submit" type="submit" disabled={submitState.status === "submitting"}>{submitState.status === "submitting" ? "Sending…" : "Submit Proposal Request"} <span aria-hidden="true">&rarr;</span></button>
      {submitState.status === "submitting" && <p className="proposal-form-status" role="status">{submitState.message}</p>}
    </form>
  );
}
