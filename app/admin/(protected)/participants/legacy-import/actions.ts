"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import type { Profile } from "../../../../../lib/supabase/database.types";
import {
  legacyLinkParticipantSchema,
  legacyRejectRowSchema,
  legacyCourseMappingSchema,
} from "../../../../../lib/validation/schemas";

/** Row states that are final for Phase 2 purposes -- no participant-match
 *  or approve/reject action may touch a row in any of these. `merged` is
 *  reserved for a future merge phase and must stay terminal even though
 *  nothing in Phase 2 can produce it yet. */
const CLOSED_REVIEW = new Set(["approved", "rejected", "merged"]);
const UNRESOLVED_MATCH = new Set(["conflict", "probable_duplicate"]);

/**
 * Admin-only, write-level gate. requireRole("admin") + the module's own
 * "admin" access level (module min_role is already 'admin' in
 * staff_module_catalog, so this also blocks any role below admin even if a
 * future explicit grant is misconfigured -- belt and suspenders, matching
 * the assessors module's `guard()` pattern).
 */
async function guard() {
  const profile = await requireRole("admin");
  await requireModuleAccess("legacy_import", "admin");
  return profile;
}

function backTo(batchId: string, error?: string): never {
  const qs = error ? `?error=${encodeURIComponent(error)}` : "";
  redirect(`/admin/participants/legacy-import/${batchId}${qs}`);
}

/**
 * Trusted server-side audit write. `authenticated` has no EXECUTE on
 * log_event/app.log_event -- both were deliberately revoked to service_role
 * only in 20260815120000_security_remediation_pack1.sql, specifically so a
 * browser/session client can never submit an arbitrary audit event. The
 * approved path is the service-role client calling log_event_as_service(),
 * which takes the actor explicitly (there is no auth.uid() session context
 * on a service-role client) -- same pattern as app/admin/login/actions.ts's
 * post-login audit write, the one existing call site. The service-role key
 * is read from SUPABASE_SERVICE_ROLE_KEY (never NEXT_PUBLIC_-prefixed) by
 * createSupabaseServiceClient(), and this function is only ever called from
 * "use server" actions -- never reachable from a client component.
 *
 * Informational only, same convention as the login audit write: a failure
 * here is logged, not thrown, so a real audit-log outage never blocks the
 * primary mutation the admin is trying to make. It must never be swallowed
 * silently -- the caller always sees the console.error either way.
 */
async function logAudit(
  actor: Profile,
  action: "create" | "update" | "delete" | "import",
  entityType: string,
  entityId: string,
  summary: string,
  metadata: Record<string, unknown> = {}
) {
  const service = createSupabaseServiceClient();
  const { error } = await service.rpc("log_event_as_service", {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_summary: summary,
    p_metadata: metadata,
  });
  if (error) {
    console.error("legacy-import: audit write failed", { message: error.message, entityType, entityId, action });
  }
}

// -- Participant match resolution (task section 4) ----------------------

export async function linkParticipant(batchId: string, formData: FormData) {
  const profile = await guard();
  const parsed = legacyLinkParticipantSchema.safeParse({
    row_id: formData.get("row_id"),
    participant_id: formData.get("participant_id"),
  });
  if (!parsed.success) backTo(batchId, "Invalid participant selection.");
  const { row_id, participant_id } = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Re-verify against the database, never the submitted values alone: the
  // row must belong to this batch, must not already have a closed decision
  // (approved/rejected/merged), and must currently be an unresolved
  // identity conflict -- a crafted resubmission against an already-resolved
  // row (including a replayed double-submit after the first one already
  // flipped match_status to exact_match) is rejected here, not silently
  // re-applied.
  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name, review_status, match_status")
    .eq("id", row_id)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");
  if (CLOSED_REVIEW.has(row!.review_status)) backTo(batchId, "This row already has a final decision and cannot be changed.");
  if (!UNRESOLVED_MATCH.has(row!.match_status)) backTo(batchId, "This row does not have an unresolved participant-identity conflict.");

  const { data: participant } = await supabase
    .from("participants")
    .select("id, full_name")
    .eq("id", participant_id)
    .maybeSingle();
  if (!participant) backTo(batchId, "Selected participant does not exist.");

  const { error } = await supabase
    .from("legacy_participant_staging")
    .update({ matched_participant_id: participant_id, match_status: "exact_match", review_status: "reviewed" })
    .eq("id", row_id);
  if (error) backTo(batchId, "Could not save the participant link.");

  await logAudit(
    profile,
    "update",
    "legacy_participant_staging",
    row_id,
    `Legacy row "${row!.raw_name}" linked to existing participant ${participant!.full_name}`,
    { batch_id: batchId, row_id, participant_id }
  );

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

export async function markAsNewParticipant(batchId: string, rowId: string) {
  const profile = await guard();
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name, review_status, match_status")
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");
  if (CLOSED_REVIEW.has(row!.review_status)) backTo(batchId, "This row already has a final decision and cannot be changed.");
  if (!UNRESOLVED_MATCH.has(row!.match_status)) backTo(batchId, "This row does not have an unresolved participant-identity conflict.");

  const { error } = await supabase
    .from("legacy_participant_staging")
    .update({ matched_participant_id: null, match_status: "new_participant", review_status: "reviewed" })
    .eq("id", rowId);
  if (error) backTo(batchId, "Could not update the row.");

  await logAudit(
    profile,
    "update",
    "legacy_participant_staging",
    rowId,
    `Legacy row "${row!.raw_name}" classified as a new participant (not a duplicate)`,
    { batch_id: batchId, row_id: rowId }
  );

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

export async function markRowReviewed(batchId: string, rowId: string) {
  const profile = await guard();
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name, review_status")
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");
  // Only a genuinely untouched row can be marked reviewed -- this also
  // means a closed row (approved/rejected/merged) can never be pulled back
  // to 'reviewed'.
  if (row!.review_status !== "pending") backTo(batchId);

  const { error } = await supabase
    .from("legacy_participant_staging")
    .update({ review_status: "reviewed" })
    .eq("id", rowId);
  if (error) backTo(batchId, "Could not update the row.");

  await logAudit(profile, "update", "legacy_participant_staging", rowId, `Legacy row "${row!.raw_name}" marked reviewed`, {
    batch_id: batchId,
    row_id: rowId,
  });

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

export async function rejectRow(batchId: string, formData: FormData) {
  const profile = await guard();
  const parsed = legacyRejectRowSchema.safeParse({
    row_id: formData.get("row_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) backTo(batchId, "Invalid rejection input.");
  const { row_id, reason } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name, review_status")
    .eq("id", row_id)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");
  // A row already approved or merged cannot be rejected out from under
  // that decision; re-rejecting an already-rejected row is blocked too --
  // once closed, a row is closed.
  if (CLOSED_REVIEW.has(row!.review_status)) backTo(batchId, "This row already has a final decision and cannot be changed.");

  const { error } = await supabase
    .from("legacy_participant_staging")
    .update({ review_status: "rejected" })
    .eq("id", row_id);
  if (error) backTo(batchId, "Could not reject the row.");

  await logAudit(
    profile,
    "update",
    "legacy_participant_staging",
    row_id,
    `Legacy row "${row!.raw_name}" rejected${reason ? `: ${reason}` : ""}`,
    { batch_id: batchId, row_id, reason: reason || null }
  );

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

// -- Final row approval (task section 6 -- server-enforced, not UI-only) -

export async function approveRow(batchId: string, rowId: string) {
  const profile = await guard();
  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name, validation_error, match_status, mapped_course_id, raw_course_name, review_status")
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");
  // Blocks re-approving an already-approved/merged row AND approving a
  // row that was already rejected -- a rejected row stays rejected.
  if (CLOSED_REVIEW.has(row!.review_status)) backTo(batchId, "This row already has a final decision and cannot be changed.");

  // Every condition re-checked against fresh DB state -- this is the actual
  // enforcement point, not a mirror of client-side UI state.
  const blockers: string[] = [];
  if (row!.validation_error) blockers.push("has a validation error");
  if (!row!.match_status || UNRESOLVED_MATCH.has(row!.match_status)) {
    blockers.push("participant identity is not yet resolved");
  }
  if (row!.raw_course_name && !row!.mapped_course_id) blockers.push("course is not yet mapped");
  if (blockers.length > 0) backTo(batchId, `Cannot approve row ${row!.raw_name}: ${blockers.join("; ")}.`);

  const { error } = await supabase
    .from("legacy_participant_staging")
    .update({ review_status: "approved" })
    .eq("id", rowId);
  if (error) backTo(batchId, "Could not approve the row.");

  await logAudit(profile, "update", "legacy_participant_staging", rowId, `Legacy row "${row!.raw_name}" approved for future merge`, {
    batch_id: batchId,
    row_id: rowId,
  });

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

// -- Course mapping (task section 5) -------------------------------------

const COURSE_MAP_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You are not authorized to approve this mapping.",
  batch_not_found: "Batch not found.",
  mapping_not_found: "Course mapping not found.",
  mapping_source_mismatch: "That mapping belongs to a different source and cannot be approved from this batch.",
  mapping_already_mapped: "This course name is already mapped and cannot be changed here. Mapping is immutable once approved.",
  course_not_found: "Selected course does not exist.",
  course_deleted: "Selected course has been deleted and cannot be used.",
};

/**
 * Approves a legacy_course_map row and cascades mapped_course_id to every
 * affected staging row as a single atomic DB operation
 * (legacy_course_map_approve, 20260824120000). Previously this was two
 * separate client-side writes -- update the mapping, then a best-effort
 * cascade update whose failure only logged an error -- which could leave
 * status='mapped' with staging rows still unmapped. That window no longer
 * exists: the RPC's plpgsql function body is one implicit transaction, so
 * either both writes land or neither does.
 */
export async function approveCourseMapping(batchId: string, formData: FormData) {
  const profile = await guard();
  const parsed = legacyCourseMappingSchema.safeParse({
    course_map_id: formData.get("course_map_id"),
    course_id: formData.get("course_id"),
  });
  if (!parsed.success) backTo(batchId, "Invalid course mapping selection.");
  const { course_map_id, course_id } = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Read only for the audit summary text -- the RPC itself re-validates
  // everything (batch/source scoping, already-mapped, course existence and
  // deleted_at) against fresh state; nothing read here is trusted for
  // authorization.
  const { data: mapping } = await supabase
    .from("legacy_course_map")
    .select("normalized_course_name")
    .eq("id", course_map_id)
    .maybeSingle();
  const { data: course } = await supabase.from("courses").select("title").eq("id", course_id).maybeSingle();

  const { data: updatedCount, error } = await supabase.rpc("legacy_course_map_approve", {
    p_batch_id: batchId,
    p_course_map_id: course_map_id,
    p_course_id: course_id,
  });
  if (error) {
    backTo(batchId, COURSE_MAP_ERROR_MESSAGES[error.message] ?? "Could not approve the course mapping.");
  }

  await logAudit(
    profile,
    "update",
    "legacy_course_map",
    course_map_id,
    `Legacy course "${mapping?.normalized_course_name ?? course_map_id}" mapped to ${course?.title ?? course_id} (${updatedCount ?? 0} staging row(s) updated)`,
    { course_map_id, course_id, batch_id: batchId, rows_updated: updatedCount }
  );

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  redirect(`/admin/participants/legacy-import/${batchId}`);
}

// -- Batch readiness (task section 7) ------------------------------------

export async function approveBatch(batchId: string) {
  const profile = await guard();
  const supabase = await createSupabaseServerClient();

  const { data: batch } = await supabase
    .from("legacy_import_batches")
    .select("id, status")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) backTo(batchId, "Batch not found.");
  if (batch!.status !== "review") backTo(batchId, "Only a batch in review can be approved.");

  // Recomputed fresh from current DB state -- never trust a client-supplied
  // readiness flag. Three independent conditions, all required:
  //   1. no row left pending/reviewed (every row has a final decision)
  //   2. no non-rejected row still has an unresolved identity conflict
  //   3. no non-rejected row that named a course is still unmapped
  // Rejected rows are exempt from 2 and 3 -- they will never merge, so an
  // unresolved conflict or unmapped course on a rejected row must not block
  // the batch.
  const { data: rows } = await supabase
    .from("legacy_participant_staging")
    .select("review_status, match_status, raw_course_name, mapped_course_id")
    .eq("batch_id", batchId);
  const rowList = rows ?? [];

  const unresolvedRows = rowList.filter((r: any) => r.review_status === "pending" || r.review_status === "reviewed").length;
  const unresolvedIdentity = rowList.filter(
    (r: any) => r.review_status !== "rejected" && UNRESOLVED_MATCH.has(r.match_status)
  ).length;
  const unresolvedCourse = rowList.filter(
    (r: any) => r.review_status !== "rejected" && r.raw_course_name && !r.mapped_course_id
  ).length;

  if (unresolvedRows > 0 || unresolvedIdentity > 0 || unresolvedCourse > 0) {
    const parts: string[] = [];
    if (unresolvedRows > 0) parts.push(`${unresolvedRows} row(s) without a final decision`);
    if (unresolvedIdentity > 0) parts.push(`${unresolvedIdentity} unresolved identity conflict(s)`);
    if (unresolvedCourse > 0) parts.push(`${unresolvedCourse} row(s) missing a required course mapping`);
    backTo(batchId, `Cannot approve batch: ${parts.join("; ")}.`);
  }

  const approvedCount = rowList.filter((r: any) => r.review_status === "approved").length;

  const { error } = await supabase
    .from("legacy_import_batches")
    .update({ status: "approved", approved_count: approvedCount })
    .eq("id", batchId);
  if (error) backTo(batchId, "Could not approve the batch.");

  await logAudit(
    profile,
    "update",
    "legacy_import_batches",
    batchId,
    `Legacy import batch approved (${approvedCount} row(s) approved) -- merge into Participant Master not yet implemented`,
    { batch_id: batchId, approved_count: approvedCount }
  );

  revalidatePath(`/admin/participants/legacy-import/${batchId}`);
  revalidatePath("/admin/participants/legacy-import");
  redirect(`/admin/participants/legacy-import/${batchId}`);
}
