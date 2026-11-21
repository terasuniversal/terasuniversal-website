"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PrivacyNoticeLink from "./legal/PrivacyNoticeLink";
import { courseCatalog } from "../data/courseCatalog";
import { proposalContent } from "../content/en/proposal";
import styles from "./proposal/wizard.module.css";

// FT-1B (owner-approved, 21 Nov 2026): three-step Request a Proposal wizard. The request is unchanged: the same JSON keys
// go to the same endpoint (app/api/request-proposal/route.js -> submit_proposal_request), with the same required fields,
// allowed lists and consent. Two client defects are fixed without touching the server: formStartedAt is the real time
// the form was opened (it used to be faked as "5 s ago", so the server's minimum-completion-time check never applied),
// and the existing `website` honeypot field is now sent. scripts/ft1b-proposal-wizard-contract.mts guards all of this.
const industries = ["Oil & Gas", "Petrochemical", "Construction", "Manufacturing", "Marine & Offshore", "Power & Utilities", "Government & GLC", "Others"];
const categories = ["Industrial Safety", "Technical Competency", "Industrial Consultancy", "Workforce Development"];
const MAX = { companyName: 160, contactPerson: 120, jobTitle: 120, email: 254, phone: 40, programme: 160, participants: 8, location: 160, month: 7, budget: 80, objectives: 3000, notes: 3000 };
const OTHER = "__other__";
const text = proposalContent;
const F = text.fields;
const findCourse = (slug) => courseCatalog.find((course) => course.slug === slug);
const stepFromHash = () => { const match = /^#step-([1-3])$/.exec(window.location.hash); return match ? Number(match[1]) - 1 : 0; };

export default function ProposalWizard() {
  const router = useRouter();
  const formStartedAt = useRef(Date.now());
  const submitting = useRef(false);
  const heading = useRef(null);
  const summary = useRef(null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({ companyName: "", contactPerson: "", jobTitle: "", email: "", phone: "", industry: "", category: "", courseChoice: "", programmeOther: "", participants: "", locationOption: "", locationDetail: "", month: "", budget: "", objectives: "", notes: "", consent: false, website: "" });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const total = text.steps.length;

  // A ?course= value is used only when it is a real catalogue slug; anything else is ignored silently.
  useEffect(() => {
    let slug = null;
    try { slug = new URLSearchParams(window.location.search).get("course"); } catch { slug = null; }
    const course = slug ? findCourse(slug) : null;
    if (!course) return;
    setValues((current) => ({ ...current, courseChoice: current.courseChoice || course.slug, category: current.category || (categories.includes(course.category) ? course.category : "") }));
  }, []);

  // Each step is a history entry (#step-N, via Next's supported native pushState), so the browser Back button returns to
  // the previous step instead of leaving the page. A deep link to a later step always starts at step 1.
  const goTo = useCallback((next, push = true) => {
    setErrors({});
    setStep(next);
    if (push) window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#step-${next + 1}`);
  }, []);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const onPop = () => goTo(stepFromHash(), false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goTo]);
  const firstRender = useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } heading.current?.focus(); }, [step]);

  const update = (event) => {
    const { name, type, checked, value } = event.target;
    setValues((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
    setErrors((current) => { if (!current[name]) return current; const next = { ...current }; delete next[name]; return next; });
  };

  const programme = () => (values.courseChoice === OTHER ? values.programmeOther.trim() : findCourse(values.courseChoice)?.title ?? "").slice(0, MAX.programme);
  const location = () => [values.locationOption, values.locationDetail.trim()].filter(Boolean).join(" - ").slice(0, MAX.location);

  function validate(target) {
    const next = {};
    const required = (name, caption) => { if (!String(values[name] || "").trim()) next[name] = text.errors.required(caption); };
    if (target === 0 || target === 2) {
      required("companyName", F.companyName); required("industry", F.industry); required("contactPerson", F.contactPerson); required("email", F.email); required("phone", F.phone);
      if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = text.errors.email;
      if (values.industry && !industries.includes(values.industry)) next.industry = text.errors.required(F.industry);
    }
    if (target === 1 || target === 2) {
      required("category", F.category); required("objectives", F.objectives);
      if (values.category && !categories.includes(values.category)) next.category = text.errors.required(F.category);
      const count = values.participants.trim();
      if (count && (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 1000000)) next.participants = text.errors.participants;
      if (values.month && !/^\d{4}-\d{2}$/.test(values.month)) next.month = text.errors.month;
    }
    if (target === 2 && !values.consent) next.consent = text.errors.consent;
    setErrors(next);
    if (Object.keys(next).length > 0) window.requestAnimationFrame(() => summary.current?.focus());
    return Object.keys(next).length === 0;
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !validate(2)) return;
    submitting.current = true;
    setStatus({ state: "sending", message: text.status.sending });
    const payload = {
      companyName: values.companyName, contactPerson: values.contactPerson, jobTitle: values.jobTitle, email: values.email, phone: values.phone,
      industry: values.industry, category: values.category, programme: programme(), participants: values.participants.trim(), location: location(),
      month: values.month, budget: values.budget, objectives: values.objectives, notes: values.notes, consent: values.consent,
      website: values.website, formStartedAt: formStartedAt.current,
    };
    try {
      const response = await fetch("/api/request-proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || text.status.failed);
      router.push("/request-proposal/success");
    } catch (submissionError) {
      submitting.current = false;
      setStatus({ state: "error", message: submissionError.message || text.status.failed });
    }
  }

  const describedBy = (name, hint) => [hint && `pw-${name}-hint`, errors[name] && `pw-${name}-error`].filter(Boolean).join(" ") || undefined;
  const fieldError = (name) => (errors[name] ? <span id={`pw-${name}-error`} className={styles.error}>{errors[name]}</span> : null);
  const caption = (title, optional) => <span className={styles.label}>{title}{optional && <span className={styles.optional}> {text.optional}</span>}</span>;
  const input = (name, title, { optional = false, hint, ...props } = {}) => (
    <label className={styles.field}>
      {caption(title, optional)}
      <input className={styles.control} id={`pw-${name}`} name={name} value={values[name]} onChange={update} maxLength={MAX[name]} aria-invalid={Boolean(errors[name])} aria-describedby={describedBy(name, hint)} aria-required={optional ? undefined : true} {...props} />
      {hint && <span id={`pw-${name}-hint`} className={styles.hint}>{hint}</span>}
      {fieldError(name)}
    </label>
  );
  const select = (name, title, options, placeholder, { optional = false, hint } = {}) => (
    <label className={styles.field}>
      {caption(title, optional)}
      <select className={styles.control} id={`pw-${name}`} name={name} value={values[name]} onChange={update} aria-invalid={Boolean(errors[name])} aria-describedby={describedBy(name, hint)} aria-required={optional ? undefined : true}>
        <option value="">{placeholder}</option>
        {options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}
      </select>
      {hint && <span id={`pw-${name}-hint`} className={styles.hint}>{hint}</span>}
      {fieldError(name)}
    </label>
  );
  const textarea = (name, title, { optional = false, rows = 4 } = {}) => (
    <label className={`${styles.field} ${styles.full}`}>
      {caption(title, optional)}
      <textarea className={styles.control} id={`pw-${name}`} name={name} value={values[name]} onChange={update} rows={rows} maxLength={MAX[name]} aria-invalid={Boolean(errors[name])} aria-describedby={describedBy(name)} aria-required={optional ? undefined : true} />
      {fieldError(name)}
    </label>
  );

  const R = text.review.labels;
  const show = (value) => (String(value ?? "").trim() ? value : text.review.notProvided);
  const reviewSections = [
    ["organisation", 0, [[R.companyName, values.companyName], [R.industry, values.industry], [R.contactPerson, values.contactPerson], [R.jobTitle, values.jobTitle], [R.email, values.email], [R.phone, values.phone]]],
    ["training", 1, [[R.category, values.category], [R.programme, programme()], [R.participants, values.participants], [R.location, location()], [R.month, values.month], [R.budget, values.budget], [R.objectives, values.objectives], [R.notes, values.notes]]],
  ];
  const errorList = Object.entries(errors);
  const current = text.steps[step];

  return <div className={styles.layout}>
    <form className={styles.card} onSubmit={submit} noValidate aria-labelledby="proposal-step-title">
      <ol className={styles.steps} aria-label="Proposal request steps">
        {text.steps.map((item, index) => <li key={item.key} className={index === step ? styles.stepCurrent : index < step ? styles.stepDone : styles.step} aria-current={index === step ? "step" : undefined}><b>{String(index + 1).padStart(2, "0")}</b>{item.label}</li>)}
      </ol>
      <p className={styles.stepOf}>{text.stepOf(step + 1, total)}</p>
      <h3 id="proposal-step-title" className={styles.title} ref={heading} tabIndex={-1}>{current.title}</h3>
      <p className={styles.lead}>{current.lead}</p>

      {errorList.length > 0 && (
        <div className={styles.summary} role="alert" tabIndex={-1} ref={summary}>
          <p>{text.errors.summary}</p>
          <ul>{errorList.map(([name, message]) => <li key={name}><a href={`#pw-${name}`} onClick={(event) => { event.preventDefault(); document.getElementById(`pw-${name}`)?.focus(); }}>{message}</a></li>)}</ul>
        </div>
      )}

      {step === 0 && <fieldset className={styles.grid}>
        <legend className={styles.srOnly}>{current.title}</legend>
        {input("companyName", F.companyName, { autoComplete: "organization" })}
        {select("industry", F.industry, industries.map((item) => [item, item]), F.industryPlaceholder)}
        {input("contactPerson", F.contactPerson, { autoComplete: "name" })}
        {input("jobTitle", F.jobTitle, { optional: true, autoComplete: "organization-title" })}
        {input("email", F.email, { type: "email", inputMode: "email", autoComplete: "email" })}
        {input("phone", F.phone, { type: "tel", inputMode: "tel", autoComplete: "tel" })}
      </fieldset>}

      {step === 1 && <fieldset className={styles.grid}>
        <legend className={styles.srOnly}>{current.title}</legend>
        {select("category", F.category, categories.map((item) => [item, item]), F.categoryPlaceholder)}
        {select("courseChoice", F.course, [...courseCatalog.map((course) => [course.slug, course.title]), [OTHER, F.courseOther]], F.coursePlaceholder, { optional: true, hint: F.courseHint })}
        {values.courseChoice === OTHER && input("programmeOther", F.programmeOther, { optional: true, maxLength: MAX.programme })}
        {input("participants", F.participants, { optional: true, inputMode: "numeric", pattern: "[0-9]*" })}
        {input("month", F.month, { optional: true, type: "month", hint: F.monthHint })}
        <fieldset className={`${styles.full} ${styles.choices}`}>
          <legend className={styles.label}>{F.location}<span className={styles.optional}> {text.optional}</span></legend>
          {F.locationOptions.map((option) => <label key={option} className={values.locationOption === option ? styles.choiceOn : styles.choice}><input type="radio" name="locationOption" value={option} checked={values.locationOption === option} onChange={update} />{option}</label>)}
        </fieldset>
        {input("locationDetail", F.locationDetail, { optional: true, hint: F.locationDetailHint, maxLength: MAX.location })}
        {input("budget", F.budget, { optional: true, hint: F.budgetHint })}
        {textarea("objectives", F.objectives, { rows: 5 })}
        {textarea("notes", F.notes, { optional: true, rows: 3 })}
      </fieldset>}

      {step === 2 && <div className={styles.review}>
        {reviewSections.map(([key, target, rows]) => (
          <section key={key} className={styles.reviewBlock} aria-labelledby={`pw-review-${key}`}>
            <div className={styles.reviewHead}><h4 id={`pw-review-${key}`}>{text.review.sections[key]}</h4><button type="button" className={styles.link} onClick={() => goTo(target)}>{text.review.edit}<span className={styles.srOnly}> {text.review.sections[key]}</span></button></div>
            <dl>{rows.map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{show(value)}</dd></div>)}</dl>
          </section>
        ))}
        <label className={styles.consent}><input id="pw-consent" name="consent" type="checkbox" checked={values.consent} onChange={update} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "pw-consent-error" : undefined} /> <span>I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry.</span></label>{fieldError("consent")}
        <p className="wizard-note">Privacy: we use these details to prepare and follow up on your proposal and keep a record of the request. Submitting this form does not subscribe you to marketing emails.<PrivacyNoticeLink newTab /></p>
      </div>}

      {/* Honeypot: the `website` field the API already checks, hidden the same way as on the contact form; people leave it empty. */}
      <div aria-hidden="true" className={styles.trap}>
        <label htmlFor="pw-website">{text.honeypot}</label>
        <input id="pw-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={update} />
      </div>

      {status.state === "error" && <div className={styles.failed} role="alert"><p>{status.message}</p><p>{text.status.retry}</p></div>}
      <div className={styles.nav}>
        {step > 0 ? <button type="button" className={styles.secondary} onClick={() => goTo(step - 1)}>{text.actions.back}</button> : <span />}
        {step < total - 1
          ? <button type="button" className={styles.primary} onClick={() => validate(step) && goTo(step + 1)}>{step === total - 2 ? text.actions.review : text.actions.next}</button>
          : <button type="submit" className={styles.primary} disabled={status.state === "sending"}>{status.state === "sending" ? text.actions.sending : text.actions.submit}</button>}
      </div>
      {status.state === "sending" && <p className={styles.sending} role="status">{status.message}</p>}
    </form>
    <aside className={styles.aside} aria-label={text.aside.title}>
      <h3>{text.aside.title}</h3>
      <ol>{text.aside.steps.map((item) => <li key={item}>{item}</li>)}</ol>
      <p>{text.aside.contact} <a href={text.aside.whatsapp.href} target="_blank" rel="noreferrer">{text.aside.whatsapp.label}</a> or email <a href={`mailto:${text.aside.email}`}>{text.aside.email}</a>.</p>
    </aside>
  </div>;
}
