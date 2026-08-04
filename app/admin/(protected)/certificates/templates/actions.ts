"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireCertificate } from "../../../../../lib/auth/session";

export type TemplateFormState = { errors?: Record<string, string>; message?: string };

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  is_active: z.coerce.boolean().default(true),
  is_default: z.coerce.boolean().default(false),
});

function buildConfig(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    logo_url: v("logo_url") || "/teras-universal-logo.png",
    background_url: v("background_url") || undefined,
    primary_color: v("primary_color") || "#0B2C56",
    accent_color: v("accent_color") || "#E1A925",
    signature_url: v("signature_url") || undefined,
    signature_name: v("signature_name") || "Training Director",
    signature_title: v("signature_title") || "TERAS UNIVERSAL SDN. BHD.",
    body_text: v("body_text") || "has successfully completed the training programme and is hereby certified as COMPETENT.",
    show_qr: formData.get("show_qr") === "on",
  };
}

function read(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    orientation: String(formData.get("orientation") ?? "landscape"),
    is_active: formData.get("is_active") === "on",
    is_default: formData.get("is_default") === "on",
  };
}

async function ensureSingleDefault(supabase: any, isDefault: boolean, exceptId?: string) {
  if (!isDefault) return;
  let q = supabase.from("certificate_templates").update({ is_default: false }).eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}

export async function createTemplate(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  await requireCertificate(true);
  const parsed = schema.safeParse(read(formData));
  if (!parsed.success) return { errors: { name: parsed.error.issues[0]?.message ?? "Invalid" } };
  const supabase = await createSupabaseServerClient();
  await ensureSingleDefault(supabase, parsed.data.is_default);
  const { error } = await supabase.from("certificate_templates").insert({ ...parsed.data, config: buildConfig(formData) });
  if (error) return { message: error.message };
  revalidatePath("/admin/certificates/templates");
  redirect("/admin/certificates/templates");
}

export async function updateTemplate(id: string, _prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  await requireCertificate(true);
  const parsed = schema.safeParse(read(formData));
  if (!parsed.success) return { errors: { name: parsed.error.issues[0]?.message ?? "Invalid" } };
  const supabase = await createSupabaseServerClient();
  await ensureSingleDefault(supabase, parsed.data.is_default, id);
  const { error } = await supabase.from("certificate_templates").update({ ...parsed.data, config: buildConfig(formData) }).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/certificates/templates");
  redirect("/admin/certificates/templates");
}

export async function duplicateTemplate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("certificate_templates").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  await supabase.from("certificate_templates").insert({ name: `${s.name} (copy)`, description: s.description, orientation: s.orientation, paper_size: s.paper_size, config: s.config, is_active: true, is_default: false });
  revalidatePath("/admin/certificates/templates");
}

export async function toggleTemplateActive(id: string, active: boolean) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificate_templates").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/certificates/templates");
}

export async function deleteTemplate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificate_templates").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/certificates/templates");
}
