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
  input: { id: string; expectedFullName: string; fullName: string; actorId: string },
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

  // Explicit audit event with the before/after name, because a participants audit
  // trigger is not confirmed in the live migration lineage. No IC or contact data.
  const { error: auditError } = await supabase.rpc("log_event", {
    p_action: "participant_name_corrected",
    p_entity_type: "participants",
    p_entity_id: input.id,
    p_summary: "Participant full name corrected",
    p_metadata: { previous_full_name: row.full_name, new_full_name: input.fullName, actor_id: input.actorId },
  });
  return { ok: true, changed: true, auditLogged: !auditError };
}
