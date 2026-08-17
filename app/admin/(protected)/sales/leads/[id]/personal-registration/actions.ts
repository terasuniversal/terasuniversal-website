"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../../lib/auth/session";
import { personalRegistrationSchema, fieldErrors } from "../../../../../../../lib/validation/schemas";

export type PersonalRegState = {
  message?: string;
  errors?: Record<string, string>;
  result?: {
    status: string;
    participant_id: string;
    participant_name: string;
    schedule_id: string;
    schedule_label: string;
    already_enrolled: boolean;
  };
};

function readForm(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    schedule_id: v("schedule_id"),
    full_name: v("full_name"),
    ic_passport_no: v("ic_passport_no"),
    email: v("email"),
    phone: v("phone"),
    company: v("company"),
  };
}

function mapRegError(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /forbidden/i.test(error.message)) return "You don't have permission to register this lead.";
  if (/lead_not_found/i.test(error.message)) return "Lead not found.";
  if (/schedule_not_found/i.test(error.message)) return "The selected schedule no longer exists.";
  if (/schedule_not_eligible/i.test(error.message)) return "The selected schedule is not open for registration.";
  if (/capacity_exceeded/i.test(error.message)) return "This schedule has no remaining seats.";
  if (/invalid_input/i.test(error.message)) return "Please complete all required fields.";
  return error.message;
}

/** Server-side guard shared by both registration actions — editor+ with
 *  sales_leads + participants + schedules module access (mirrors the RPC's
 *  own DB-enforced authorization). */
export async function requireRegistrationAccess() {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_leads");
  await requireModuleAccess("participants");
  await requireModuleAccess("schedules");
  return profile;
}

export async function registerPersonalFromLead(
  leadMetadataId: string,
  _prev: PersonalRegState,
  formData: FormData
): Promise<PersonalRegState> {
  await requireRegistrationAccess();
  const parsed = personalRegistrationSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_personal_lead", {
    p_lead_metadata_id: leadMetadataId,
    p_schedule_id: parsed.data.schedule_id,
    p_full_name: parsed.data.full_name,
    p_ic_passport_no: parsed.data.ic_passport_no || null,
    p_email: parsed.data.email || null,
    p_phone: parsed.data.phone || null,
    p_company: parsed.data.company || null,
  });
  if (error) return { message: mapRegError(error) };

  const r = data as any;
  revalidatePath(`/admin/sales/leads/${leadMetadataId}`);
  revalidatePath("/admin/sales/leads");
  return {
    result: {
      status: r.status,
      participant_id: r.participant_id,
      participant_name: parsed.data.full_name,
      schedule_id: r.schedule_id,
      schedule_label: `${r.course_name ?? "Course"} · ${r.schedule_code ?? ""}`,
      already_enrolled: !!r.already_enrolled,
    },
  };
}
