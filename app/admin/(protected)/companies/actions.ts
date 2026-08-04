"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { companySchema, fieldErrors } from "../../../../lib/validation/schemas";

export type CompanyFormState = { errors?: Record<string, string>; message?: string };

const FIELDS = [
  "company_name", "registration_no", "industry", "company_type", "address", "postcode",
  "city", "state", "country", "phone", "email", "website", "person_in_charge",
  "pic_position", "pic_phone", "pic_email", "billing_address", "status", "remarks",
];

function readForm(formData: FormData) {
  const o: any = {};
  for (const k of FIELDS) o[k] = String(formData.get(k) ?? "").trim();
  o.status = o.status || "active";
  return o;
}
function toPayload(data: any) {
  const out: any = { ...data };
  for (const k of FIELDS) if (k !== "company_name" && k !== "status" && !out[k]) out[k] = null;
  return out;
}
function mapErr(e: { code?: string; message: string }): CompanyFormState {
  if (e.code === "23505") return { errors: { registration_no: "A company with this registration number already exists." } };
  return { message: e.message };
}

export async function createCompany(_prev: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  await requireRole("admin");
  const parsed = companySchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("companies").insert(toPayload(parsed.data));
  if (error) return mapErr(error);
  revalidatePath("/admin/companies");
  redirect("/admin/companies");
}

export async function updateCompany(id: string, _prev: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  await requireRole("admin");
  const parsed = companySchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("companies").update(toPayload(parsed.data)).eq("id", id);
  if (error) return mapErr(error);
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${id}`);
  redirect(`/admin/companies/${id}`);
}

export async function softDeleteCompany(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("companies").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/companies");
}

export async function restoreCompany(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("companies").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${id}`);
}
