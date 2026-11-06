"use client";

import { useEffect, useId, useRef, useState } from "react";
import FormField from "./premium/FormField";
import kit from "./premium/premium.module.css";
import inner from "./premium/inner.module.css";
import { CONTACT_ENQUIRY_TYPES, CONTACT_INTERESTS, CONTACT_LIMITS, buildContactPayload, describeSubmitFailure, validateContact } from "../lib/public-form-helpers";

const EMPTY = { name: "", company: "", email: "", phone: "", enquiryType: "Corporate", course: "", message: "", website: "" };
const FIELD_LABELS = { name: "Name", company: "Company", email: "Email", phone: "Phone", enquiryType: "Enquiry type", course: "Enquiry topic", message: "Message" };
const FIELD_ORDER = ["name", "email", "phone", "company", "enquiryType", "course", "message"];

// Posts to the existing /api/contact endpoint with the same payload as before (sourcePage "contact_page").
// The endpoint, its validation, rate limit, CRM lead creation and email behaviour are not changed by this form.
export default function ContactEnquiryForm() {
  const base = useId().replace(/:/g, "");
  const id = (name) => `${base}-${name}`;
  const startedAt = useRef(Date.now());
  const summaryRef = useRef(null);
  const statusRef = useRef(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ status: "idle", message: "" });
  const [attempt, setAttempt] = useState(0);

  const set = (name) => (event) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: "" }));
  };

  // Move focus to the summary after a failed attempt and to the confirmation after a successful one.
  useEffect(() => {
    if (attempt === 0) return;
    if (state.status === "error") summaryRef.current?.focus();
    if (state.status === "success") statusRef.current?.focus();
  }, [attempt, state.status]);

  async function submit(event) {
    event.preventDefault();
    if (state.status === "submitting") return;
    const found = validateContact(values);
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
      response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildContactPayload(values, startedAt.current)) });
      body = await response.json().catch(() => ({}));
    } catch {
      response = null;
    }
    if (response && response.ok) {
      setValues(EMPTY);
      startedAt.current = Date.now();
      setState({ status: "success", message: "" });
    } else {
      const failure = describeSubmitFailure(response ? response.status : 0, body, "contact");
      setErrors(failure.fieldErrors);
      setState({ status: "error", message: failure.message });
    }
    setAttempt((count) => count + 1);
  }

  const submitting = state.status === "submitting";
  const invalid = FIELD_ORDER.filter((name) => errors[name]);

  if (state.status === "success") {
    return (
      <div className={inner.formCard}>
        <div className={inner.formStatus} role="status" tabIndex={-1} ref={statusRef}>
          <strong>Enquiry submitted</strong>
          <p>Thank you. Your enquiry has been submitted to TERAS UNIVERSAL.</p>
        </div>
        <p className={inner.formNote}>You can also reach us directly at <a className={inner.channelLink} href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>.</p>
      </div>
    );
  }

  return (
    <form className={`${inner.formCard} ${inner.form}`} onSubmit={submit} noValidate aria-busy={submitting} aria-describedby={`${base}-note`}>
      {/* Honeypot: hidden from people, bots often fill every field. The endpoint already checks it. */}
      <div className={inner.hp} aria-hidden="true">
        <label htmlFor={id("website")}>Leave this field empty</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
      </div>

      {state.status === "error" && (
        <div className={inner.formSummary} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{invalid.length > 0 ? "Please check these fields" : "Your enquiry was not sent"}</strong>
          {state.message && <p>{state.message}</p>}
          {invalid.length > 0 && <ul>{invalid.map((name) => <li key={name}><a href={`#${id(name)}`}>{FIELD_LABELS[name]}: {errors[name]}</a></li>)}</ul>}
        </div>
      )}

      <fieldset className={inner.fieldset}>
        <legend>Your details</legend>
        <div className={inner.formGrid}>
          <FormField id={id("name")} label="Name" required error={errors.name}>
            {(props) => <input {...props} name="name" type="text" autoComplete="name" maxLength={CONTACT_LIMITS.name} value={values.name} onChange={set("name")} />}
          </FormField>
          <FormField id={id("company")} label="Company" optional error={errors.company}>
            {(props) => <input {...props} name="company" type="text" autoComplete="organization" maxLength={CONTACT_LIMITS.company} value={values.company} onChange={set("company")} />}
          </FormField>
          <FormField id={id("email")} label="Email" required error={errors.email}>
            {(props) => <input {...props} name="email" type="email" autoComplete="email" inputMode="email" maxLength={CONTACT_LIMITS.email} value={values.email} onChange={set("email")} />}
          </FormField>
          <FormField id={id("phone")} label="Phone" required error={errors.phone}>
            {(props) => <input {...props} name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={CONTACT_LIMITS.phone} value={values.phone} onChange={set("phone")} />}
          </FormField>
        </div>
      </fieldset>

      <fieldset className={inner.fieldset}>
        <legend>Your enquiry</legend>
        <div className={inner.formGrid}>
          <FormField id={id("enquiryType")} label="Enquiry type" required error={errors.enquiryType}>
            {(props) => <select {...props} name="enquiryType" value={values.enquiryType} onChange={set("enquiryType")}>{CONTACT_ENQUIRY_TYPES.map((type) => <option key={type}>{type}</option>)}</select>}
          </FormField>
          <FormField id={id("course")} label="Enquiry topic" required error={errors.course}>
            {(props) => (
              <select {...props} name="course" value={values.course} onChange={set("course")}>
                <option value="">Select a topic</option>
                {CONTACT_INTERESTS.map((interest) => <option key={interest}>{interest}</option>)}
              </select>
            )}
          </FormField>
          <FormField id={id("message")} label="Message" required wide error={errors.message}>
            {(props) => <textarea {...props} name="message" rows={6} maxLength={CONTACT_LIMITS.message} value={values.message} onChange={set("message")} />}
          </FormField>
        </div>
      </fieldset>

      <div className={inner.formActions}>
        <button className={`${kit.btn} ${inner.submit}`} type="submit" disabled={submitting}>{submitting ? "Sending…" : "Submit enquiry"}</button>
        <span role="status" className={inner.formNote}>{submitting ? "Sending your enquiry…" : ""}</span>
      </div>
      <p className={inner.formNote} id={`${base}-note`}>Prefer email? Write to <a className={inner.channelLink} href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>.</p>
    </form>
  );
}
