import { z } from "zod";

/**
 * Zod schemas — the single source of truth for input validation in server
 * actions. Every mutating action parses its input through one of these
 * before touching the database (defence in depth on top of RLS + DB checks).
 */

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const courseSchema = z.object({
  title: z.string().trim().min(2).max(160),
  slug,
  category: z.string().trim().max(80).optional().or(z.literal("")),
  summary: z.string().trim().max(500).optional().or(z.literal("")),
  overview: z.string().trim().max(8000).optional().or(z.literal("")),
  objectives: stringArray,
  duration: z.string().trim().max(80).optional().or(z.literal("")),
  delivery_modes: z
    .array(z.enum(["public", "in_house", "onsite", "online", "hybrid"]))
    .default([]),
  target_audience: stringArray,
  requirements: stringArray,
  modules: z
    .array(z.object({ title: z.string().min(1), items: stringArray.optional() }))
    .default([]),
  faq: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).default([]),
  fee: z.coerce.number().nonnegative().optional().nullable(),
  status: z.enum(["draft", "scheduled", "published", "archived"]).default("draft"),
  featured: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().default(0),
  seo_title: z.string().trim().max(160).optional().or(z.literal("")),
  seo_description: z.string().trim().max(320).optional().or(z.literal("")),
  // Certificate eligibility engine config (v_certificate_eligibility) --
  // never inferred from category/template names, always explicit per course.
  certificate_type: z.enum(["participation", "completion", "competency"]).default("completion"),
  attendance_min_percent: z.coerce.number().min(0).max(100).default(100),
  assessment_required: z.coerce.boolean().default(false),
  competency_required: z.coerce.boolean().default(false),
  // Generation safety (v_certificate_eligibility's certificate_generation_disabled /
  // certificate_template_not_configured gate) -- a course must never be able to
  // generate certificates without staff having explicitly enabled it AND bound
  // a specific template. IDs only, never resolved by title/course-name matching.
  certificate_generation_enabled: z.coerce.boolean().default(false),
  certificate_template_id: z.string().uuid().optional().nullable(),
})
  .refine((v) => !v.competency_required || v.assessment_required, {
    message: "Competency requirement needs assessment to also be required",
    path: ["competency_required"],
  })
  .refine((v) => !v.certificate_generation_enabled || !!v.certificate_template_id, {
    message: "Select a certificate template before enabling certificate generation",
    path: ["certificate_template_id"],
  });
export type CourseInput = z.infer<typeof courseSchema>;

export const newsSchema = z.object({
  title: z.string().trim().min(2).max(200),
  slug,
  excerpt: z.string().trim().max(1000).optional().or(z.literal("")),
  body: z.string().trim().max(30000).optional().or(z.literal("")),
  category_id: z.string().uuid().optional().or(z.literal("")),
  featured_image_url: z.string().url().max(1000).optional().or(z.literal("")),
  featured: z.coerce.boolean().default(false),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  seo_title: z.string().trim().max(160).optional().or(z.literal("")),
  seo_description: z.string().trim().max(320).optional().or(z.literal("")),
});
export type NewsInput = z.infer<typeof newsSchema>;

// Targets the live public.course_schedules table (the canonical schedule
// table -- see SCHEDULES_ARCHITECTURE_DECISION.md). trainer_id/trainer_name
// stays a plain text field until a real trainers table exists (deferred).
export const scheduleSchema = z
  .object({
    course_id: z.string().uuid("Select a course"),
    trainer_name: z.string().trim().max(160).optional().or(z.literal("")),
    venue: z.string().trim().max(200).optional().or(z.literal("")),
    training_mode: z.string().trim().max(40).optional().or(z.literal("")),
    start_date: z.string().date("Enter a valid start date"),
    end_date: z.string().date("Enter a valid end date"),
    exam_date: z.string().date("Enter a valid exam date").optional().or(z.literal("")),
    start_time: z.string().optional().or(z.literal("")),
    end_time: z.string().optional().or(z.literal("")),
    capacity: z.coerce.number().int().min(0).default(0),
    status: z.enum(["open", "full", "in_progress", "completed", "cancelled"]).default("open"),
    is_published: z.boolean().default(true),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    // Primary assessor assignment (Assessor Management Phase 1) — stored
    // relationally in schedule_assessors, never on course_schedules.
    assessor_id: z.string().uuid("Select an assessor").optional().or(z.literal("")),
    // Sales CRM Phase 3 handoff traceability — set only when this schedule
    // is created from a Won Opportunity's "Create Training Schedule" action;
    // empty string on every normal create/edit.
    source_opportunity_id: z.string().uuid().optional().or(z.literal("")),
    source_quotation_id: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

// schedule_participants enrollment write path (previously had no Zod schema
// at all -- the insert payload was built ad hoc).
export const scheduleParticipantSchema = z.object({
  schedule_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  registration_status: z.enum(["registered", "confirmed", "cancelled", "completed"]).default("registered"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ScheduleParticipantInput = z.infer<typeof scheduleParticipantSchema>;

// Training Schedule Groups V1 (schedule_groups). trainer_id/assessor_id are
// optional -- a group can exist with no trainer assigned yet, and
// assessor_id is an OVERRIDE only (schedule.assessor via schedule_assessors
// remains the default when this is empty). start_time/end_time mirror
// scheduleSchema's own optional-string-or-empty shape.
export const scheduleGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(80),
  trainer_id: z.string().uuid("Select a trainer").optional().or(z.literal("")),
  assessor_id: z.string().uuid("Select an assessor").optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(0).optional().nullable(),
  start_time: z.string().optional().or(z.literal("")),
  end_time: z.string().optional().or(z.literal("")),
});
export type ScheduleGroupInput = z.infer<typeof scheduleGroupSchema>;

/**
 * One row of participant_skill_results (Phase 2 schema — table ships empty;
 * no CMS screen writes through this yet, see supabase/migrations/
 * 20260811090000_create_participant_skill_results.sql). Enums mirror the
 * table's CHECK constraints exactly; no business rules beyond shape
 * validation are encoded here until Phase 2B/2C are approved.
 */
export const participantSkillResultSchema = z.object({
  schedule_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  area: z.enum(["theory_session", "practical_training", "safety_awareness", "practical_assessment"]),
  status: z.enum(["not_recorded", "completed", "passed", "failed"]).default("not_recorded"),
  score: z.coerce.number().min(0).max(100).optional().nullable(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type ParticipantSkillResultInput = z.infer<typeof participantSkillResultSchema>;

// Public contact lead capture (ContactForm.js homepage widget +
// ContactEnquiryForm.js on /contact). subject/enquiryType option lists
// differ slightly between the two forms, so subject stays free text rather
// than an enum -- enquiryType is identical across both and safe to enum.
export const contactEnquirySchema = z.object({
  name: z.string().trim().min(2, "Full name is required").max(120),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(254),
  phone: z.string().trim().min(5, "Phone is required").max(40),
  enquiryType: z.enum(["Corporate", "Individual", "Government", "Training"]),
  subject: z.string().trim().min(1, "Please select what you're enquiring about").max(160),
  message: z.string().trim().min(1, "Message is required").max(3000),
  sourcePage: z.enum(["homepage", "contact_page"]),
});
export type ContactEnquiryInput = z.infer<typeof contactEnquirySchema>;

export const participantSchema = z.object({
  // Required fields (friendly messages).
  full_name: z.string().trim().min(2, "Full name is required").max(160),
  ic_passport_no: z.string().trim().min(3, "IC / Passport is required").max(40),
  company: z.string().trim().min(1, "Company is required").max(160),
  phone: z.string().trim().min(5, "Phone is required").max(40),
  // Optional fields.
  email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  nationality: z.string().trim().max(80).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
  gender: z.enum(["Male", "Female", ""]).optional(),
  date_of_birth: z.string().date("Enter a valid date").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  emergency_contact_name: z.string().trim().max(160).optional().or(z.literal("")),
  emergency_contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
  registration_date: z.string().date().optional().or(z.literal("")),
  schedule_id: z.string().uuid().optional().nullable(),
  company_id: z.string().uuid().optional().nullable(),
  status: z.enum(["registered", "confirmed", "attended", "no_show", "cancelled"]).default("registered"),
});
export type ParticipantInput = z.infer<typeof participantSchema>;

/**
 * Personal Registration from a Sales Lead — a separate individual-enrollment
 * path (not the B2B Opportunity flow). Identity/contact fields mirror the
 * participant rules; IC/Passport is the only dedupe key (the app has no
 * email/phone participant uniqueness rule, so none is invented here).
 */
export const personalRegistrationSchema = z.object({
  schedule_id: z.string().uuid("Select a training schedule"),
  full_name: z.string().trim().min(2, "Full name is required").max(160),
  ic_passport_no: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
});
export type PersonalRegistrationInput = z.infer<typeof personalRegistrationSchema>;

/** Company Registration from a Sales Lead — several participants enrolled into
 *  one existing eligible schedule, associated with the company (reuse an
 *  existing company record by name; never create a duplicate company here). */
export const companyRegistrationSchema = z.object({
  schedule_id: z.string().uuid("Select a training schedule"),
  company_id: z.string().uuid().optional().or(z.literal("")),
  company_name: z.string().trim().max(200).optional().or(z.literal("")),
  participants: z
    .array(
      z.object({
        full_name: z.string().trim().min(2, "Participant name is required").max(160),
        ic_passport_no: z.string().trim().max(40).optional().or(z.literal("")),
        email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
      })
    )
    .min(1, "Add at least one participant")
    .max(50, "Max 50 participants per batch"),
});
export type CompanyRegistrationInput = z.infer<typeof companyRegistrationSchema>;

/**
 * Row shape accepted by the CSV/Excel importer (header → field mapping).
 * Company and phone are optional here (unlike participantSchema, which the
 * manual add/edit form still enforces both as required for) — bulk source
 * lists (e.g. a passport register) legitimately lack a phone number or, in
 * rare cases, a confirmed company, and the DB columns are nullable. Leave
 * blank rather than fabricate a value; do not tighten this back to required
 * without a corresponding UI/business-rule reason.
 */
export const participantImportRowSchema = z.object({
  full_name: z.string().trim().min(2),
  ic_passport_no: z.string().trim().min(3),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  nationality: z.string().trim().max(80).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
  gender: z.string().trim().max(10).optional().or(z.literal("")),
  date_of_birth: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  emergency_contact_name: z.string().trim().max(160).optional().or(z.literal("")),
  emergency_contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const certificateSchema = z.object({
  participant_id: z.string().uuid().optional().nullable(),
  schedule_id: z.string().uuid().optional().nullable(),
  course_id: z.string().uuid().optional().nullable(),
  certificate_number: z.string().trim().max(60).optional().or(z.literal("")),
  holder_name: z.string().trim().min(2).max(160),
  status: z.enum(["draft", "issued", "revoked", "expired", "archived"]).default("issued"),
  issue_date: z.string().date().optional().or(z.literal("")),
  expiry_date: z.string().date().optional().or(z.literal("")),
});
export type CertificateInput = z.infer<typeof certificateSchema>;

export const companySchema = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(200),
  registration_no: z.string().trim().max(60).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
  company_type: z.string().trim().max(80).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  postcode: z.string().trim().max(12).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  country: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  person_in_charge: z.string().trim().max(160).optional().or(z.literal("")),
  pic_position: z.string().trim().max(120).optional().or(z.literal("")),
  pic_phone: z.string().trim().max(40).optional().or(z.literal("")),
  pic_email: z.string().trim().email("Enter a valid PIC email").max(254).optional().or(z.literal("")),
  billing_address: z.string().trim().max(500).optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "prospect", "archived"]).default("active"),
  remarks: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const trainerSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required").max(160),
  ic_passport_no: z.string().trim().max(40).optional().or(z.literal("")),
  staff_no: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  position: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  employment_type: z.string().trim().max(60).optional().or(z.literal("")),
  specialisation: z.string().trim().max(200).optional().or(z.literal("")),
  qualifications: z.array(z.string().trim().min(1)).default([]),
  competencies: z.array(z.string().trim().min(1)).default([]),
  trainer_photo: z.string().trim().max(500).optional().or(z.literal("")),
  signature_image: z.string().trim().max(500).optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "retired", "on_leave"]).default("active"),
  joining_date: z.string().date("Enter a valid date").optional().or(z.literal("")),
});
export type TrainerInput = z.infer<typeof trainerSchema>;

/** Assessor master data (Assessor Management Phase 1). Mirrors trainerSchema's
 *  shape/validation conventions; status is a select that maps to the table's
 *  boolean is_active in the server action. */
export const assessorSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required").max(160),
  ic_passport_no: z.string().trim().max(40).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  qualification: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]).default("active"),
});
export type AssessorInput = z.infer<typeof assessorSchema>;


export const newUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["super_admin", "admin", "editor", "trainer", "client", "participant"]),
});

export const staffDepartmentEnum = z.enum([
  "management",
  "sales",
  "marketing",
  "training_operations",
  "administration",
  "finance",
  "hr",
]);

export const staffRoleEnum = z.enum(["super_admin", "admin", "editor", "trainer", "client", "participant"]);

export const moduleAccessLevelEnum = z.enum(["view", "edit", "admin"]);

/** Staff profile edit (name / department / role / active / access-control mode). */
export const staffProfileSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  department: staffDepartmentEnum.nullable().optional(),
  role: staffRoleEnum,
  is_active: z.coerce.boolean(),
  access_control_enabled: z.coerce.boolean().default(false),
});

/** One row of the module-access matrix. */
export const moduleAccessItemSchema = z.object({
  module_key: z.string().trim().min(1).max(80),
  access_level: moduleAccessLevelEnum,
});

/** Bulk replace of a profile's explicit module grants. */
export const setStaffModuleAccessSchema = z.object({
  user_id: z.string().uuid(),
  modules: z.array(moduleAccessItemSchema).max(60).default([]),
});

export type StaffProfileInput = z.infer<typeof staffProfileSchema>;
export type StaffModuleAccessInput = z.infer<typeof setStaffModuleAccessSchema>;

/** Create a new staff account (Add Staff flow). Email lowercased; modules optional. */
export const createStaffSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  department: staffDepartmentEnum.nullable().optional(),
  role: staffRoleEnum,
  is_active: z.coerce.boolean(),
  modules: z.array(moduleAccessItemSchema).max(60).default([]),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/** First-login / voluntary password change. Min 10 chars; current required. */
export const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Current password is required."),
  new_password: z.string().min(10, "New password must be at least 10 characters."),
  confirm_password: z.string().min(1, "Please confirm your new password."),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Bounds on the free-text certificate-template config fields that render
 * directly onto the fixed-height, overflow:hidden A4 certificate pages
 * (front page: body_text/duration_label; back page: everything else here).
 * There was previously no length validation on any of these at all — an
 * admin could type an arbitrarily long paragraph and it would silently clip
 * under the frame with no warning. Limits are generous relative to the
 * default content (e.g. important_notice's default four paragraphs run
 * ~600 characters) so normal editing is never blocked, while still
 * rejecting genuinely pathological input before it reaches the renderer.
 * `.passthrough()` because this only guards the print-risk subset of a
 * larger config object (colors, urls, contact fields, etc. aren't bounded
 * here) — see certificate-template `buildConfig()` for the full shape.
 */
export const certificateTemplateConfigSchema = z
  .object({
    programme_title: z.string().trim().max(140).optional().or(z.literal("")),
    duration_label: z.string().trim().max(80).optional().or(z.literal("")),
    body_text: z.string().trim().max(400).optional().or(z.literal("")),
    objectives_text: z.string().trim().max(700).optional().or(z.literal("")),
    important_notice: z.string().trim().max(1500).optional().or(z.literal("")),
    coverage_items: z.array(z.string().trim().min(1).max(90)).max(14).default([]),
    learning_outcomes: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
    assessment_methods: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
    skills_record: z
      .array(z.object({ area: z.string().trim().min(1).max(60), status: z.string().trim().min(1).max(40) }))
      .max(10)
      .default([]),
  })
  .passthrough();

/**
 * Sales CRM V1 — sales_lead_metadata / sales_activity mutations. Kept
 * separate from lib/sales/crm.ts's display-oriented type unions so the
 * validated-input shape (this file's job, per this file's own header
 * comment) doesn't drift from what components render.
 */
export const salesLeadStatusSchema = z
  .object({
    status: z.enum(["new", "contacted", "qualified", "proposal_sent", "negotiation", "won", "lost", "archived"]),
    lost_reason: z.enum(["price", "no_budget", "no_response", "timing", "competitor", "requirement_changed", "duplicate", "other"]).optional().or(z.literal("")),
  })
  .refine((v) => v.status !== "lost" || !!v.lost_reason, {
    message: "Select a reason for marking this lead lost",
    path: ["lost_reason"],
  });
export type SalesLeadStatusInput = z.infer<typeof salesLeadStatusSchema>;

export const salesLeadAssignSchema = z.object({
  assigned_to: z.string().uuid().optional().or(z.literal("")),
});
export type SalesLeadAssignInput = z.infer<typeof salesLeadAssignSchema>;

export const salesLeadNoteSchema = z.object({
  note: z.string().trim().min(1, "Note is required").max(3000),
});
export type SalesLeadNoteInput = z.infer<typeof salesLeadNoteSchema>;

export const salesLeadFollowUpSchema = z.object({
  follow_up_at: z.string().trim().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high"]).optional(),
});
export type SalesLeadFollowUpInput = z.infer<typeof salesLeadFollowUpSchema>;

export const marketingCampaignSchema = z.object({
  name: z.string().trim().min(2, "Campaign name is required").max(160),
  channel: z.enum(["meta_ads", "facebook_organic", "instagram", "tiktok", "google", "whatsapp", "email", "website", "event", "referral", "other"]),
  status: z.enum(["draft", "active", "completed", "archived"]),
  objective: z.string().trim().max(500).optional().or(z.literal("")),
  budget: z.coerce.number().min(0).optional().nullable(),
  start_date: z.string().trim().optional().or(z.literal("")),
  end_date: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(3000).optional().or(z.literal("")),
});
export type MarketingCampaignInput = z.infer<typeof marketingCampaignSchema>;

export const leadAttributionSchema = z.object({
  source: z.enum(["facebook", "tiktok", "whatsapp", "website", "referral", "other"]),
  campaign_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type LeadAttributionInput = z.infer<typeof leadAttributionSchema>;

/**
 * Sales CRM Phase 2 — sales_opportunities / sales_quotations / sales_quotation_items mutations.
 */
export const convertLeadToOpportunitySchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(200),
  expected_close_date: z.string().trim().optional().or(z.literal("")),
  estimated_value: z.coerce.number().min(0).optional().nullable(),
});
export type ConvertLeadToOpportunityInput = z.infer<typeof convertLeadToOpportunitySchema>;

export const opportunityStageSchema = z
  .object({
    stage: z.enum(["new", "qualified", "quotation", "negotiation", "won", "lost", "archived"]),
  });
export type OpportunityStageInput = z.infer<typeof opportunityStageSchema>;

export const opportunityLostSchema = z.object({
  lost_reason: z.enum(["price", "no_budget", "no_response", "timing", "competitor", "requirement_changed", "duplicate", "other"]),
});
export type OpportunityLostInput = z.infer<typeof opportunityLostSchema>;

export const opportunityAssignSchema = z.object({
  assigned_to: z.string().uuid().optional().or(z.literal("")),
});
export type OpportunityAssignInput = z.infer<typeof opportunityAssignSchema>;

export const opportunityExpectedCloseSchema = z.object({
  expected_close_date: z.string().trim().optional().or(z.literal("")),
  probability: z.coerce.number().min(0).max(100).optional().nullable(),
});
export type OpportunityExpectedCloseInput = z.infer<typeof opportunityExpectedCloseSchema>;

const quotationItemInputSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(500),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unit: z.enum(["pax", "session", "day", "lot", "unit"]),
  unit_price: z.coerce.number().min(0, "Unit price cannot be negative"),
  discount: z.coerce.number().min(0, "Discount cannot be negative").default(0),
});
export type QuotationItemInput = z.infer<typeof quotationItemInputSchema>;

export const quotationHeaderSchema = z.object({
  valid_until: z.string().trim().optional().or(z.literal("")),
  currency: z.string().trim().min(1).max(10).default("MYR"),
  discount: z.coerce.number().min(0, "Discount cannot be negative").default(0),
  sst_applicable: z.coerce.boolean().default(false),
  sst_rate: z.coerce.number().min(0).max(100).default(0),
  terms: z.string().trim().max(3000).optional().or(z.literal("")),
  notes: z.string().trim().max(3000).optional().or(z.literal("")),
  items: z.array(quotationItemInputSchema).min(1, "Add at least one line item"),
});
export type QuotationHeaderInput = z.infer<typeof quotationHeaderSchema>;

export const quotationRejectSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required").max(500),
});
export type QuotationRejectInput = z.infer<typeof quotationRejectSchema>;

/**
 * Invoice Module V1. Draft editing is deliberately narrow — invoice_date,
 * due_date, the billing snapshot fields, notes, and payment_terms only.
 * Commercial fields (items, subtotal/tax/total) are copied once from the
 * accepted quotation at creation and stay non-editable even while draft, to
 * avoid an invoice ever silently diverging from the quotation it was
 * created from (see architecture audit section 8 / task section 8).
 */
export const invoiceDraftEditSchema = z.object({
  invoice_date: z.string().trim().min(1, "Invoice date is required"),
  due_date: z.string().trim().min(1, "Due date is required"),
  billing_name: z.string().trim().min(1, "Billing name is required").max(200),
  billing_company: z.string().trim().max(200).optional().or(z.literal("")),
  billing_registration_no: z.string().trim().max(100).optional().or(z.literal("")),
  billing_address: z.string().trim().max(1000).optional().or(z.literal("")),
  billing_email: z.string().trim().email("Invalid email").max(200).optional().or(z.literal("")),
  billing_phone: z.string().trim().max(50).optional().or(z.literal("")),
  notes: z.string().trim().max(3000).optional().or(z.literal("")),
  payment_terms: z.string().trim().max(3000).optional().or(z.literal("")),
});
export type InvoiceDraftEditInput = z.infer<typeof invoiceDraftEditSchema>;

/** V1 manual-payment providers only — 'toyyibpay' is Phase 2, never reachable here. */
export const recordManualPaymentSchema = z.object({
  payment_provider: z.enum(["cash", "bank_transfer", "cheque", "other"]),
  payment_method: z.string().trim().max(100).optional().or(z.literal("")),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  payment_date: z.string().trim().min(1, "Payment date is required"),
  payment_reference: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

/**
 * Sales CRM Phase 4B — sales_tasks mutations. Priority reuses the same
 * low/medium/high family as salesLeadFollowUpSchema (see
 * 20260814250000_sales_tasks.sql's comment — this is deliberate, not an
 * oversight of the low/normal/high/urgent set the task brief suggested).
 * Relations (lead/opportunity/quotation) are all optional and independent.
 */
export const salesTaskSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  due_at: z.string().trim().optional().or(z.literal("")),
  assigned_to: z.string().uuid().optional().or(z.literal("")),
  lead_metadata_id: z.string().uuid().optional().or(z.literal("")),
  opportunity_id: z.string().uuid().optional().or(z.literal("")),
  quotation_id: z.string().uuid().optional().or(z.literal("")),
});
export type SalesTaskInput = z.infer<typeof salesTaskSchema>;

// ===== Participant Feedback (Phase 1) =================================

/** Closed list of problem categories a participant may select. */
export const FEEDBACK_PROBLEM_CATEGORIES = [
  "registration",
  "trainer",
  "training_material",
  "practical_equipment",
  "venue",
  "food_refreshment",
  "schedule",
  "assessment_examination",
  "certificate",
  "staff_service",
  "others",
] as const;

const rating = z.coerce.number().int().min(1).max(5);
const npsScore = z.coerce.number().int().min(0).max(10);

/** Public feedback form payload — mirrors what feedback_submit accepts. */
export const feedbackSubmissionSchema = z.object({
  token: z.string().trim().min(1),
  q1: rating, q2: rating, q3: rating, q4: rating, q5: rating,
  q6: rating, q7: rating, q8: rating, q9: rating, q10: rating,
  nps: npsScore,
  liked_most: z.string().trim().max(2000).optional().or(z.literal("")),
  improve: z.string().trim().max(2000).optional().or(z.literal("")),
  had_problem: z.boolean().default(false),
  problem_category: z.enum(FEEDBACK_PROBLEM_CATEGORIES).optional().nullable(),
  problem_description: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type FeedbackSubmissionInput = z.infer<typeof feedbackSubmissionSchema>;

/** Admin: generate feedback links for every eligible participant in a schedule. */
export const feedbackGenerateLinksSchema = z.object({
  schedule_id: z.string().uuid(),
});
export type FeedbackGenerateLinksInput = z.infer<typeof feedbackGenerateLinksSchema>;

/** Admin: reopen a submitted feedback so the participant may resubmit. */
export const feedbackReopenSchema = z.object({
  feedback_id: z.string().uuid(),
});
export type FeedbackReopenInput = z.infer<typeof feedbackReopenSchema>;

export const FEEDBACK_ISSUE_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const FEEDBACK_ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const FEEDBACK_ACTION_STATUSES = [
  "open", "assigned", "in_progress", "resolved", "verified", "closed",
] as const;

export const feedbackIssueSchema = z.object({
  source_feedback_id: z.string().uuid().optional().nullable(),
  schedule_id: z.string().uuid().optional().nullable(),
  category: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(160).optional().or(z.literal("")),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priority: z.enum(FEEDBACK_ISSUE_PRIORITIES).default("medium"),
});
export type FeedbackIssueInput = z.infer<typeof feedbackIssueSchema>;

export const feedbackIssueStatusSchema = z.object({
  issue_id: z.string().uuid(),
  status: z.enum(FEEDBACK_ISSUE_STATUSES),
});
export type FeedbackIssueStatusInput = z.infer<typeof feedbackIssueStatusSchema>;

export const feedbackActionSchema = z.object({
  issue_id: z.string().uuid(),
  schedule_id: z.string().uuid().optional().nullable(),
  category: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(160).optional().or(z.literal("")),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priority: z.enum(FEEDBACK_ISSUE_PRIORITIES).default("medium"),
  assigned_to: z.string().uuid().optional().nullable(),
  due_date: z.string().trim().max(10).optional().or(z.literal("")),
});
export type FeedbackActionInput = z.infer<typeof feedbackActionSchema>;

export const feedbackActionTransitionSchema = z.object({
  action_id: z.string().uuid(),
  status: z.enum(FEEDBACK_ACTION_STATUSES),
  corrective_action: z.string().trim().max(4000).optional().or(z.literal("")),
  verification_note: z.string().trim().max(4000).optional().or(z.literal("")),
});
export type FeedbackActionTransitionInput = z.infer<typeof feedbackActionTransitionSchema>;

export const feedbackActionAssignSchema = z.object({
  action_id: z.string().uuid(),
  assigned_to: z.string().uuid().optional().nullable(),
});
export type FeedbackActionAssignInput = z.infer<typeof feedbackActionAssignSchema>;

export const legacyLinkParticipantSchema = z.object({
  row_id: z.string().uuid(),
  participant_id: z.string().uuid(),
});
export type LegacyLinkParticipantInput = z.infer<typeof legacyLinkParticipantSchema>;

export const legacyRejectRowSchema = z.object({
  row_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type LegacyRejectRowInput = z.infer<typeof legacyRejectRowSchema>;

export const legacyCourseMappingSchema = z.object({
  course_map_id: z.string().uuid(),
  course_id: z.string().uuid(),
});
export type LegacyCourseMappingInput = z.infer<typeof legacyCourseMappingSchema>;

/** Helper to flatten Zod errors into a { field: message } map for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
