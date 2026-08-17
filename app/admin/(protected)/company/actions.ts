"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";

const text = (value: FormDataEntryValue | null, limit: number) => String(value ?? "").trim().slice(0, limit) || null;

export async function saveCompanyProfile(formData: FormData) {
  const profile = await requireRole("editor");
  await requireModuleAccess("company");
  const payload = { id: 1, legal_name: text(formData.get("legal_name"), 180), tagline: text(formData.get("tagline"), 300), about: text(formData.get("about"), 12000), vision: text(formData.get("vision"), 3000), mission: text(formData.get("mission"), 3000), phone: text(formData.get("phone"), 60), email_training: text(formData.get("email_training"), 254), email_admin: text(formData.get("email_admin"), 254), address: text(formData.get("address"), 1000), city: text(formData.get("city"), 120), state: text(formData.get("state"), 120), postcode: text(formData.get("postcode"), 20), country: text(formData.get("country"), 120) ?? "Malaysia", whatsapp: text(formData.get("whatsapp"), 60), google_map_embed: text(formData.get("google_map_embed"), 5000), updated_by: profile.id };
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase.from("company_profile") as any).upsert(payload, { onConflict: "id" });
  if (error) redirect(`/admin/company?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/company"); revalidatePath("/"); revalidatePath("/contact");
  redirect("/admin/company?saved=1");
}
