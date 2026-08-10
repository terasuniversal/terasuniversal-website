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

/** Splits a textarea into one trimmed, non-empty entry per line. */
function lines(formData: FormData, key: string): string[] {
  return String(formData.get(key) ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildConfig(formData: FormData) {
  const v = (k: string) => String(formData.get(k) ?? "").trim();
  const skillsRecord = lines(formData, "skills_record")
    .map((line) => {
      const [area, status] = line.split("|").map((s) => s.trim());
      return area ? { area, status: status || "Pending" } : null;
    })
    .filter((r): r is { area: string; status: string } => r !== null);

  return {
    logo_url: v("logo_url") || "/teras-universal-logo.png",
    background_url: v("background_url") || undefined,
    primary_color: v("primary_color") || "#0B3A63",
    accent_color: v("accent_color") || "#D4AF37",
    signature_url: v("signature_url") || undefined,
    signature_name: v("signature_name") || "Trainer",
    signature_title: v("signature_title") || "Training Manager",
    body_text: v("body_text") || undefined,
    show_qr: formData.get("show_qr") === "on",
    // Front page
    duration_label: v("duration_label") || undefined,
    skills_update_recommendation: v("skills_update_recommendation") || undefined,
    certificate_number_prefix: v("certificate_number_prefix") || undefined,
    // Back page ("Programme Information")
    show_back_page: formData.get("show_back_page") === "on",
    show_skills_record: formData.get("show_skills_record") === "on",
    programme_title: v("programme_title") || undefined,
    objectives_text: v("objectives_text") || undefined,
    coverage_items: lines(formData, "coverage_items"),
    learning_outcomes: lines(formData, "learning_outcomes"),
    assessment_methods: lines(formData, "assessment_methods"),
    skills_record: skillsRecord,
    important_notice: v("important_notice") || undefined,
    contact_phone: v("contact_phone") || undefined,
    contact_email: v("contact_email") || undefined,
    contact_website: v("contact_website") || undefined,
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
  // Merge onto the existing stored config rather than replacing it outright,
  // so a key this form doesn't know about (an older/legacy config property)
  // survives a save instead of being silently dropped.
  const { data: existing } = await supabase.from("certificate_templates").select("config").eq("id", id).maybeSingle();
  const mergedConfig = { ...((existing?.config as object) ?? {}), ...buildConfig(formData) };
  const { error } = await supabase.from("certificate_templates").update({ ...parsed.data, config: mergedConfig }).eq("id", id);
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
