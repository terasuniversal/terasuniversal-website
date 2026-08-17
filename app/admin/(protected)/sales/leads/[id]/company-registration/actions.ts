"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { companyRegistrationSchema, fieldErrors } from "../../../../../../../lib/validation/schemas";
import { requireRegistrationAccess } from "../personal-registration/actions";
import { checkLeadRegistrationEligibility, loadLeadEligibilityState } from "../../registration-schedules";

export type CompanyRegState = {
  message?: string;
  errors?: Record<string, string>;
  result?: {
    enrolled_count: number;
    already_enrolled_count: number;
    company_name: string | null;
    schedule_id: string;
    schedule_label: string;
    participants: { full_name: string; participant_id: string; already_enrolled: boolean }[];
  };
};

function readForm(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  const raw = formData.getAll("participant_full_name") as string[];
  const ic = formData.getAll("participant_ic_passport_no") as string[];
  const email = formData.getAll("participant_email") as string[];
  const phone = formData.getAll("participant_phone") as string[];
  const participants = raw.map((_, i) => ({
    full_name: v(String(raw[i] ?? "")),
    ic_passport_no: String(ic[i] ?? "").trim(),
    email: String(email[i] ?? "").trim(),
    phone: String(phone[i] ?? "").trim(),
  }));
  return {
    schedule_id: v("schedule_id"),
    company_id: v("company_id"),
    company_name: v("company_name"),
    participants,
  };
}

function mapRegError(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /forbidden/i.test(error.message)) return "You don't have permission to register this lead.";
  if (/lead_not_found/i.test(error.message)) return "Lead not found.";
  if (/lead_is_test/i.test(error.message)) return "Mark this lead as Real before registering participants.";
  if (/lead_archived/i.test(error.message)) return "Restore this lead before registering participants.";
  if (/schedule_not_found/i.test(error.message)) return "The selected schedule no longer exists.";
  if (/schedule_not_eligible/i.test(error.message)) return "The selected schedule is not open for registration.";
  if (/capacity_exceeded/i.test(error.message)) {
    return "Not enough remaining seats for this batch. Reduce the number of participants or pick another schedule.";
  }
  if (/company_not_found/i.test(error.message)) return "The selected company could not be found.";
  if (/invalid_participant/i.test(error.message)) return "Every participant needs a name.";
  if (/invalid_input/i.test(error.message)) return "Please complete all required fields.";
  return error.message;
}

export async function registerCompanyFromLead(
  leadMetadataId: string,
  _prev: CompanyRegState,
  formData: FormData
): Promise<CompanyRegState> {
  await requireRegistrationAccess();
  const parsed = companyRegistrationSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // Revalidate lead state fresh, right before mutating -- never rely on the
  // eligibility already rendered in the form the request came from.
  const currentLead = await loadLeadEligibilityState(leadMetadataId);
  if (!currentLead) return { message: "Lead not found." };
  const eligibility = checkLeadRegistrationEligibility(currentLead);
  if (!eligibility.eligible) return { message: eligibility.reason };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_company_enrollment", {
    p_lead_metadata_id: leadMetadataId,
    p_schedule_id: parsed.data.schedule_id,
    p_company_id: parsed.data.company_id || null,
    p_company_name: parsed.data.company_name || null,
    p_participants: parsed.data.participants.map((p) => ({
      full_name: p.full_name,
      ic_passport_no: p.ic_passport_no || null,
      email: p.email || null,
      phone: p.phone || null,
    })),
  });
  if (error) return { message: mapRegError(error) };

  const r = data as any;
  revalidatePath(`/admin/sales/leads/${leadMetadataId}`);
  revalidatePath("/admin/sales/leads");
  return {
    result: {
      enrolled_count: r.enrolled_count ?? 0,
      already_enrolled_count: r.already_enrolled_count ?? 0,
      company_name: r.company_name ?? null,
      schedule_id: r.schedule_id,
      schedule_label: `${r.course_name ?? "Course"} · ${r.schedule_code ?? ""}`,
      participants: (r.participants ?? []).map((p: any) => ({
        full_name: p.full_name,
        participant_id: p.participant_id,
        already_enrolled: !!p.already_enrolled,
      })),
    },
  };
}
