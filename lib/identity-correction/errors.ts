// Maps the IDC_* codes raised by the identity-correction RPCs to messages that are safe to show.
// Deliberately generic: no table names, no constraint names, and nothing that reveals whether a given IC or
// name belongs to another person (IDC_IDENTITY_COLLISION and the Working-at-Height block read the same way).
const MESSAGES: Record<string, string> = {
  IDC_CONTROLS_NOT_CONFIGURED: "Identity corrections are not enabled yet. The sealing key, audit anchor and notification channel must be configured first.",
  IDC_WAITING_PERIOD: "The waiting period for this request has not finished yet.",
  IDC_STALE_REQUEST: "The participant or one of their certificates changed after this request was made. Cancel it and start a new request.",
  IDC_IDENTITY_COLLISION: "This number cannot be used. Check the document again.",
  IDC_WAH_DUPLICATE_RELEASE_BLOCKED: "This number cannot be used. Check the document again.",
  IDC_IDENTITY_FORMAT: "The IC/Passport number must have 6 to 20 letters or digits.",
  IDC_NO_CHANGE: "The new value is the same as the current value.",
  IDC_NO_EFFECT: "This request would not change the profile or any certificate.",
  IDC_NO_EXISTING_IDENTITY: "This participant has no IC/Passport number to correct. Use the ordinary profile edit.",
  IDC_NO_CERTIFICATES: "This participant has no active certificate. Use the ordinary profile edit.",
  IDC_PROFILE_IDENTITY_INCONSISTENT: "The participant profile holds two different IC/Passport numbers. Resolve that first.",
  IDC_BAD_KIND: "Choose the type of correction.",
  IDC_BAD_VALUES: "The new values do not match the type of correction.",
  IDC_BAD_NAME: "The new name is too long or contains invalid characters.",
  IDC_REASON_REQUIRED: "A reason is required.",
  IDC_EVIDENCE_REQUIRED: "Add at least one reviewed document.",
  IDC_EVIDENCE_INVALID: "Each document needs a type, a reference, a fingerprint and a review date that is not in the future.",
  IDC_EVIDENCE_REUSED: "A document already used for a different participant cannot be reused.",
  IDC_EVIDENCE_INSUFFICIENT: "More evidence is required: IC/Passport changes and changes to older certificates need two different document types, including a government document.",
  IDC_DECISION_MISSING: "Every certificate needs a decision.",
  IDC_DECISION_INVALID: "One of the certificate decisions is not valid for that certificate.",
  IDC_DECISION_REASON_REQUIRED: "A certificate that is left unchanged or handled specially needs a reason of at least 10 characters.",
  IDC_DECISION_FOREIGN_CERT: "The decision list does not match this participant's certificates. Reload the page.",
  IDC_CLASS_C_DECISION_REQUIRED: "An older certificate shows its IC/Passport live from the profile. Choose how to treat it.",
  IDC_NOT_ENROLLED: "A certificate points to a schedule the participant is not enrolled in.",
  IDC_REQUEST_ALREADY_OPEN: "This participant already has an open correction request.",
  IDC_REQUEST_NOT_PENDING: "This request is already closed.",
  IDC_SECOND_APPROVAL_REQUIRED: "A second Super Admin must approve this request first.",
  IDC_SELF_APPROVAL: "The person who made the request cannot approve it.",
  IDC_TEXT_CONTAINS_IDENTITY: "Reasons and document references must not contain an IC/Passport number. Describe the document instead.",
  IDC_QUERY_INVALID: "Enter between 3 and 60 characters of the certificate number.",
  IDC_BAD_STATUS: "Unknown status filter.",
  IDC_CORRECTION_REQUIRED: "Name and IC/Passport of a participant who holds certificates can only be changed through an identity correction.",
};

const NOT_AUTHORIZED = "Only an active Super Admin can use identity corrections.";
const FALLBACK = "Unable to complete the request. Nothing was changed.";

export function identityCorrectionMessage(error: { message?: string; code?: string } | null | undefined): string {
  const text = error?.message ?? "";
  const code = /IDC_[A-Z_]+/.exec(text)?.[0];
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error?.code === "42501" || /not authorized/i.test(text)) return NOT_AUTHORIZED;
  if (error?.code === "P0002" || /not found/i.test(text)) return "The record could not be found.";
  return FALLBACK;
}
