import type { SupabaseClient } from "@supabase/supabase-js";

export type ParticipantNameCorrectionResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; auditLogged: boolean }
  | { ok: false; code: "read_failed" | "not_found" | "deleted" | "stale" | "write_failed"; message: string };

export const NAME_CORRECTION_MESSAGES = {
  read_failed: "The participant could not be loaded. Reload the page and try again.",
  not_found: "This participant could not be found.",
  deleted: "This participant is deleted. Restore the participant before correcting the name.",
  stale: "The name was changed by someone else after you opened this page. Reload the page, check the current name, and try again.",
  write_failed: "The name could not be saved. Reload the page and try again.",
} as const;

/**
 * Writes ONLY participants.full_name, after the caller's admin and module guards
 * and Zod validation have passed. Every other column is left exactly as stored:
 * nothing is read from or written for company, phone, IC/passport, schedule or
 * status, so historical imported records are neither blocked nor normalised.
 *
 * Concurrency: the update is conditional on the stored name still equalling the
 * name the editor saw (and the row not being soft-deleted), so a correction made
 * in between is reported as stale rather than overwritten. Issued certificates
 * are not touched; their names come from immutable issuance snapshots.
 */
export async function runParticipantNameCorrection(
  supabase: SupabaseClient,
  auditClient: SupabaseClient,
  input: { id: string; expectedFullName: string; fullName: string; actorId: string; actorEmail: string | null },
): Promise<ParticipantNameCorrectionResult> {
  const fail = (code: Exclude<ParticipantNameCorrectionResult, { ok: true }>["code"]) =>
    ({ ok: false, code, message: NAME_CORRECTION_MESSAGES[code] }) as const;

  const { data: current, error: readError } = await supabase
    .from("participants")
    .select("id, full_name, deleted_at")
    .eq("id", input.id)
    .maybeSingle();
  if (readError) return fail("read_failed");
  if (!current) return fail("not_found");
  const row = current as { id: string; full_name: string | null; deleted_at: string | null };
  if (row.deleted_at) return fail("deleted");
  if ((row.full_name ?? "") !== input.expectedFullName) return fail("stale");
  if (input.fullName === row.full_name) return { ok: true, changed: false };

  const { data: updated, error: writeError } = await supabase
    .from("participants")
    .update({ full_name: input.fullName })
    .eq("id", input.id)
    .is("deleted_at", null)
    .eq("full_name", input.expectedFullName)
    .select("id");
  if (writeError) return fail("write_failed");
  if (!updated || (updated as unknown[]).length !== 1) return fail("stale");

  // Audit event with the before/after name (the participants trigger records the
  // update but no values). Session clients have no EXECUTE on log_event in
  // Production (security_remediation_pack1), so this goes through the server-only
  // service-role client and log_event_as_service. The actor comes from the caller's
  // verified admin profile, the entity is the row just updated, and the action is a
  // valid audit_action label; nothing here is taken from form input except the
  // validated new name. No IC or contact data.
  let auditLogged = false;
  try {
    const { error: auditError } = await auditClient.rpc("log_event_as_service", {
      p_actor_id: input.actorId,
      p_actor_email: input.actorEmail,
      p_action: "update",
      p_entity_type: "participants",
      p_entity_id: input.id,
      p_summary: "Participant full name corrected",
      p_metadata: { previous_full_name: row.full_name, new_full_name: input.fullName, actor_id: input.actorId },
    });
    auditLogged = !auditError;
  } catch {
    auditLogged = false;
  }
  return { ok: true, changed: true, auditLogged };
}
