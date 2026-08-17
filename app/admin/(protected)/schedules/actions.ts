"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { scheduleSchema, fieldErrors } from "../../../../lib/validation/schemas";

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

  if (assessor_id) await applyAssessorAssignment(supabase, profile.id, created.id, assessor_id);

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
  const profile = await requireRole("admin");
  await requireModuleAccess("schedules");
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { assessor_id, ...scheduleData } = parsed.data;
  const { error } = await supabase.from("course_schedules").update(clean(scheduleData)).eq("id", id);
  if (error) return { message: error.message };
  await applyAssessorAssignment(supabase, profile.id, id, assessor_id ?? "");
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

/**
 * Apply a primary assessor assignment for a schedule. Handles all three
 * transitions from one call site:
 *   * empty assessorId           -> remove (audit: assessor_unassigned)
 *   * same assessor already set  -> no-op
 *   * different assessorId       -> replace (audit: assessor_reassigned)
 *   * no prior assignment        -> assign (audit: assessor_assigned)
 * Only ACTIVE assessors are assignable; the target is re-validated server-side
 * (never trusts the client select). The assessor record itself is never
 * deleted — only the schedule_assessors junction row is removed.
 *
 * Reads/writes go through the RLS-bound client, so this stays admin+ only in
 * practice (admin RLS on schedule_assessors); the app guard is defense in
 * depth, not the only enforcement.
 */
async function applyAssessorAssignment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  actorId: string,
  scheduleId: string,
  assessorId: string
) {
  const { data: current } = await supabase
    .from("schedule_assessors")
    .select("id, assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const currentId = (current as any)?.assessor_id ?? null;

  if (!assessorId) {
    if (!current) return;
    await supabase.from("schedule_assessors").delete().eq("schedule_id", scheduleId);
    await supabase.rpc("log_event", {
      p_action: "assessor_unassigned",
      p_entity_type: "schedule_assessors",
      p_entity_id: scheduleId,
      p_summary: `Assessor ${(current as any).assessors?.full_name ?? ""} unassigned from schedule`,
      p_metadata: { schedule_id: scheduleId, assessor_id: currentId, actor_id: actorId },
    });
    return;
  }

  if (currentId === assessorId) return;

  const { data: target } = await supabase.from("assessors").select("id, full_name, is_active").eq("id", assessorId).single();
  if (!target || !target.is_active) return;

  await supabase.from("schedule_assessors").delete().eq("schedule_id", scheduleId);
  const { error } = await supabase.from("schedule_assessors").insert({
    schedule_id: scheduleId,
    assessor_id: assessorId,
    is_primary: true,
    assigned_by: actorId,
  });
  if (error) return;

  const action = current ? "assessor_reassigned" : "assessor_assigned";
  await supabase.rpc("log_event", {
    p_action: action,
    p_entity_type: "schedule_assessors",
    p_entity_id: scheduleId,
    p_summary: `Assessor ${target.full_name} ${action.replace("assessor_", "")} to schedule`,
    p_metadata: { schedule_id: scheduleId, assessor_id: assessorId, previous_assessor_id: currentId ?? null, actor_id: actorId },
  });
}

/** Standalone assign/replace/remove used by the schedule detail page control.
 *  Signature matches the useActionState form pattern (reads assessor_id from
 *  the submitted form). */
export async function setScheduleAssessor(scheduleId: string, _prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  const profile = await requireRole("admin");
  await requireModuleAccess("schedules");
  const assessorId = String(formData.get("assessor_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  await applyAssessorAssignment(supabase, profile.id, scheduleId, assessorId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
  revalidatePath(`/admin/assessment/${scheduleId}`);
  revalidatePath(`/admin/attendance/${scheduleId}/print`);
  return {};
}
