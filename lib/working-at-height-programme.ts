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
 * content_status is "verified": business-approved TERAS programme content,
 * approved 2026-08-21. Supersedes the earlier catalog-derived draft (see git
 * history) -- that draft was sourced only from data/courseCatalog.js's
 * public website copy and was never treated as certificate-ready content;
 * every field below (objective, coverage, learning outcomes, assessment
 * methods, duration) was explicitly supplied and approved by the business
 * for this purpose.
 *
 * duration_label uses this certificate family's existing "{N}-Day Practical
 * Training" convention (see lib/standard-scaffold-programmes.ts's own
 * 2-day entries: intermediate_inspection / basic_inspection /
 * advanced_inspection all use "2-Day Practical Training") -- not a new
 * format invented for this course.
 */

export interface WorkingAtHeightProgramme {
  programme_key: string;
  /** Live public.courses.id this programme maps to, or null if unmapped. */
  course_id: string | null;
  programme_title: string;
  duration_label: string;
  objectives_text: string;
  coverage_items: string[];
  learning_outcomes: string[];
  assessment_methods: string[];
  content_status: "verified" | "draft";
  source: string;
}

export const workingAtHeightProgrammes: Record<string, WorkingAtHeightProgramme> = {
  working_at_height: {
    programme_key: "working_at_height",
    course_id: "963b1f6b-4c15-4833-90da-21aa0af0f544", // Working at Height (re-verified live 2026-08-21)
    programme_title: "Working at Height",
    duration_label: "2-Day Practical Training",
    objectives_text:
      "To provide participants with the knowledge and practical awareness required to identify working-at-height hazards, understand fall-prevention and fall-protection principles, select and use appropriate access and personal protective equipment, and apply safe work practices for activities performed at height.",
    coverage_items: [
      "Working at Height Hazards and Risk Controls",
      "Hierarchy of Fall Prevention and Fall Protection",
      "Safe Access and Egress",
      "Ladders, Platforms and Elevated Work Areas",
      "Full-Body Harnesses, Lanyards and Anchorage Awareness",
      "Inspection and Proper Use of PPE",
      "Safe Work Planning and Permit/Control Requirements",
      "Emergency and Rescue Awareness",
      "Practical Scenario Review",
    ],
    learning_outcomes: [
      "Identify common hazards associated with working at height",
      "Explain appropriate fall-prevention and fall-protection control measures",
      "Recognise suitable access and fall-protection equipment",
      "Perform basic pre-use checks on relevant PPE",
      "Apply safe work practices and planning principles for work at height",
      "Respond appropriately to unsafe conditions or emergency situations involving work at height",
    ],
    assessment_methods: [
      "Theory Knowledge Assessment",
      "Practical Demonstration / Scenario-Based Assessment",
      "PPE and Equipment Identification / Pre-Use Check",
      "Trainer Observation and Continuous Evaluation",
      "100% Attendance Requirement",
    ],
    content_status: "verified",
    source: "Business-approved TERAS programme content, approved 2026-08-21.",
  },
};

/** Looks up a programme config by the certificate's own course_id — null/undefined-safe, returns undefined for a course with no mapping. */
export function findWorkingAtHeightProgrammeByCourseId(courseId: string | null | undefined): WorkingAtHeightProgramme | undefined {
  if (!courseId) return undefined;
  return Object.values(workingAtHeightProgrammes).find((p) => p.course_id === courseId);
}
