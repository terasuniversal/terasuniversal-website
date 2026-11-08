// Zod schemas for the Super-Admin identity-correction screens. Kept in its own file (not schemas.ts) on purpose:
// schemas.ts has uncommitted edits on the CRM branch, so a new file cannot conflict. Fold it into schemas.ts
// once that branch has landed (CLAUDE.md section 10 wants one schema file).
//
// The database re-validates everything (app.identity_correction_request); these schemas exist so the user gets
// field-level messages before a round trip and so no unbounded string ever reaches an RPC.
import { z } from "zod";
import { looksLikeIdentity } from "./identity-text";

export { looksLikeIdentity };

export const EVIDENCE_TYPES = [
  "national_id",
  "passport",
  "birth_certificate",
  "employer_letter",
  "signed_declaration",
  "training_registration_form",
  "other_official",
] as const;

export const CHANGE_KINDS = ["name", "identity", "combined"] as const;
export const NAME_DECISIONS = ["correct", "leave"] as const;
export const IDENTITY_DECISIONS = ["correct", "leave", "accept_display_change", "pin_old", "materialize_new"] as const;

const NO_IDENTITY = "Do not type an IC/Passport number here";
const plainText = (schema: z.ZodString) => schema.refine((t) => !looksLikeIdentity(t), NO_IDENTITY);

export const evidenceItemSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  reference: plainText(z.string().trim().min(3, "Reference must be at least 3 characters").max(120)),
  // Computed in the browser from the reviewed document; the file itself is never uploaded.
  sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "Document fingerprint must be a 64-character SHA-256"),
  reviewed_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});
export type EvidenceItemInput = z.infer<typeof evidenceItemSchema>;

export const certificateDecisionSchema = z.object({
  certificate_id: z.string().uuid(),
  name_decision: z.enum(NAME_DECISIONS).optional(),
  identity_decision: z.enum(IDENTITY_DECISIONS).optional(),
  reason: plainText(z.string().trim().max(500)).optional(),
});
export type CertificateDecisionInput = z.infer<typeof certificateDecisionSchema>;

export const identityCorrectionRequestSchema = z
  .object({
    participant_id: z.string().uuid(),
    change_kind: z.enum(CHANGE_KINDS),
    new_full_name: z.string().trim().max(200).optional(),
    new_identity: z.string().trim().max(40).optional(),
    apply_to_profile: z.boolean(),
    reason: plainText(z.string().trim().min(20, "Explain the reason in at least 20 characters").max(1000)),
    evidence: z.array(evidenceItemSchema).min(1, "Add at least one reviewed document").max(6),
    decisions: z.array(certificateDecisionSchema).min(1).max(200),
    confirmed_same_person: z.literal(true, { message: "Confirm that the documents show the same person" }),
    // Checked in the Server Action against the participant's own certificates (it is not trusted from the client).
    typed_certificate_number: z.string().trim().min(1, "Type the certificate number to confirm").max(60),
  })
  .superRefine((v, ctx) => {
    const name = v.new_full_name?.length ? v.new_full_name : null;
    const ic = v.new_identity?.length ? v.new_identity : null;
    if ((v.change_kind === "name" && (!name || ic)) || (v.change_kind === "identity" && (!ic || name)) || (v.change_kind === "combined" && (!name || !ic))) {
      ctx.addIssue({ code: "custom", path: ["change_kind"], message: "The new values do not match the type of correction" });
    }
  });
export type IdentityCorrectionRequestInput = z.infer<typeof identityCorrectionRequestSchema>;

export const closeRequestSchema = z.object({
  request_id: z.string().uuid(),
  reason: plainText(z.string().trim().min(10, "Reason must be at least 10 characters").max(500)),
});

export const requestIdSchema = z.object({ request_id: z.string().uuid() });

export const certificateSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(3, "Enter at least 3 characters")
    .max(60)
    .refine((t) => !looksLikeIdentity(t), "Search by certificate number, not by IC/Passport number"),
});
