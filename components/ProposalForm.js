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
  const [errors, setErrors] = useState({});

  function handleChange(event) {
    const field = event.target.name;
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  }

  function handleSubmit(event) {
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

    // This is intentionally a local simulation until a secure backend is connected.
    router.push("/request-proposal/success");
  }

  const error = (name) => errors[name] ? <span id={`${name}-error`} className="proposal-field-error" role="alert">{errors[name]}</span> : null;
  const describedBy = (name) => errors[name] ? `${name}-error` : undefined;

  return (
    <form className="proposal-form" ref={formRef} onSubmit={handleSubmit} onChange={handleChange} noValidate>
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
      <label className="proposal-consent"><input name="consent" type="checkbox" aria-invalid={Boolean(errors.consent)} aria-describedby={describedBy("consent")} /> <span>I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry.</span>{error("consent")}</label>
      {Object.keys(errors).length > 0 && <p className="proposal-form-error-summary" role="alert">Please review the highlighted fields before submitting.</p>}
      <button className="btn btn-gold proposal-submit" type="submit">Submit Proposal Request <span aria-hidden="true">&rarr;</span></button>
      <p className="proposal-simulation-note">This form is a simulated submission flow. No information is stored or sent to an external service.</p>
    </form>
  );
}