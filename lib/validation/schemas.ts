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

export const scheduleSchema = z
  .object({
    course_id: z.string().uuid().optional().nullable(),
    trainer_id: z.string().uuid().optional().nullable(),
    course_name: z.string().trim().min(2, "Course name is required").max(200),
    trainer: z.string().trim().max(160).optional().or(z.literal("")),
    venue: z.string().trim().max(200).optional().or(z.literal("")),
    training_mode: z.string().trim().max(40).optional().or(z.literal("")),
    start_date: z.string().date("Enter a valid start date"),
    end_date: z.string().date("Enter a valid end date"),
    start_time: z.string().optional().or(z.literal("")),
    end_time: z.string().optional().or(z.literal("")),
    max_participants: z.coerce.number().int().min(0).default(0),
    status: z.enum(["draft", "open", "full", "completed", "cancelled", "archived"]).default("draft"),
    remarks: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

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

/** Row shape accepted by the CSV/Excel importer (header → field mapping). */
export const participantImportRowSchema = z.object({
  full_name: z.string().trim().min(2),
  ic_passport_no: z.string().trim().min(3),
  company: z.string().trim().min(1),
  phone: z.string().trim().min(5),
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

export const newUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["super_admin", "admin", "editor", "trainer", "client", "participant"]),
});

/** Helper to flatten Zod errors into a { field: message } map for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
