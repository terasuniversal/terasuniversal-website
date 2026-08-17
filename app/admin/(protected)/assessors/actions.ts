"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { assessorSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type AssessorFormState = { errors?: Record<string, string>; message?: string };

function readForm(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    full_name: v("full_name"),
    ic_passport_no: v("ic_passport_no"),
    phone: v("phone"),
    email: v("email"),
    organization: v("organization"),
    qualification: v("qualification"),
    notes: v("notes"),
    status: (v("status") || "active") as "active" | "inactive",
  };
}

function toPayload(data: any) {
  const out: any = {
    full_name: data.full_name,
    ic_passport_no: data.ic_passport_no || null,
    phone: data.phone || null,
    email: data.email || null,
    organization: data.organization || null,
    qualification: data.qualification || null,
    notes: data.notes || null,
    is_active: data.status === "active",
  };
  return out;
}

function mapErr(error: { code?: string; message: string }): AssessorFormState {
  if (error.code === "23505") {
    if (error.message.includes("assessors_active_email_unique")) {
      return { errors: { email: "An active assessor with this email already exists." } };
    }
    if (error.message.includes("assessors_active_ic_unique")) {
      return { errors: { ic_passport_no: "An active assessor with this IC / Passport already exists." } };
    }
    return { errors: { _form: "Duplicate value." } };
  }
  return { message: error.message };
}

async function guard() {
  const profile = await requireRole("admin");
  // Write-level module gate: legacy admin passes via catalog fallback;
  // explicit-access admins need the assessors module at 'admin' level. Mirrors
  // the RLS write policies (app.can_manage_assessors).
  await requireModuleAccess("assessors", "admin");
  return profile;
}

export async function createAssessor(_prev: AssessorFormState, formData: FormData): Promise<AssessorFormState> {
  const profile = await guard();
  const parsed = assessorSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("assessors")
    .insert(toPayload(parsed.data))
    .select("id, full_name")
    .single();
  if (error) return mapErr(error);

  await supabase.rpc("log_event", {
    p_action: "assessor_created",
    p_entity_type: "assessors",
    p_entity_id: created.id,
    p_summary: `Assessor ${created.full_name} created`,
    p_metadata: { assessor_id: created.id, full_name: created.full_name, actor_id: profile.id },
  });

  revalidatePath("/admin/assessors");
  redirect("/admin/assessors");
}

export async function updateAssessor(id: string, _prev: AssessorFormState, formData: FormData): Promise<AssessorFormState> {
  const profile = await guard();
  const parsed = assessorSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("assessors").select("id, full_name, is_active").eq("id", id).single();
  if (!current) return { message: "Assessor not found." };

  const { error } = await supabase.from("assessors").update(toPayload(parsed.data)).eq("id", id);
  if (error) return mapErr(error);

  const wasActive = !!current.is_active;
  const nowActive = parsed.data.status === "active";
  let action = "assessor_updated";
  if (wasActive !== nowActive) action = nowActive ? "assessor_activated" : "assessor_deactivated";

  await supabase.rpc("log_event", {
    p_action: action,
    p_entity_type: "assessors",
    p_entity_id: id,
    p_summary: `Assessor ${current.full_name} ${action.replace("assessor_", "")}`,
    p_metadata: { assessor_id: id, full_name: current.full_name, is_active: nowActive, actor_id: profile.id },
  });

  revalidatePath("/admin/assessors");
  revalidatePath(`/admin/assessors/${id}`);
  redirect(`/admin/assessors/${id}`);
}

/** Quick Activate/Deactivate toggle (list + detail). Deactivate is the
 *  approved replacement for hard delete; a deactivated assessor keeps its
 *  historical schedule assignments. */
export async function setAssessorActive(id: string, active: boolean) {
  const profile = await guard();
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("assessors").select("id, full_name, is_active").eq("id", id).single();
  if (!row || !!row.is_active === active) return;

  const { error } = await supabase.from("assessors").update({ is_active: active }).eq("id", id);
  if (error) return;

  const action = active ? "assessor_activated" : "assessor_deactivated";
  await supabase.rpc("log_event", {
    p_action: action,
    p_entity_type: "assessors",
    p_entity_id: id,
    p_summary: `Assessor ${row.full_name} ${action.replace("assessor_", "")}`,
    p_metadata: { assessor_id: id, full_name: row.full_name, is_active: active, actor_id: profile.id },
  });

  revalidatePath("/admin/assessors");
  revalidatePath(`/admin/assessors/${id}`);
}
