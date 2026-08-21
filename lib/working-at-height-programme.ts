/**
 * Per-course programme content for the Working at Height certificate family
 * (design_variant "working_at_height_certificate" — rendered generically by
 * components/admin/CertificateDocument.tsx / lib/certificate-html.ts, same
 * pattern as lib/standard-scaffold-programmes.ts). One certificate_templates
 * row (not yet created) would cover this one course; this file supplies the
 * per-programme content that row won't hold on its own, merged into the
 * render config by certData.ts only when the resolved template's
 * design_variant is "working_at_height_certificate".
 *
 * content_status is "draft" for every field here, not "verified" — unlike
 * the Standard Scaffold family (whose "verified" content was copied from
 * dedicated spec sheets in the TERAS UNIVERSAL Training Course Catalogue
 * 2026), there is no dedicated Working at Height spec sheet anywhere in this
 * repo. Every field below is taken from data/courseCatalog.js's public
 * website copy for this course (its `summary` and `modules` array) — real,
 * sourced content, but website marketing copy, not a reviewed certificate
 * spec sheet. Do NOT treat this as business-approved certificate content
 * until someone confirms it, and do NOT add fields not traceable to that
 * source (see the missing learning_outcomes/assessment_methods note below).
 *
 * duration_label is intentionally OMITTED (not set to any string).
 * data/courseCatalog.js's own `duration` field for this course is
 * "Course duration to be confirmed based on scope" -- a placeholder, not a
 * real value. Manufacturing a duration (e.g. copying Standard Scaffold's
 * "10-Day Practical Training") would be inventing data. The generic
 * renderer already handles an absent duration_label correctly: the
 * front-page duration ribbon only renders `if (duration)` (see
 * CertificateDocument.tsx / certificate-html.ts), so omitting this field
 * here simply hides the ribbon rather than showing a wrong or fabricated
 * one.
 *
 * learning_outcomes and assessment_methods are also intentionally omitted.
 * The catalog source has a `modules` (topic) list and a `summary` sentence,
 * but no distinct learning-outcomes or assessment-method lists -- inventing
 * either from the module topics would cross from "sourced content" into
 * "guessed content presented as real". Left unset, certData.ts's merge
 * (mirroring the Standard Scaffold pattern) never sets these config fields,
 * so the generic renderer's own neutral, already-accepted defaults
 * (DEFAULT_OUTCOMES / DEFAULT_ASSESSMENT in CertificateDocument.tsx /
 * certificate-html.ts) render instead -- the same fallback every other
 * template-less certificate in this system already uses, not new
 * Working-at-Height-specific invention.
 */

export interface WorkingAtHeightProgramme {
  programme_key: string;
  /** Live public.courses.id this programme maps to, or null if unmapped. */
  course_id: string | null;
  programme_title: string;
  /** Intentionally optional/unset here -- see file header. Never invent a value. */
  duration_label?: string;
  objectives_text: string;
  coverage_items: string[];
  content_status: "verified" | "draft";
  source: string;
}

export const workingAtHeightProgrammes: Record<string, WorkingAtHeightProgramme> = {
  working_at_height: {
    programme_key: "working_at_height",
    course_id: "963b1f6b-4c15-4833-90da-21aa0af0f544", // Working at Height (re-verified live 2026-08-21)
    programme_title: "Working at Height",
    // duration_label intentionally omitted -- see file header.
    objectives_text:
      "Develop awareness of fall hazards, safe access, equipment use and workplace controls for elevated work.",
    coverage_items: [
      "Working at Height Hazards",
      "Access and Fall Prevention Principles",
      "Equipment and PPE Awareness",
      "Safe Work Planning",
      "Practical Scenario Review",
    ],
    content_status: "draft",
    source:
      "data/courseCatalog.js — \"Working at Height\" (public website copy: summary + modules list). Not a dedicated certificate spec sheet -- DRAFT, business sign-off required before this content is treated as approved. duration field on this course is placeholder text (\"Course duration to be confirmed based on scope\"), not a real value, and is not used here.",
  },
};

/** Looks up a programme config by the certificate's own course_id — null/undefined-safe, returns undefined for a course with no mapping. */
export function findWorkingAtHeightProgrammeByCourseId(courseId: string | null | undefined): WorkingAtHeightProgramme | undefined {
  if (!courseId) return undefined;
  return Object.values(workingAtHeightProgrammes).find((p) => p.course_id === courseId);
}
