"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FormField from "./premium/FormField";
import kit from "./premium/premium.module.css";
import inner from "./premium/inner.module.css";
import { PROPOSAL_CATEGORIES, PROPOSAL_INDUSTRIES, PROPOSAL_LIMITS, buildProposalPayload, describeSubmitFailure, validateProposal } from "../lib/public-form-helpers";

const EMPTY = { companyName: "", contactPerson: "", jobTitle: "", email: "", phone: "", industry: "", category: "", programme: "", participants: "", location: "", month: "", budget: "", objectives: "", notes: "", consent: false, website: "" };
const FIELD_LABELS = { companyName: "Company name", contactPerson: "Contact person", jobTitle: "Job title", email: "Business email", phone: "Phone number", industry: "Industry", category: "Training category", programme: "Specific programme", objectives: "Training objectives", participants: "Number of participants", location: "Training location", month: "Preferred month", budget: "Budget range", notes: "Additional notes", consent: "Confirmation" };
const FIELD_ORDER = ["companyName", "contactPerson", "jobTitle", "email", "phone", "industry", "category", "programme", "objectives", "participants", "location", "month", "budget", "notes", "consent"];

// One page, four sections, one submit. Posts the same payload as the previous seven-step wizard to the existing
// /api/request-proposal endpoint, then goes to the existing /request-proposal/success page. Required fields,
// enums and the confirmation statement are unchanged; the endpoint, CRM lead creation and email behaviour are too.
export default function ProposalRequestForm() {
  const router = useRouter();
  const base = useId().replace(/:/g, "");
  const id = (name) => `${base}-${name}`;
  const startedAt = useRef(Date.now());
  const summaryRef = useRef(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ status: "idle", message: "" });
  const [attempt, setAttempt] = useState(0);

  const set = (name) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: "" }));
  };

  useEffect(() => {
    if (attempt > 0 && state.status === "error") summaryRef.current?.focus();
  }, [attempt, state.status]);

  async function submit(event) {
    event.preventDefault();
    if (state.status === "submitting") return;
    const found = validateProposal(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setState({ status: "error", message: "" });
      setAttempt((count) => count + 1);
      return;
    }
    setErrors({});
    setState({ status: "submitting", message: "" });
    let response;
    let body = {};
    try {
      response = await fetch("/api/request-proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildProposalPayload(values, startedAt.current)) });
      body = await response.json().catch(() => ({}));
    } catch {
      response = null;
    }
    if (response && response.ok) {
      router.push("/request-proposal/success");
      return;
    }
    const failure = describeSubmitFailure(response ? response.status : 0, body, "proposal");
    setErrors(failure.fieldErrors);
    setState({ status: "error", message: failure.message });
    setAttempt((count) => count + 1);
  }

  const submitting = state.status === "submitting";
  const invalid = FIELD_ORDER.filter((name) => errors[name]);

  return (
    <form className={`${inner.formCard} ${inner.form}`} id="proposal-form" onSubmit={submit} noValidate aria-busy={submitting} aria-labelledby="proposal-form-title">
      {/* Honeypot: hidden from people, bots often fill every field. The endpoint already checks it. */}
      <div className={inner.hp} aria-hidden="true">
        <label htmlFor={id("website")}>Leave this field empty</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
      </div>

      {state.status === "error" && (
        <div className={inner.formSummary} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{invalid.length > 0 ? "Please check these fields" : "Your request was not sent"}</strong>
          {state.message && <p>{state.message}</p>}
          {invalid.length > 0 && <ul>{invalid.map((name) => <li key={name}><a href={`#${id(name)}`}>{FIELD_LABELS[name]}: {errors[name]}</a></li>)}</ul>}
        </div>
      )}

      <fieldset className={inner.fieldset}>
        <legend>1. Organisation and contact</legend>
        <div className={inner.formGrid}>
          <FormField id={id("companyName")} label="Company name" required error={errors.companyName}>
            {(props) => <input {...props} name="companyName" type="text" autoComplete="organization" maxLength={PROPOSAL_LIMITS.companyName} value={values.companyName} onChange={set("companyName")} />}
          </FormField>
          <FormField id={id("contactPerson")} label="Contact person" required error={errors.contactPerson}>
            {(props) => <input {...props} name="contactPerson" type="text" autoComplete="name" maxLength={PROPOSAL_LIMITS.contactPerson} value={values.contactPerson} onChange={set("contactPerson")} />}
          </FormField>
          <FormField id={id("jobTitle")} label="Job title" optional error={errors.jobTitle}>
            {(props) => <input {...props} name="jobTitle" type="text" autoComplete="organization-title" maxLength={PROPOSAL_LIMITS.jobTitle} value={values.jobTitle} onChange={set("jobTitle")} />}
          </FormField>
          <FormField id={id("email")} label="Business email" required error={errors.email}>
            {(props) => <input {...props} name="email" type="email" autoComplete="email" inputMode="email" maxLength={PROPOSAL_LIMITS.email} value={values.email} onChange={set("email")} />}
          </FormField>
          <FormField id={id("phone")} label="Phone number" required error={errors.phone}>
            {(props) => <input {...props} name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={PROPOSAL_LIMITS.phone} value={values.phone} onChange={set("phone")} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className={inner.fieldset}>
        <legend>2. Training requirements</legend>
        <div className={inner.formGrid}>
          <FormField id={id("industry")} label="Industry" required error={errors.industry}>
            {(props) => (
              <select {...props} name="industry" value={values.industry} onChange={set("industry")}>
                <option value="">Select an industry</option>
                {PROPOSAL_INDUSTRIES.map((industry) => <option key={industry}>{industry}</option>)}
              </select>
            )}
          </FormField>
          <FormField id={id("category")} label="Training category" required error={errors.category}>
            {(props) => (
              <select {...props} name="category" value={values.category} onChange={set("category")}>
                <option value="">Select a category</option>
                {PROPOSAL_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            )}
          </FormField>
          <FormField id={id("programme")} label="Specific programme" optional wide hint="For example Working at Height." error={errors.programme}>
            {(props) => <input {...props} name="programme" type="text" maxLength={PROPOSAL_LIMITS.programme} value={values.programme} onChange={set("programme")} />}
          </FormField>
          <FormField id={id("objectives")} label="Training objectives" required wide hint="What would you like the training to achieve?" error={errors.objectives}>
            {(props) => <textarea {...props} name="objectives" rows={5} maxLength={PROPOSAL_LIMITS.objectives} value={values.objectives} onChange={set("objectives")} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className={inner.fieldset}>
        <legend>3. Participants, place and timing</legend>
        <div className={inner.formGrid}>
          <FormField id={id("participants")} label="Number of participants" optional hint="A whole number, for example 20." error={errors.participants}>
            {(props) => <input {...props} name="participants" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={values.participants} onChange={set("participants")} />}
          </FormField>
          <FormField id={id("location")} label="Training location" optional hint="City, site or facility." error={errors.location}>
            {(props) => <input {...props} name="location" type="text" maxLength={PROPOSAL_LIMITS.location} value={values.location} onChange={set("location")} />}
          </FormField>
          <FormField id={id("month")} label="Preferred month" optional hint="An initial preference, for example 2026-12." error={errors.month}>
            {(props) => <input {...props} name="month" type="month" value={values.month} onChange={set("month")} />}
          </FormField>
          <FormField id={id("budget")} label="Budget range" optional hint="In your own words." error={errors.budget}>
            {(props) => <input {...props} name="budget" type="text" maxLength={PROPOSAL_LIMITS.budget} value={values.budget} onChange={set("budget")} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className={inner.fieldset}>
        <legend>4. Anything else</legend>
        <FormField id={id("notes")} label="Additional notes" optional hint="Other requirements or context that would help us understand your request." error={errors.notes}>
          {(props) => <textarea {...props} name="notes" rows={4} maxLength={PROPOSAL_LIMITS.notes} value={values.notes} onChange={set("notes")} />}
        </FormField>
      </fieldset>

      <div className={`${inner.field} ${errors.consent ? inner.fieldInvalid : ""}`}>
        <div className={inner.consent}>
          <input id={id("consent")} name="consent" type="checkbox" checked={values.consent} onChange={set("consent")} aria-required="true" aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? id("consent-error") : undefined} />
          <label htmlFor={id("consent")}>I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry. <span className={inner.fieldMark}>(required)</span></label>
          {errors.consent && <p id={id("consent-error")} className={inner.fieldError}><span className={inner.fieldErrorTag}>Error:</span> {errors.consent}</p>}
        </div>
      </div>

      <div className={inner.formActions}>
        <button className={`${kit.btn} ${inner.submit}`} type="submit" disabled={submitting}>{submitting ? "Sending…" : "Submit proposal request"}</button>
        <span role="status" className={inner.formNote}>{submitting ? "Sending your request…" : ""}</span>
      </div>
    </form>
  );
}
