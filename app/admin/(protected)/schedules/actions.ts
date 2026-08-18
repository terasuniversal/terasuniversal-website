"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { scheduleSchema, scheduleGroupSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type ScheduleFormState = { errors?: Record<string, string>; message?: string };

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    course_id: v("course_id"),
    trainer_name: v("trainer_name"),
    venue: v("venue"),
    training_mode: v("training_mode"),
    start_date: v("start_date"),
    end_date: v("end_date"),
    start_time: v("start_time"),
    end_time: v("end_time"),
    capacity: formData.get("capacity") ?? 0,
    status: (v("status") || "open") as any,
    is_published: formData.get("is_published") === "on",
    notes: v("notes"),
    assessor_id: v("assessor_id"),
    source_opportunity_id: v("source_opportunity_id"),
    source_quotation_id: v("source_quotation_id"),
  };
}

function clean(data: any) {
  const out: any = { ...data };
  for (const k of ["trainer_name", "venue", "training_mode", "start_time", "end_time", "notes", "source_opportunity_id", "source_quotation_id"]) {
    if (!out[k]) out[k] = null;
  }
  // assessor_id is not a course_schedules column — it is stored relationally
  // in schedule_assessors (see applyAssessorAssignment below).
  delete out.assessor_id;
  return out;
}

// TRAINER CONFLICT CHECK DEFERRED UNTIL TRAINERS ARE NORMALIZED.
//
// course_schedules only has a free-text trainer_name column today (no
// trainers table, no trainer_id FK -- see SCHEDULES_ARCHITECTURE_DECISION.md
// §F). A reliable double-booking check requires a stable trainer identity to
// key on; matching on free-text names would silently misbehave on typos/name
// variants and give staff false confidence in a check that isn't reliable.
// createSchedule/updateSchedule below intentionally do NOT attempt a
// trainer-conflict check -- do not add a free-text-matching version as a
// stopgap; wait for a real trainers table.

export async function createSchedule(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  const profile = await requireRole("admin"); // Editors are read-only.
  await requireModuleAccess("schedules");
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { assessor_id, ...scheduleData } = parsed.data;
  const payload = clean(scheduleData);
  const { data: created, error } = await supabase
    .from("course_schedules")
    .insert(payload)
    .select("id, schedule_code")
    .single();
  if (error) {
    // Sales CRM Phase 3 handoff duplicate guard (course_schedules_source_opportunity_unique,
    // 20260814210000) — a DB constraint, not just the "View Training Schedule"
    // swap on the Opportunity page, so a second concurrent handoff attempt is
    // still rejected even if two staff race past that page-level check.
    if (error.code === "23505" && payload.source_opportunity_id) {
      return { message: "A training schedule has already been created from this opportunity." };
    }
    return { message: error.message };
  }
  if (!created) return { message: "Schedule could not be created." };

  // Optional primary-assessor assignment. The schedule is committed first
  // (schedule creation stays committed on assignment failure); any assignment
  // error is surfaced on the schedule detail page as a partial-success
  // recovery state rather than silently dropped.
  if (assessor_id) {
    const assignErr = await applyAssessorAssignment(supabase, created.id, assessor_id);
    if (assignErr) {
      revalidatePath("/admin/schedules");
      redirect(`/admin/schedules/${created.id}?assessor_error=${encodeURIComponent(assignErr)}`);
    }
  }

  if (payload.source_opportunity_id) {
    const { data: opp } = await supabase
      .from("sales_opportunities")
      .select("lead_metadata_id")
      .eq("id", payload.source_opportunity_id)
      .maybeSingle();
    if (opp?.lead_metadata_id) {
      await supabase.from("sales_activity").insert({
        lead_metadata_id: opp.lead_metadata_id,
        opportunity_id: payload.source_opportunity_id,
        quotation_id: payload.source_quotation_id,
        type: "training_handoff_created",
        note: `Training schedule ${created.schedule_code ?? created.id} created`,
        actor_id: profile.id,
      });
    }
    revalidatePath(`/admin/sales/opportunities/${payload.source_opportunity_id}`);
    revalidatePath("/admin/schedules");
    redirect(`/admin/schedules/${created.id}`);
  }

  revalidatePath("/admin/schedules");
  redirect("/admin/schedules");
}

export async function updateSchedule(id: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { assessor_id, ...scheduleData } = parsed.data;
  const { error } = await supabase.from("course_schedules").update(clean(scheduleData)).eq("id", id);
  if (error) return { message: error.message };
  // Assignment is atomic via RPC; on failure the schedule update is already
  // committed, so surface the partial-success error on the edit form.
  const assignErr = await applyAssessorAssignment(supabase, id, assessor_id ?? "");
  if (assignErr) return { message: `Schedule updated, but the primary assessor could not be assigned: ${assignErr}` };
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
  redirect(`/admin/schedules/${id}`);
}

/** Duplicate — clone core fields; reset status to open, no enrollments. */
export async function duplicateSchedule(id: string) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("course_schedules").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  await supabase.from("course_schedules").insert({
    course_id: s.course_id, trainer_name: s.trainer_name, venue: s.venue,
    training_mode: s.training_mode, start_date: s.start_date, end_date: s.end_date,
    start_time: s.start_time, end_time: s.end_time, capacity: s.capacity,
    notes: s.notes, status: "open", is_published: false,
  });
  revalidatePath("/admin/schedules");
}

// "Archive" as a distinct status was removed: cancelled already represents a
// cancelled event, and deleted_at (softDeleteSchedule below) already handles
// removing a schedule from active views -- a third state would overlap both
// (see SCHEDULES_ARCHITECTURE_DECISION.md / this migration's Phase 6 brief).

export async function softDeleteSchedule(id: string) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const supabase = await createSupabaseServerClient();
  await supabase.from("course_schedules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/schedules");
}

export async function restoreSchedule(id: string) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const supabase = await createSupabaseServerClient();
  await supabase.from("course_schedules").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
}

// --------------------------------------------------------------------
// Participant enrollment (schedule_participants)
// --------------------------------------------------------------------

/**
 * Enroll one or many participants. The active-enrollment uniqueness is a
 * PARTIAL unique index (schedule_id, participant_id) WHERE deleted_at IS
 * NULL AND registration_status <> 'cancelled' -- PostgREST upsert/onConflict
 * cannot target a partial index, so duplicates are pre-filtered with a
 * single batched lookup query instead of a per-row loop; the index remains
 * the race-condition safety net if two requests race past the pre-check.
 */
export async function assignParticipants(scheduleId: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const ids = formData.getAll("participant_ids").map(String).filter(Boolean);
  if (ids.length === 0) return {};
  const supabase = await createSupabaseServerClient();

  // Active-enrollment lookup first so the capacity check counts NET-NEW
  // participants only: someone already actively enrolled consumes zero
  // additional seats, so the raw selection size would otherwise reject a
  // valid batch that re-picks an enrolled participant.
  const { data: existing } = await supabase
    .from("schedule_participants")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .in("participant_id", ids);
  const already = new Set((existing ?? []).map((r: any) => r.participant_id as string));
  const rows = ids.filter((id) => !already.has(id)).map((participant_id) => ({ schedule_id: scheduleId, participant_id }));

  // Capacity is enforced here too, not just by the client's disable-the-button
  // check: seats can be taken between page load and submit, and the DB check
  // constraint (seats_taken <= capacity) would then reject the insert silently.
  // Reject with a message instead of trusting the UI or swallowing the error.
  const { data: sched } = await supabase
    .from("course_schedules")
    .select("capacity, seats_taken")
    .eq("id", scheduleId)
    .single();
  if (!sched) return { message: "Schedule not found." };
  const remaining = Math.max((Number(sched.capacity) || 0) - (Number(sched.seats_taken) || 0), 0);
  if (rows.length > remaining) {
    return { message: `Only ${remaining} seat(s) remaining, but ${rows.length} selected. Increase capacity or select fewer participants.` };
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("schedule_participants").insert(rows);
    if (error) return { message: error.message };
  }
  revalidatePath(`/admin/schedules/${scheduleId}`);
  return {};
}

/** "Remove" cancels the enrollment rather than deleting it, so registration
 * history survives and the participant can be re-enrolled later. */
export async function removeParticipant(scheduleId: string, assignmentId: string) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const supabase = await createSupabaseServerClient();
  await supabase.from("schedule_participants").update({ registration_status: "cancelled" }).eq("id", assignmentId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
}

// --------------------------------------------------------------------
// Assessor assignment (Assessor Management Phase 1)
// --------------------------------------------------------------------

/** Map a set_schedule_assessor RPC error to a staff-facing message. */
function mapAssignmentError(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /forbidden/i.test(error.message)) {
    return "You don't have permission to manage schedule assessors.";
  }
  if (/schedule_not_found/i.test(error.message)) return "Schedule not found.";
  if (/assessor_not_found_or_inactive/i.test(error.message)) {
    return "The selected assessor is not active or no longer exists.";
  }
  return error.message;
}

/**
 * Apply a primary assessor assignment for a schedule by delegating to the
 * atomic public.set_schedule_assessor RPC (assign / replace / remove as one
 * DB transaction — the old assignment is preserved if the new one fails, and
 * the audit row commits with the change). Returns a staff-facing error string
 * on failure, or null on success. Callers must surface the error — never
 * silently ignore an assignment failure.
 */
async function applyAssessorAssignment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string,
  assessorId: string
): Promise<string | null> {
  const { error } = await supabase.rpc("set_schedule_assessor", {
    p_schedule_id: scheduleId,
    p_assessor_id: assessorId || null,
  });
  if (error) return mapAssignmentError(error);
  return null;
}

/** Standalone assign/replace/remove used by the schedule detail page control.
 *  Signature matches the useActionState form pattern (reads assessor_id from
 *  the submitted form). */
export async function setScheduleAssessor(scheduleId: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules", "admin");
  await requireModuleAccess("assessors");
  const assessorId = String(formData.get("assessor_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const err = await applyAssessorAssignment(supabase, scheduleId, assessorId);
  if (err) return { message: err };
  revalidatePath(`/admin/schedules/${scheduleId}`);
  revalidatePath(`/admin/assessment/${scheduleId}`);
  revalidatePath(`/admin/attendance/${scheduleId}/print`);
  return {};
}

// --------------------------------------------------------------------
// Training Schedule Groups V1 (schedule_groups)
// --------------------------------------------------------------------

export type GroupFormState = { errors?: Record<string, string>; message?: string };

type SupaClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The parent schedule's own date/time — every group's fallback window and
 *  the range within which cross-schedule conflicts are even considered. */
async function loadScheduleWindow(supabase: SupaClient, scheduleId: string) {
  const { data } = await supabase
    .from("course_schedules")
    .select("id, start_date, end_date, start_time, end_time, deleted_at")
    .eq("id", scheduleId)
    .single();
  return data as { id: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; deleted_at: string | null } | null;
}

function conflictMessage(kind: "trainer" | "assessor", rows: { group_name: string; schedule_code: string | null }[]): string {
  const who = kind === "trainer" ? "This trainer" : "This assessor";
  const list = rows.map((r) => `${r.group_name} (${r.schedule_code ?? "schedule"})`).join(", ");
  return `${who} is already assigned to an overlapping time slot: ${list}. Adjust the group's time or choose someone else.`;
}

/**
 * Create a group under a schedule. Validates trainer/assessor are real and
 * active, then runs the trainer/assessor overlap checks (see the migration's
 * schedule_group_*_conflicts() functions) BEFORE inserting — this is an
 * app-layer pre-check (same risk model assignParticipants already uses for
 * capacity: a race is possible under real concurrent admin edits, which
 * this module does not see in practice), not a DB-level exclusion
 * constraint.
 */
export async function createGroup(scheduleId: string, _prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const parsed = scheduleGroupSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    trainer_id: String(formData.get("trainer_id") ?? "").trim(),
    assessor_id: String(formData.get("assessor_id") ?? "").trim(),
    capacity: formData.get("capacity") || null,
    start_time: String(formData.get("start_time") ?? "").trim(),
    end_time: String(formData.get("end_time") ?? "").trim(),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { name, trainer_id, assessor_id, capacity, start_time, end_time } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const schedule = await loadScheduleWindow(supabase, scheduleId);
  if (!schedule || schedule.deleted_at) return { message: "Schedule not found." };

  if (trainer_id) {
    const { data: trainer } = await supabase.from("trainers").select("id, status, deleted_at").eq("id", trainer_id).maybeSingle();
    if (!trainer || (trainer as any).deleted_at || (trainer as any).status !== "active") {
      return { errors: { trainer_id: "Selected trainer is not active or no longer exists." } };
    }
  }
  if (assessor_id) {
    const { data: assessor } = await supabase.from("assessors").select("id, is_active").eq("id", assessor_id).maybeSingle();
    if (!assessor || !(assessor as any).is_active) {
      return { errors: { assessor_id: "Selected assessor is not active or no longer exists." } };
    }
  }

  const effStart = start_time || schedule.start_time;
  const effEnd = end_time || schedule.end_time;

  if (trainer_id && effStart && effEnd) {
    const { data: conflicts } = await supabase.rpc("schedule_group_trainer_conflicts", {
      p_trainer_id: trainer_id, p_schedule_id: scheduleId, p_start_time: effStart, p_end_time: effEnd, p_exclude_group_id: null,
    });
    if (conflicts && conflicts.length > 0) return { message: conflictMessage("trainer", conflicts as any) };
  }
  if (assessor_id && effStart && effEnd) {
    const { data: conflicts } = await supabase.rpc("schedule_group_assessor_conflicts", {
      p_assessor_id: assessor_id, p_schedule_id: scheduleId, p_start_time: effStart, p_end_time: effEnd, p_exclude_group_id: null,
    });
    if (conflicts && conflicts.length > 0) return { message: conflictMessage("assessor", conflicts as any) };
  }

  const { error } = await supabase.from("schedule_groups").insert({
    schedule_id: scheduleId,
    name,
    trainer_id: trainer_id || null,
    assessor_id: assessor_id || null,
    capacity: capacity ?? null,
    start_time: start_time || null,
    end_time: end_time || null,
  });
  if (error) {
    if (error.code === "23505") return { errors: { name: "A group with this name already exists on this schedule." } };
    return { message: error.message };
  }
  revalidatePath(`/admin/schedules/${scheduleId}`);
  return {};
}

/** Update a group's name/trainer/assessor-override/time/capacity. Same
 *  validation + conflict checks as createGroup, excluding the group's own
 *  row from the overlap comparison. */
export async function updateGroup(scheduleId: string, groupId: string, _prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const parsed = scheduleGroupSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    trainer_id: String(formData.get("trainer_id") ?? "").trim(),
    assessor_id: String(formData.get("assessor_id") ?? "").trim(),
    capacity: formData.get("capacity") || null,
    start_time: String(formData.get("start_time") ?? "").trim(),
    end_time: String(formData.get("end_time") ?? "").trim(),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { name, trainer_id, assessor_id, capacity, start_time, end_time } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("schedule_groups").select("id, schedule_id, deleted_at").eq("id", groupId).maybeSingle();
  if (!existing || (existing as any).deleted_at || (existing as any).schedule_id !== scheduleId) {
    return { message: "Group not found on this schedule." };
  }
  const schedule = await loadScheduleWindow(supabase, scheduleId);
  if (!schedule || schedule.deleted_at) return { message: "Schedule not found." };

  if (trainer_id) {
    const { data: trainer } = await supabase.from("trainers").select("id, status, deleted_at").eq("id", trainer_id).maybeSingle();
    if (!trainer || (trainer as any).deleted_at || (trainer as any).status !== "active") {
      return { errors: { trainer_id: "Selected trainer is not active or no longer exists." } };
    }
  }
  if (assessor_id) {
    const { data: assessor } = await supabase.from("assessors").select("id, is_active").eq("id", assessor_id).maybeSingle();
    if (!assessor || !(assessor as any).is_active) {
      return { errors: { assessor_id: "Selected assessor is not active or no longer exists." } };
    }
  }

  const effStart = start_time || schedule.start_time;
  const effEnd = end_time || schedule.end_time;

  if (trainer_id && effStart && effEnd) {
    const { data: conflicts } = await supabase.rpc("schedule_group_trainer_conflicts", {
      p_trainer_id: trainer_id, p_schedule_id: scheduleId, p_start_time: effStart, p_end_time: effEnd, p_exclude_group_id: groupId,
    });
    if (conflicts && conflicts.length > 0) return { message: conflictMessage("trainer", conflicts as any) };
  }
  if (assessor_id && effStart && effEnd) {
    const { data: conflicts } = await supabase.rpc("schedule_group_assessor_conflicts", {
      p_assessor_id: assessor_id, p_schedule_id: scheduleId, p_start_time: effStart, p_end_time: effEnd, p_exclude_group_id: groupId,
    });
    if (conflicts && conflicts.length > 0) return { message: conflictMessage("assessor", conflicts as any) };
  }

  const { error } = await supabase
    .from("schedule_groups")
    .update({
      name,
      trainer_id: trainer_id || null,
      assessor_id: assessor_id || null,
      capacity: capacity ?? null,
      start_time: start_time || null,
      end_time: end_time || null,
    })
    .eq("id", groupId);
  if (error) {
    if (error.code === "23505") return { errors: { name: "A group with this name already exists on this schedule." } };
    return { message: error.message };
  }
  revalidatePath(`/admin/schedules/${scheduleId}`);
  return {};
}

/**
 * Soft-delete a group. Blocks removal while any active (non-cancelled,
 * non-deleted) participant is still assigned to it -- the admin must
 * reassign those participants (to another group, or back to ungrouped)
 * first. Surfaces the block via a redirect query param, matching the
 * existing assessor_error pattern on this same page.
 */
export async function removeGroup(scheduleId: string, groupId: string) {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("schedule_participants")
    .select("id", { count: "exact", head: true })
    .eq("schedule_group_id", groupId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled");
  if ((count ?? 0) > 0) {
    redirect(`/admin/schedules/${scheduleId}?group_error=${encodeURIComponent(`${count} participant(s) are still assigned to this group — reassign them first.`)}`);
  }
  await supabase.from("schedule_groups").update({ deleted_at: new Date().toISOString() }).eq("id", groupId).eq("schedule_id", scheduleId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
}

/**
 * Assign/reassign/unassign one participant's group within their existing
 * schedule enrollment. Never creates or duplicates a schedule_participants
 * row -- this only ever updates the schedule_group_id column on the
 * participant's existing enrollment row (see schedule_group_id's own
 * column comment in the migration for why a column, not a mapping table).
 */
export async function assignParticipantGroup(scheduleId: string, assignmentId: string, _prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireRole("admin");
  await requireModuleAccess("schedules");
  const groupId = String(formData.get("schedule_group_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const { data: assignment } = await supabase
    .from("schedule_participants")
    .select("id, schedule_id, deleted_at")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment || (assignment as any).deleted_at || (assignment as any).schedule_id !== scheduleId) {
    return { message: "Enrollment not found on this schedule." };
  }

  if (groupId) {
    const { data: group } = await supabase.from("schedule_groups").select("id, schedule_id, capacity, deleted_at").eq("id", groupId).maybeSingle();
    if (!group || (group as any).deleted_at || (group as any).schedule_id !== scheduleId) {
      return { message: "That group does not belong to this schedule." };
    }
    const capacity = (group as any).capacity as number | null;
    if (capacity != null) {
      const { count } = await supabase
        .from("schedule_participants")
        .select("id", { count: "exact", head: true })
        .eq("schedule_group_id", groupId)
        .is("deleted_at", null)
        .neq("registration_status", "cancelled")
        .neq("id", assignmentId);
      if ((count ?? 0) >= capacity) return { message: "This group is at capacity." };
    }
  }

  const { error } = await supabase.from("schedule_participants").update({ schedule_group_id: groupId || null }).eq("id", assignmentId);
  if (error) {
    // schedule_participants_group_same_schedule_fkey (composite FK, group id
    // + schedule id together) — the pre-checks above should always catch
    // this first; a 23503 here means the group/schedule pairing changed
    // between the check and the write (race), not a routine input error, so
    // don't leak the constraint name to the admin.
    if (error.code === "23503") return { message: "That group no longer belongs to this schedule. Refresh and try again." };
    return { message: error.message };
  }
  revalidatePath(`/admin/schedules/${scheduleId}`);
  return {};
}
