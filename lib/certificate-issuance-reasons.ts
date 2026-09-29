/**
 * Stable, business-facing labels for certificate issuance outcomes.
 *
 * Server actions return short machine categories (never raw PostgreSQL
 * messages); this maps them to admin-readable text. Eligibility-view reasons
 * (e.g. `certificate_already_exists`) and issuance-RPC categories
 * (e.g. `branch-not-configured`) both resolve through the same map so the
 * Generate page can render one consistent message.
 */
export const ISSUANCE_REASON_LABEL: Record<string, string> = {
  // Eligibility-view reasons.
  certificate_generation_disabled: "Certificate generation is not enabled for this course.",
  certificate_template_not_configured: "No certificate template is configured for this course.",
  enrollment_cancelled: "This enrollment is cancelled.",
  schedule_not_completed: "The schedule is not completed yet.",
  attendance_not_met: "Attendance is below the required minimum.",
  assessment_missing: "Assessment has not been recorded yet.",
  assessment_not_passed: "Assessment was not passed.",
  competency_not_met: "Competency has not been achieved.",
  certificate_already_exists: "A certificate already exists for this participant on this schedule.",

  // Issuance-RPC outcome categories.
  "branch-not-configured": "Issuing branch is not configured for this schedule.",
  "branch-inactive": "The schedule's issuing branch is inactive or missing.",
  "trainer-not-configured": "Trainer is not configured for this schedule.",
  "template-invalid": "Certificate template is inactive or unavailable.",
  "permission-denied": "You do not have permission to issue certificates.",
  "not-eligible": "The participant is not eligible for certification.",
  "already-certified": "A certificate already exists for this participant on this schedule.",
  conflict: "A conflicting certificate record already exists. Please retry.",
  "system-error": "The certificate could not be generated because of a temporary system error. Please retry or contact an administrator.",
  "not-found": "The participant or schedule could not be found.",
};

export type CertificateIssuanceReason = keyof typeof ISSUANCE_REASON_LABEL;

export function isCertificateIssuanceReason(reason: string): reason is CertificateIssuanceReason {
  return Object.prototype.hasOwnProperty.call(ISSUANCE_REASON_LABEL, reason);
}

export function issuanceReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Not eligible.";
  return ISSUANCE_REASON_LABEL[reason as CertificateIssuanceReason]
    ?? ISSUANCE_REASON_LABEL["system-error"];
}
