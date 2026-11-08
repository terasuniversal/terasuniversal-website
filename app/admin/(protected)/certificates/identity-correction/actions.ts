"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import {
  certificateSearchSchema,
  closeRequestSchema,
  identityCorrectionRequestSchema,
  requestIdSchema,
  type IdentityCorrectionRequestInput,
} from "../../../../../lib/validation/identity-correction";
import { identityCorrectionMessage } from "../../../../../lib/identity-correction/errors";
import {
  assessParticipant,
  searchCertificates,
  type AssessedCertificate,
  type SearchState,
} from "../../../../../lib/identity-correction/api";
import type { MutationState } from "../../../../../components/admin/MutationForm";

// Every action: guard first (Super Admin only), validate with Zod, call exactly one write RPC, check the error,
// revalidate. The RPCs re-check Super Admin themselves and the database guards are the real enforcement boundary;
// this layer gives clear messages and refuses what the database would refuse anyway, before a round trip.
// Nothing here logs form values (names and IC numbers are personal data).

const BASE = "/admin/certificates/identity-correction";

async function rpc(name: string, args: Record<string, unknown>) {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc(name as never, args as never);
}

function refresh(requestId?: string) {
  revalidatePath(BASE);
  if (requestId) revalidatePath(`${BASE}/${requestId}`);
  revalidatePath("/admin/certificates");
  revalidatePath("/admin/participants");
}

/**
 * The search is a Server Action (POST body), not a GET form, so whatever is typed -- including an identity number
 * typed by mistake -- never reaches the URL, browser history or access logs. IC/Passport-shaped input is refused.
 */
export async function searchCertificatesAction(_prev: SearchState, formData: FormData): Promise<SearchState> {
  await requireRole("super_admin");
  const parsed = certificateSearchSchema.safeParse({ q: formData.get("q") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the search." };
  const { data, error } = await searchCertificates(parsed.data.q);
  if (error) return { error: identityCorrectionMessage(error) };
  return { query: parsed.data.q, hits: data ?? [] };
}

/**
 * Server-side mirror of the rules the database enforces, using the participant's REAL certificates (the client's
 * idea of the classes is not trusted). Returns a user message or null.
 */
function decisionProblem(v: IdentityCorrectionRequestInput, certs: AssessedCertificate[]): string | null {
  if (v.decisions.length !== certs.length) return "The decision list does not match this participant's certificates. Reload the page.";
  const byId = new Map(v.decisions.map((d) => [d.certificate_id, d]));
  const changesIdentity = v.change_kind !== "name";
  for (const c of certs) {
    const d = byId.get(c.certificate_id);
    if (!d) return "The decision list does not match this participant's certificates. Reload the page.";
    const nonDefault = (d.name_decision && d.name_decision !== "correct") || (d.identity_decision && d.identity_decision !== "correct");
    if (nonDefault && (d.reason?.length ?? 0) < 10) {
      return `Certificate ${c.certificate_number} needs a reason (10+ characters) because it is not simply corrected.`;
    }
    if (changesIdentity && c.identity_class === "C") {
      const allowed = v.apply_to_profile ? ["accept_display_change", "pin_old", "materialize_new"] : ["leave", "materialize_new"];
      if (!d.identity_decision || !allowed.includes(d.identity_decision)) {
        return `Certificate ${c.certificate_number} shows its IC/Passport live from the profile. Choose how to treat it.`;
      }
    }
  }
  return null;
}

export async function submitIdentityCorrectionRequest(_prev: MutationState, formData: FormData): Promise<MutationState> {
  await requireRole("super_admin");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "The form could not be read. Reload the page and try again." };
  }
  const parsed = identityCorrectionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const v = parsed.data;

  const assessed = await assessParticipant(v.participant_id);
  if (assessed.error || !assessed.data) return { error: identityCorrectionMessage(assessed.error) };
  // The typed number must belong to THIS participant: a forged participant_id with another person's number fails here.
  if (!assessed.data.certificates.some((c) => c.certificate_number === v.typed_certificate_number)) {
    return { error: "The certificate number does not match a certificate of this participant." };
  }
  const problem = decisionProblem(v, assessed.data.certificates);
  if (problem) return { error: problem };

  const { data, error } = await rpc("identity_correction_request", {
    p_participant_id: v.participant_id,
    p_change_kind: v.change_kind,
    p_new_full_name: v.new_full_name?.length ? v.new_full_name : null,
    p_new_identity: v.new_identity?.length ? v.new_identity : null,
    p_apply_to_profile: v.apply_to_profile,
    p_reason: v.reason,
    p_evidence: v.evidence,
    p_decisions: v.decisions.map((d) => ({
      certificate_id: d.certificate_id,
      name_decision: d.name_decision,
      identity_decision: d.identity_decision,
      reason: d.reason || undefined,
    })),
  });
  if (error || typeof data !== "string") return { error: identityCorrectionMessage(error) };
  refresh(data);
  redirect(`${BASE}/${data}`);
}

async function simple(name: string, formData: FormData, needsReason: boolean, done: (data: unknown) => string): Promise<MutationState> {
  await requireRole("super_admin");
  const input = { request_id: formData.get("request_id"), reason: formData.get("reason") ?? undefined };
  const args: Record<string, unknown> = {};
  let requestId: string;
  if (needsReason) {
    const parsed = closeRequestSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
    requestId = parsed.data.request_id;
    args.p_reason = parsed.data.reason;
  } else {
    const parsed = requestIdSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
    requestId = parsed.data.request_id;
  }
  args.p_request_id = requestId;
  const { data, error } = await rpc(name, args);
  if (error) return { error: identityCorrectionMessage(error) };
  refresh(requestId);
  return { message: done(data) };
}

export async function approveIdentityCorrection(_prev: MutationState, formData: FormData) {
  return simple("identity_correction_approve", formData, false, () => "Second approval recorded.");
}
export async function applyIdentityCorrection(_prev: MutationState, formData: FormData) {
  return simple("identity_correction_apply", formData, false, (data) => {
    const r = (data ?? {}) as { certificates_corrected?: number; snapshots_corrected?: number; profile_updated?: boolean };
    return `Correction applied: ${r.certificates_corrected ?? 0} certificate(s), ${r.snapshots_corrected ?? 0} snapshot(s)${r.profile_updated ? " and the participant profile" : ""}. The certificate number, QR token and issue date are unchanged.`;
  });
}
export async function rejectIdentityCorrection(_prev: MutationState, formData: FormData) {
  return simple("identity_correction_reject", formData, true, () => "Request rejected. No certificate or profile was changed.");
}
export async function cancelIdentityCorrection(_prev: MutationState, formData: FormData) {
  return simple("identity_correction_cancel", formData, true, () => "Request cancelled. No certificate or profile was changed.");
}
