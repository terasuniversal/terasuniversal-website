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

export const scheduleSchema = z
  .object({
    course_id: z.string().uuid(),
    trainer_id: z.string().uuid().optional().nullable(),
    venue_id: z.string().uuid().optional().nullable(),
    venue_text: z.string().trim().max(160).optional().or(z.literal("")),
    start_date: z.string().date(),
    end_date: z.string().date(),
    start_time: z.string().optional().or(z.literal("")),
    end_time: z.string().optional().or(z.literal("")),
    capacity: z.coerce.number().int().min(0).default(0),
    seats_taken: z.coerce.number().int().min(0).default(0),
    status: z
      .enum(["open", "closing_soon", "full", "in_progress", "completed", "cancelled"])
      .default("open"),
    fee: z.coerce.number().nonnegative().optional().nullable(),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    is_published: z.coerce.boolean().default(true),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  })
  .refine((v) => v.seats_taken <= v.capacity, {
    message: "Seats taken cannot exceed capacity",
    path: ["seats_taken"],
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const enquiryStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_review", "assigned", "responded", "closed", "archived"]),
  assigned_to: z.string().uuid().optional().nullable(),
});

export const proposalStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_review", "assigned", "quoted", "won", "lost", "archived"]),
  assigned_to: z.string().uuid().optional().nullable(),
});

/** Public contact form (used by the website → API route). */
export const publicEnquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  subject: z.string().trim().max(160).optional().or(z.literal("")),
  message: z.string().trim().min(5).max(3000),
  // honeypot — must be empty
  website: z.string().max(0).optional().or(z.literal("")),
});

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
