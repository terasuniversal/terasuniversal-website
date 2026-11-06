// Client-side helpers for the public Contact and Request Proposal forms.
//
// Everything here mirrors what /api/contact and /api/request-proposal already enforce. The server stays the source
// of truth: nothing in this file widens or narrows its contract, it only lets the forms tell people what is wrong
// before a request is sent. Pure functions on purpose, so scripts/contact-proposal-forms-contract.mts can run them
// without a browser.

export const CONTACT_ENQUIRY_TYPES = ["Corporate", "Individual", "Government", "Training"];
export const CONTACT_INTERESTS = ["Industrial Safety Training", "Technical Competency", "Industrial Consultancy", "Workforce Development", "Custom Corporate Training", "Other Enquiry"];
export const PROPOSAL_INDUSTRIES = ["Oil & Gas", "Petrochemical", "Construction", "Manufacturing", "Marine & Offshore", "Power & Utilities", "Government & GLC", "Others"];
export const PROPOSAL_CATEGORIES = ["Industrial Safety", "Technical Competency", "Industrial Consultancy", "Workforce Development"];

// Limits copied from contactEnquirySchema (lib/validation/schemas.ts) and MAX_LENGTHS (app/api/request-proposal/route.js).
export const CONTACT_LIMITS = { name: 120, company: 160, email: 254, phone: 40, course: 160, message: 3000 };
export const PROPOSAL_LIMITS = { companyName: 160, contactPerson: 120, jobTitle: 120, email: 254, phone: 40, programme: 160, location: 160, budget: 80, objectives: 3000, notes: 3000 };
const MAX_PARTICIPANTS = 1_000_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (value) => String(value == null ? "" : value).trim();

function tooLong(errors, values, limits) {
  for (const [field, max] of Object.entries(limits)) {
    if (!errors[field] && text(values[field]).length > max) errors[field] = `Keep this to ${max} characters or fewer.`;
  }
}

/** @returns {Record<string, string>} field name -> message; empty when the values can be sent. */
export function validateContact(values) {
  const errors = {};
  const name = text(values.name);
  if (!name) errors.name = "Enter your name.";
  else if (name.length < 2) errors.name = "Enter your full name (at least 2 characters).";
  const email = text(values.email);
  if (!email) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address, for example name@company.com.";
  const phone = text(values.phone);
  if (!phone) errors.phone = "Enter a phone number we can reach you on.";
  else if (phone.length < 5) errors.phone = "Enter the full phone number (at least 5 characters).";
  if (!CONTACT_ENQUIRY_TYPES.includes(values.enquiryType)) errors.enquiryType = "Choose an enquiry type.";
  if (!text(values.course)) errors.course = "Select what you are enquiring about.";
  if (!text(values.message)) errors.message = "Enter a short message.";
  tooLong(errors, values, CONTACT_LIMITS);
  return errors;
}

export function buildContactPayload(values, formStartedAt) {
  return {
    name: text(values.name),
    company: text(values.company),
    email: text(values.email),
    phone: text(values.phone),
    enquiryType: values.enquiryType,
    subject: text(values.course),
    message: text(values.message),
    sourcePage: "contact_page",
    website: text(values.website),
    formStartedAt,
  };
}

/** @returns {Record<string, string>} field name -> message; empty when the values can be sent. */
export function validateProposal(values) {
  const errors = {};
  if (!text(values.companyName)) errors.companyName = "Enter your company name.";
  if (!text(values.contactPerson)) errors.contactPerson = "Enter the contact person's name.";
  const email = text(values.email);
  if (!email) errors.email = "Enter a business email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid business email address, for example name@company.com.";
  if (!text(values.phone)) errors.phone = "Enter a phone number we can reach you on.";
  if (!text(values.industry)) errors.industry = "Select your industry.";
  else if (!PROPOSAL_INDUSTRIES.includes(values.industry)) errors.industry = "Select one of the listed industries.";
  if (!text(values.category)) errors.category = "Select a training category.";
  else if (!PROPOSAL_CATEGORIES.includes(values.category)) errors.category = "Select one of the listed categories.";
  if (!text(values.objectives)) errors.objectives = "Describe what you want the training to achieve.";
  const participants = text(values.participants);
  if (participants && (!/^\d+$/.test(participants) || Number(participants) < 1 || Number(participants) > MAX_PARTICIPANTS)) errors.participants = "Enter a whole number of participants, 1 or more.";
  const month = text(values.month);
  if (month && !MONTH_PATTERN.test(month)) errors.month = "Enter the month as year-month, for example 2026-12.";
  if (values.consent !== true) errors.consent = "Tick the box to confirm before sending.";
  tooLong(errors, values, PROPOSAL_LIMITS);
  return errors;
}

export function buildProposalPayload(values, formStartedAt) {
  return {
    companyName: text(values.companyName),
    contactPerson: text(values.contactPerson),
    jobTitle: text(values.jobTitle),
    email: text(values.email),
    phone: text(values.phone),
    industry: values.industry,
    category: values.category,
    programme: text(values.programme),
    participants: text(values.participants),
    location: text(values.location),
    month: text(values.month),
    budget: text(values.budget),
    objectives: text(values.objectives),
    notes: text(values.notes),
    consent: values.consent === true,
    website: text(values.website),
    formStartedAt,
  };
}

// The route answers 400 with `errors` keyed by payload name; the Contact form's select is named `course` but is sent as `subject`.
const SERVER_FIELD_TO_FORM_FIELD = { subject: "course" };

/**
 * Turns a failed response into what the form shows. `status` is 0 when the request never completed.
 * Never echoes arbitrary server text for the cases where the route's wording would mislead (503 in a non-Production environment).
 */
export function describeSubmitFailure(status, body, kind) {
  const noun = kind === "contact" ? "enquiry" : "request";
  const direct = "Please try again, or contact us directly by email or phone.";
  const serverMessage = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : "";
  const fieldErrors = {};
  if (body?.errors && typeof body.errors === "object") {
    for (const [key, message] of Object.entries(body.errors)) {
      if (typeof message === "string") fieldErrors[SERVER_FIELD_TO_FORM_FIELD[key] || key] = message;
    }
  }
  if (status === 0) return { message: `We could not reach the server, so your ${noun} was not sent. Check your connection and try again.`, fieldErrors };
  if (status === 429) return { message: serverMessage || `You have already sent a ${noun} moments ago. Please wait a minute before sending another.`, fieldErrors };
  if (status === 503 && body?.code === "outbound_disabled_non_production") return { message: `This environment does not accept live submissions, so your ${noun} was not sent. ${direct}`, fieldErrors };
  if (status === 403) return { message: `We could not verify this request, so your ${noun} was not sent. Reload the page and try again.`, fieldErrors };
  if (status === 400 && serverMessage) return { message: serverMessage, fieldErrors };
  return { message: `We could not send your ${noun} right now. ${direct}`, fieldErrors };
}
