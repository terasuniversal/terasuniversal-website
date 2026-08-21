/**
 * Per-course programme content for the Standard Scaffold certificate family
 * (design_variant "standard_scaffold_certificate" — see
 * components/admin/CertificateDocument.tsx / lib/certificate-html.ts, both
 * rendered generically and gated by config.programme_level/programme_title
 * etc.). One shared certificate_templates row covers all seven programmes
 * below; this file supplies the per-programme content that row can't hold on
 * its own, keyed by the course's live `id` — merged into the render config
 * by certData.ts only when the resolved template's design_variant is
 * "standard_scaffold_certificate".
 *
 * `course_id` values were re-verified live against the connected Supabase
 * project on 2026-08-21 (course mapping resolution pass) and point at the
 * current, non-deleted `courses` rows: "Basic/Intermediate/Advanced
 * Scaffolding Erector" and "Basic/Intermediate/Advanced Scaffolding
 * Inspector". The 3 erection `course_id`s originally recorded here (as of
 * 2026-08-12) were soft-deleted on 2026-08-14 in an unrelated course-data
 * cleanup; the 3 inspection `course_id`s were null because no course row
 * existed yet at all -- both are now resolved to the live rows above.
 * `course_id` remains null only for Scaffold Awareness: no live `courses` row
 * exists for it, and its content is still `draft`/placeholder pending
 * business approval -- see that entry's own comment. Nothing in certData.ts
 * can reach any entry via a real certificate until a course row's
 * `certificate_template_id` is actually bound to a "standard_scaffold_certificate"
 * template, which remains deferred pending business sign-off (see
 * supabase/post_baseline_drafts/README.md) -- these course_id updates alone
 * activate nothing.
 *
 * content_status: "verified" content is copied/derived from
 * data/courseCatalog.js, whose own header states it's "taken directly from
 * the course spec sheets [...] nothing here is estimated or invented"
 * (TERAS UNIVERSAL Training Course Catalogue 2026). "draft" content (Scaffold
 * Awareness only — no spec sheet exists anywhere in the repo for it) is
 * placeholder text written for this task and must not be treated as
 * business-approved until someone confirms it.
 */

export interface StandardScaffoldProgramme {
  programme_key: string;
  /** Live public.courses.id this programme maps to, or null if no course row exists yet. */
  course_id: string | null;
  level: "Basic" | "Intermediate" | "Advanced" | "Awareness";
  category: "Scaffold Erection" | "Scaffold Inspection" | "Scaffold Awareness";
  programme_title: string;
  duration_label: string;
  objectives_text: string;
  coverage_items: string[];
  learning_outcomes: string[];
  assessment_methods: string[];
  content_status: "verified" | "draft";
  source: string;
  /**
   * Set only on the 3 Erector programmes (Basic/Intermediate/Advanced) — the
   * scaffold background watermark's density, merged into the render config
   * by certData.ts (see lib/certificate-watermarks.ts). Never set on an
   * Inspection programme -- those use inspector_watermark_level instead, a
   * visually distinct family (see that field's own comment). Deliberately
   * unset on Awareness: no watermark work has been done for that programme.
   */
  watermark_level?: "basic" | "intermediate" | "advanced";
  /**
   * Set only on the 3 Inspection programmes (Basic/Intermediate/Advanced) —
   * selects the distinct clipboard/checklist/magnifier Inspector watermark
   * family (see lib/certificate-watermarks.ts's inspectorWatermarkShapes),
   * merged into the render config by certData.ts the same way
   * watermark_level is. Never set alongside watermark_level on the same
   * programme -- Erector and Inspection are mutually exclusive families.
   */
  inspector_watermark_level?: "basic" | "intermediate" | "advanced";
}

export const standardScaffoldProgrammes: Record<string, StandardScaffoldProgramme> = {
  basic_erection: {
    programme_key: "basic_erection",
    course_id: "2a78decf-6997-4626-a7cc-a1a23a110cf8", // Basic Scaffolding Erector (re-verified live 2026-08-21)
    level: "Basic",
    category: "Scaffold Erection",
    programme_title: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME",
    duration_label: "10-Day Practical Training",
    objectives_text:
      "Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures in accordance with industry standards and workplace safety requirements.",
    // Condensed to short topic labels (from the same source's "modules" list)
    // to fit the generic back page's tested vertical budget — see the
    // advanced_inspection entry's history below for why full sentences here
    // overflow the fixed-height page.
    coverage_items: [
      "Scaffolding Components & Terminology",
      "Workplace Hazard Identification",
      "Personal Protective Equipment (PPE)",
      "Safe Scaffold Erection & Dismantling",
      "Pre-Use Component Inspection",
      "Safety Procedures & Best Practices",
      "Teamwork in Scaffolding Operations",
    ],
    learning_outcomes: [
      "Identify scaffolding components and terminology correctly",
      "Recognise and control common workplace hazards",
      "Select and use PPE correctly",
      "Erect and dismantle basic scaffold structures safely",
      "Carry out a pre-use inspection of scaffold components",
    ],
    assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Basic Scaffolder (Level 1)\" (TERAS UNIVERSAL Training Course Catalogue 2026)",
    watermark_level: "basic",
  },
  intermediate_erection: {
    programme_key: "intermediate_erection",
    course_id: "904293c4-8792-41d7-8744-42143887e577", // Intermediate Scaffolding Erector (re-verified live 2026-08-21)
    level: "Intermediate",
    category: "Scaffold Erection",
    programme_title: "TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME",
    duration_label: "10-Day Practical Training",
    objectives_text:
      "Further develops the knowledge, technical skills and practical competency of scaffolders who have completed Basic Scaffold Erection, for greater responsibilities in construction, maintenance, petrochemical and Oil & Gas operations.",
    coverage_items: [
      "Work Planning & Organisation",
      "Reading Scaffold Drawings & Instructions",
      "Erecting Complex Scaffold Structures",
      "Hazard Identification & Control Measures",
      "Inspecting Completed Structures",
      "Safe Supervision Practices",
      "Industry Standards & Regulatory Requirements",
    ],
    learning_outcomes: [
      "Plan scaffolding work activities safely",
      "Interpret scaffold drawings and work instructions",
      "Erect, modify and dismantle more complex scaffold structures",
      "Identify hazards and apply effective control measures",
      "Conduct inspections on completed scaffold structures",
    ],
    assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Intermediate Scaffolder (Level 2)\" (TERAS UNIVERSAL Training Course Catalogue 2026)",
    watermark_level: "intermediate",
  },
  advanced_erection: {
    programme_key: "advanced_erection",
    course_id: "b9c737b8-8a97-4c91-91ee-c65dc5982ca7", // Advanced Scaffolding Erector (re-verified live 2026-08-21)
    level: "Advanced",
    category: "Scaffold Erection",
    programme_title: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME",
    duration_label: "10-Day Practical Training",
    objectives_text:
      "Designed for experienced scaffolders who wish to further enhance their technical expertise and leadership capabilities in complex scaffolding operations, covering advanced planning, supervision, structural stability, inspection and risk management.",
    coverage_items: [
      "Planning Complex Scaffolding Operations",
      "Team Supervision & Safety",
      "Advanced Drawings & Specifications",
      "Scaffold Stability Evaluation",
      "Comprehensive Inspection & Corrective Action",
      "Risk Management & Compliance",
      "Leadership & Communication",
    ],
    learning_outcomes: [
      "Plan and coordinate complex scaffolding operations",
      "Supervise scaffolding teams effectively and safely",
      "Evaluate scaffold stability and identify structural hazards",
      "Conduct comprehensive scaffold inspections",
      "Apply risk management strategies and regulatory requirements",
    ],
    assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Advanced Scaffolder (Level 3)\" (TERAS UNIVERSAL Training Course Catalogue 2026)",
    watermark_level: "advanced",
  },
  basic_inspection: {
    programme_key: "basic_inspection",
    course_id: "b10c2e4b-f35f-478b-b450-f98323926345", // Basic Scaffolding Inspector (re-verified live 2026-08-21)
    level: "Basic",
    category: "Scaffold Inspection",
    programme_title: "TERAS BASIC SCAFFOLD INSPECTION PROGRAMME",
    duration_label: "2-Day Practical Training",
    objectives_text:
      "Equips participants with the fundamental knowledge and practical skills required to inspect scaffolding structures safely and effectively, in accordance with industry standards and regulatory requirements.",
    coverage_items: [
      "Principles of Scaffold Inspection",
      "Scaffolding Components & Functions",
      "Basic Visual Inspection Techniques",
      "Defect & Hazard Recognition",
      "Compliance Verification",
      "Inspection Records & Reporting",
      "Safe Work Practices",
    ],
    learning_outcomes: [
      "Explain the principles of scaffold inspection",
      "Identify scaffolding components and their functions",
      "Conduct a basic visual inspection of a scaffold structure",
      "Recognise defects, hazards and unsafe conditions",
      "Complete a basic scaffold inspection record",
    ],
    assessment_methods: ["Theory Assessment", "Practical Inspection Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Scaffolding Inspector (Basic)\" (TERAS UNIVERSAL Training Course Catalogue 2026); course record now live in the CMS as \"Basic Scaffolding Inspector\" (draft status)",
    inspector_watermark_level: "basic",
  },
  intermediate_inspection: {
    programme_key: "intermediate_inspection",
    course_id: "18945a4b-8df0-4f39-bbf9-7bd91c1bb58d", // Intermediate Scaffolding Inspector (re-verified live 2026-08-21)
    level: "Intermediate",
    category: "Scaffold Inspection",
    programme_title: "TERAS INTERMEDIATE SCAFFOLD INSPECTION PROGRAMME",
    duration_label: "2-Day Practical Training",
    objectives_text:
      "Enhances participants' competency in inspecting more complex scaffolding structures and evaluating compliance with industry standards, safety regulations and workplace requirements.",
    coverage_items: [
      "Inspecting Complex Scaffold Structures",
      "Stability & Structural Integrity Evaluation",
      "Defect & Non-Compliance Identification",
      "Applying Industry Standards",
      "Comprehensive Inspection Reporting",
      "Corrective Action Assessment",
      "Scaffold Safety Best Practices",
    ],
    learning_outcomes: [
      "Inspect intermediate and complex scaffold structures",
      "Evaluate scaffold stability and structural integrity",
      "Identify defects, hazards and non-compliance issues",
      "Prepare a comprehensive scaffold inspection report",
      "Assess corrective actions before approving a scaffold for use",
    ],
    assessment_methods: ["Theory Assessment", "Practical Inspection Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Scaffolding Inspector (Intermediate)\" (TERAS UNIVERSAL Training Course Catalogue 2026); course record now live in the CMS as \"Intermediate Scaffolding Inspector\" (draft status)",
    inspector_watermark_level: "intermediate",
  },
  advanced_inspection: {
    programme_key: "advanced_inspection",
    course_id: "b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c", // Advanced Scaffolding Inspector (re-verified live 2026-08-21)
    level: "Advanced",
    category: "Scaffold Inspection",
    programme_title: "TERAS ADVANCED SCAFFOLD INSPECTION PROGRAMME",
    duration_label: "2-Day Practical Training",
    objectives_text:
      "Designed for experienced scaffolding inspectors responsible for inspecting complex scaffolding systems, evaluating structural integrity and ensuring full compliance with industry standards, regulatory requirements and workplace safety practices.",
    coverage_items: [
      "Comprehensive Structural Inspections",
      "Structural Integrity Evaluation",
      "Critical Defect Identification",
      "Advanced Risk Assessment",
      "Standards & Regulatory Compliance",
      "Technical Inspection Reporting",
      "Technical Judgement & Approval",
    ],
    learning_outcomes: [
      "Conduct comprehensive inspections of complex scaffolding structures",
      "Evaluate structural integrity and overall safety performance",
      "Identify critical defects and high-risk conditions",
      "Perform advanced risk assessments with recommended corrective actions",
      "Prepare detailed technical inspection reports",
    ],
    assessment_methods: ["Theory Assessment", "Practical Inspection Assessment", "Continuous Trainer Evaluation"],
    content_status: "verified",
    source: "data/courseCatalog.js — \"Scaffolding Inspector (Advanced)\" (TERAS UNIVERSAL Training Course Catalogue 2026); course record now live in the CMS as \"Advanced Scaffolding Inspector\" (draft status)",
    inspector_watermark_level: "advanced",
  },
  scaffold_awareness: {
    programme_key: "scaffold_awareness",
    course_id: null,
    level: "Awareness",
    category: "Scaffold Awareness",
    programme_title: "TERAS SCAFFOLD AWARENESS PROGRAMME",
    // DRAFT — no spec sheet exists anywhere in this repo (data/courseCatalog.js
    // has no "Scaffold Awareness" entry; "Working at Height" and "Lifting
    // Awareness" are different topics). Every field below is placeholder
    // content written for this task, not sourced from an approved spec sheet.
    // Do not bind a course/template to this programme_key until someone
    // supplies and approves real content.
    duration_label: "1-Day Awareness Training",
    objectives_text:
      "DRAFT — pending approval. Intended to build general awareness of scaffold-related hazards, safe access and basic safety responsibilities for personnel who work near, but do not erect or inspect, scaffolding.",
    coverage_items: [
      "DRAFT: Introduction to scaffolding and its role on site",
      "DRAFT: Recognising common scaffold hazards",
      "DRAFT: Safe access and use of scaffold structures",
      "DRAFT: Reporting unsafe scaffold conditions",
      "DRAFT: Basic PPE and safe work practices near scaffolding",
    ],
    learning_outcomes: [
      "DRAFT: Recognise common scaffold-related hazards",
      "DRAFT: Follow safe access procedures around scaffold structures",
      "DRAFT: Report unsafe or non-conforming scaffold conditions",
    ],
    assessment_methods: ["Theory Session", "Trainer Observation"],
    content_status: "draft",
    source: "DRAFT — no verified spec sheet exists in this repo for Scaffold Awareness; authored for this task, pending business approval",
  },
};

/** Looks up a programme config by the certificate's own course_id — null/undefined-safe, returns undefined for a course with no mapping (e.g. any course outside this family). */
export function findStandardScaffoldProgrammeByCourseId(courseId: string | null | undefined): StandardScaffoldProgramme | undefined {
  if (!courseId) return undefined;
  return Object.values(standardScaffoldProgrammes).find((p) => p.course_id === courseId);
}
