"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { trainerSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type TrainerFormState = { errors?: Record<string, string>; message?: string };

function lines(v: FormDataEntryValue | null) {
  return String(v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function readForm(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    full_name: v("full_name"),
    ic_passport_no: v("ic_passport_no"),
    staff_no: v("staff_no"),
    email: v("email"),
    phone: v("phone"),
    position: v("position"),
    department: v("department"),
    employment_type: v("employment_type"),
    specialisation: v("specialisation"),
    qualifications: lines(formData.get("qualifications")),
    competencies: lines(formData.get("competencies")),
    trainer_photo: v("trainer_photo"),
    signature_image: v("signature_image"),
    status: (v("status") || "active") as any,
    joining_date: v("joining_date"),
  };
}

function toPayload(data: any) {
  const out: any = { ...data };
  for (const k of ["ic_passport_no", "staff_no", "email", "phone", "position", "department", "employment_type", "specialisation", "trainer_photo", "signature_image", "joining_date"]) {
    if (!out[k]) out[k] = null;
  }
  return out;
}

function mapErr(error: { code?: string; message: string }): TrainerFormState {
  if (error.code === "23505") {
    if (error.message.includes("_ic_")) return { errors: { ic_passport_no: "A trainer with this IC / Passport already exists." } };
    if (error.message.includes("_staff_")) return { errors: { staff_no: "A trainer with this staff number already exists." } };
    return { errors: { _form: "Duplicate value." } };
  }
  return { message: error.message };
}

export async function createTrainer(_prev: TrainerFormState, formData: FormData): Promise<TrainerFormState> {
  await requireRole("admin"); // Editors are read-only.
  const parsed = trainerSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("trainers").insert(toPayload(parsed.data));
  if (error) return mapErr(error);
  revalidatePath("/admin/trainers");
  redirect("/admin/trainers");
}

export async function updateTrainer(id: string, _prev: TrainerFormState, formData: FormData): Promise<TrainerFormState> {
  await requireRole("admin");
  const parsed = trainerSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("trainers").update(toPayload(parsed.data)).eq("id", id);
  if (error) return mapErr(error);
  revalidatePath("/admin/trainers");
  revalidatePath(`/admin/trainers/${id}`);
  redirect(`/admin/trainers/${id}`);
}

export async function softDeleteTrainer(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("trainers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/trainers");
}

export async function restoreTrainer(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("trainers").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/trainers");
  revalidatePath(`/admin/trainers/${id}`);
}
