import { z } from "zod";

const participantNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u, "Enter a plain participant name");

const quotationTrainingDetailsSchema = z
  .object({
    schema_version: z.literal(1),
    programme: z
      .object({
        course_id: z.string().uuid().nullable(),
        course_name_snapshot: z.string().trim().max(200),
        start_date: z.string().date().nullable(),
        end_date: z.string().date().nullable(),
        duration_label: z.string().trim().max(80),
      })
      .strict(),
    venue: z
      .object({
        type: z.enum(["teras_hq", "in_house"]),
        name: z.string().trim().max(200),
        address: z.string().trim().max(1000),
      })
      .strict(),
    participants: z
      .object({
        count: z.coerce.number().int().min(0).max(1000),
        names: z.array(participantNameSchema).max(100),
        tbc: z.boolean(),
      })
      .strict(),
    accommodation: z
      .object({
        included: z.boolean(),
        description: z.string().trim().max(500),
        nights: z.coerce.number().int().positive().max(365).nullable(),
      })
      .strict(),
    meals: z
      .object({
        included: z.boolean(),
        meals_per_day: z.coerce.number().int().positive().max(10).nullable(),
        description: z.string().trim().max(500),
      })
      .strict(),
    inclusions: z
      .object({
        training_notes: z.boolean(),
        practical_assessment: z.boolean(),
        certificate: z.boolean(),
        other: z.array(z.string().trim().min(1).max(200)).max(30),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.programme.start_date && value.programme.end_date && value.programme.end_date < value.programme.start_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["programme", "end_date"], message: "End date must be on or after the start date" });
    }
    if (value.participants.names.length > value.participants.count) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["participants", "names"], message: "Participant names cannot exceed participant count" });
    }
  });

export type QuotationTrainingDetails = z.infer<typeof quotationTrainingDetailsSchema>;

/** Parse an optional legacy quotation snapshot for document rendering only. */
export function parseQuotationTrainingDetails(value: unknown): QuotationTrainingDetails | null {
  const result = quotationTrainingDetailsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export { quotationTrainingDetailsSchema };