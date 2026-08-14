"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { scheduleSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type ScheduleConflictWarning = {
  type: "trainer" | "venue";
  message: string;
};

export type ScheduleFormState = {
  errors?: Record<string, string>;
  message?: string;
  warnings?: ScheduleConflictWarning[];
  conflictToken?: string;
};

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
    exam_date: v("exam_date"),
    start_time: v("start_time"),
    end_time: v("end_time"),
    capacity: formData.get("capacity") ?? 0,
    status: (v("status") || "open") as any,
    is_published: formData.get("is_published") === "on",
    notes: v("notes"),
    source_opportunity_id: v("source_opportunity_id"),
    source_quotation_id: v("source_quotation_id"),
  };
}

function clean(data: any) {
  const out: any = { ...data };
  for (const k of ["trainer_name", "venue", "training_mode", "exam_date", "start_time", "end_time", "notes", "source_opportunity_id", "source_quotation_id"]) {
    if (!out[k]) out[k] = null;
  }
  return out;
}

// The live canonical schema has trainer_name/venue as nullable text and no
// trainers table. Until trainer IDs exist, warnings use normalized exact text
// matching and never block an intentional overlap.

function normalizedResource(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY") ?? "";
}

function timeRangesOverlap(input: any, existing: any) {
  const completeInput = Boolean(input.start_time && input.end_time);
  const completeExisting = Boolean(existing.start_time && existing.end_time);
  // Missing/partial times mean an unknown portion of every overlapping day.
  // Warn conservatively instead of assuming the resource is available.
  if (!completeInput || !completeExisting) return true;
  const minutes = (value: string) => {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
  };
  return minutes(input.start_time) < minutes(existing.end_time)
    && minutes(input.end_time) > minutes(existing.start_time);
}

async function scheduleConflicts(supabase: any, input: any, currentId?: string) {
  if (!input.trainer_name && !input.venue) return { warnings: [] as ScheduleConflictWarning[], token: "" };

  let query = supabase
    .from("course_schedules")
    .select("id, schedule_code, trainer_name, venue, start_date, end_date, start_time, end_time, courses(course_name)")
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .lte("start_date", input.end_date)
    .gte("end_date", input.start_date)
    .limit(500);
  if (currentId) query = query.neq("id", currentId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const trainer = normalizedResource(input.trainer_name);
  const venue = normalizedResource(input.venue);
  const trainerMatches: any[] = [];
  const venueMatches: any[] = [];
  for (const row of data ?? []) {
    if (!timeRangesOverlap(input, row)) continue;
    if (trainer && normalizedResource(row.trainer_name) === trainer) trainerMatches.push(row);
    if (venue && normalizedResource(row.venue) === venue) venueMatches.push(row);
  }

  const describe = (rows: any[]) => rows.map((row) => {
    const course = row.courses?.course_name ?? "another course";
    const code = row.schedule_code ?? row.id;
    const time = row.start_time ? ` at ${row.start_time.slice(0, 5)}-${(row.end_time ?? "").slice(0, 5)}` : "";
    return `${code} (${course}, ${row.start_date} to ${row.end_date}${time})`;
  }).join("; ");

  const warnings: ScheduleConflictWarning[] = [];
  if (trainerMatches.length) warnings.push({
    type: "trainer",
    message: `Trainer conflict: ${input.trainer_name} is already assigned to ${describe(trainerMatches)}.`,
  });
  if (venueMatches.length) warnings.push({
    type: "venue",
    message: `Venue conflict: ${input.venue} is already used by ${describe(venueMatches)}.`,
  });

  const token = warnings.length ? JSON.stringify({
    input: [trainer, venue, input.start_date, input.end_date, input.start_time, input.end_time],
    conflicts: [...trainerMatches.map((r) => `trainer:${r.id}`), ...venueMatches.map((r) => `venue:${r.id}`)].sort(),
  }) : "";
  return { warnings, token };
}

async function unconfirmedConflicts(supabase: any, input: any, submittedToken: string, currentId?: string) {
  const result = await scheduleConflicts(supabase, input, currentId);
  if (result.warnings.length && result.token !== submittedToken) {
    return { warnings: result.warnings, conflictToken: result.token } satisfies ScheduleFormState;
  }
  return null;
}

export async function createSchedule(_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> {
  const profile = await requireRole("admin"); // Editors are read-only.
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const payload = clean(parsed.data);
  try {
    const warningState = await unconfirmedConflicts(supabase, payload, String(formData.get("conflict_token") ?? ""));
    if (warningState) return warningState;
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Unable to check schedule conflicts." };
  }
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
  const parsed = scheduleSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const payload = clean(parsed.data);
  try {
    const warningState = await unconfirmedConflicts(supabase, payload, String(formData.get("conflict_token") ?? ""), id);
    if (warningState) return warningState;
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Unable to check schedule conflicts." };
  }
  const { error } = await supabase.from("course_schedules").update(payload).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/schedules");
  revalidatePath(`/admin/schedules/${id}`);
  redirect(`/admin/schedules/${id}`);
}

/** Duplicate — clone core fields; reset status to open, no enrollments. */
export async function duplicateSchedule(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("course_schedules").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  await supabase.from("course_schedules").insert({
    course_id: s.course_id, trainer_name: s.trainer_name, venue: s.venue,
    training_mode: s.training_mode, start_date: s.start_date, end_date: s.end_date,
    exam_date: s.exam_date,
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
  const supabase = await createSupabaseServerClient();
  await supabase.from("course_schedules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/schedules");
}

export async function restoreSchedule(id: string) {
  await requireRole("admin");
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
  const supabase = await createSupabaseServerClient();
  await supabase.from("schedule_participants").update({ registration_status: "cancelled" }).eq("id", assignmentId);
  revalidatePath(`/admin/schedules/${scheduleId}`);
}
