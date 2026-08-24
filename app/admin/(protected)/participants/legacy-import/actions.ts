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
  // row must actually belong to this batch, and the participant id must be
  // a real, currently-accessible row -- a tampered <select> value fails here.
  const { data: row } = await supabase
    .from("legacy_participant_staging")
    .select("id, raw_name")
    .eq("id", row_id)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");

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
    .select("id, raw_name")
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!row) backTo(batchId, "Row not found in this batch.");

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
  if (row!.review_status === "approved") backTo(batchId, "An approved row cannot be rejected directly.");

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
  if (row!.review_status === "approved" || row!.review_status === "merged") backTo(batchId, "Row is already approved.");

  // Every condition re-checked against fresh DB state -- this is the actual
  // enforcement point, not a mirror of client-side UI state.
  const blockers: string[] = [];
  if (row!.validation_error) blockers.push("has a validation error");
  if (!row!.match_status || row!.match_status === "conflict" || row!.match_status === "probable_duplicate") {
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

export async function approveCourseMapping(batchId: string, formData: FormData) {
  const profile = await guard();
  const parsed = legacyCourseMappingSchema.safeParse({
    course_map_id: formData.get("course_map_id"),
    course_id: formData.get("course_id"),
  });
  if (!parsed.success) backTo(batchId, "Invalid course mapping selection.");
  const { course_map_id, course_id } = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { data: mapping } = await supabase
    .from("legacy_course_map")
    .select("id, source_label, normalized_course_name")
    .eq("id", course_map_id)
    .maybeSingle();
  if (!mapping) backTo(batchId, "Course mapping not found.");

  const { data: course } = await supabase.from("courses").select("id, title").eq("id", course_id).maybeSingle();
  if (!course) backTo(batchId, "Selected course does not exist.");

  const { error: mapErr } = await supabase
    .from("legacy_course_map")
    .update({ course_id, status: "mapped" })
    .eq("id", course_map_id);
  if (mapErr) backTo(batchId, "Could not save the course mapping.");

  // Cascade to every staging row sharing this exact source + normalized
  // course name -- the mapping is source-level (legacy_course_map's own
  // unique key), not batch-level, so it also applies to any other batch
  // already imported from the same source. Scoped to that source's own
  // batches only, so an identically-named course from a different source
  // is never affected by this approval.
  const { data: sourceBatches, error: batchesErr } = await supabase
    .from("legacy_import_batches")
    .select("id")
    .eq("source_label", mapping!.source_label);
  if (batchesErr) {
    console.error("approveCourseMapping: source batch lookup failed", { message: batchesErr.message, course_map_id });
  }
  const batchIds = (sourceBatches ?? []).map((b: { id: string }) => b.id);
  if (batchIds.length > 0) {
    const { error: rowsErr } = await supabase
      .from("legacy_participant_staging")
      .update({ mapped_course_id: course_id })
      .is("mapped_course_id", null)
      .eq("normalized_course_name", mapping!.normalized_course_name)
      .in("batch_id", batchIds);
    if (rowsErr) {
      console.error("approveCourseMapping: staging cascade update failed", { message: rowsErr.message, course_map_id });
    }
  }

  await logAudit(
    profile,
    "update",
    "legacy_course_map",
    course_map_id,
    `Legacy course "${mapping!.normalized_course_name}" mapped to ${course!.title}`,
    { course_map_id, course_id, source_label: mapping!.source_label }
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

  const { data: rows } = await supabase
    .from("legacy_participant_staging")
    .select("review_status")
    .eq("batch_id", batchId);
  const unresolved = (rows ?? []).filter((r: { review_status: string }) => r.review_status === "pending" || r.review_status === "reviewed").length;
  if (unresolved > 0) backTo(batchId, `${unresolved} row(s) still need an approve/reject decision before the batch can be approved.`);

  const approvedCount = (rows ?? []).filter((r: { review_status: string }) => r.review_status === "approved").length;

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
