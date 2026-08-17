"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";

export type FormState = { errors?: Record<string, string>; message?: string; ok?: boolean };

// ---------------------------------------------------------------------------
// System Settings (the 'automation' site_settings object)
// ---------------------------------------------------------------------------
const AUTOMATION_DEFAULTS = {
  participant_prefix: "TU-",
  certificate_prefix: "CERT-",
  timezone: "Asia/Kuala_Lumpur",
  date_format: "DD/MM/YYYY",
  export_format: "csv",
  default_training_mode: "Public",
};

const settingsSchema = z.object({
  participant_prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9._-]*$/, "Letters, numbers, . _ - only"),
  certificate_prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9._-]*$/, "Letters, numbers, . _ - only"),
  timezone: z.string().trim().min(1).max(64),
  date_format: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY"]),
  export_format: z.enum(["csv", "excel"]),
  default_training_mode: z.enum(["Public", "In-house", "Onsite", "Online", "Hybrid"]),
});

export async function getAutomationSettings(): Promise<typeof AUTOMATION_DEFAULTS> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("site_settings").select("value").eq("key", "automation").maybeSingle();
  const v = ((data as any)?.value ?? {}) as Record<string, string>;
  return { ...AUTOMATION_DEFAULTS, ...v };
}

export async function saveAutomationSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const parsed = settingsSchema.safeParse({
    participant_prefix: String(formData.get("participant_prefix") ?? ""),
    certificate_prefix: String(formData.get("certificate_prefix") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    date_format: String(formData.get("date_format") ?? ""),
    export_format: String(formData.get("export_format") ?? ""),
    default_training_mode: String(formData.get("default_training_mode") ?? "Public"),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
    return { errors, message: "Please fix the highlighted fields." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await (supabase
    .from("site_settings") as any)
    .upsert({ key: "automation", value: parsed.data, description: "Operational Automation Centre settings.", is_public: false }, { onConflict: "key" });
  if (error) return { message: error.message };

  await supabase.rpc("log_event" as never, {
    p_action: "update", p_entity_type: "site_settings", p_entity_id: "automation",
    p_summary: "Updated Automation Centre settings",
  } as never);

  revalidatePath("/admin/automation");
  revalidatePath("/admin/automation/settings");
  return { ok: true, message: "Settings saved." };
}

// ---------------------------------------------------------------------------
// Automation Templates (attendance / assessment / import / report / email)
// ---------------------------------------------------------------------------
const TEMPLATE_TYPES = ["attendance", "assessment", "import", "report", "email"] as const;

const templateSchema = z.object({
  template_type: z.enum(TEMPLATE_TYPES),
  name: z.string().trim().min(2, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  content: z.string().trim().optional().or(z.literal("")),
  is_active: z.coerce.boolean().default(true),
  is_default: z.coerce.boolean().default(false),
});

function readTemplate(formData: FormData) {
  return {
    template_type: String(formData.get("template_type") ?? "import"),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    content: String(formData.get("content") ?? ""),
    is_active: formData.get("is_active") === "on",
    is_default: formData.get("is_default") === "on",
  };
}

/** Parse the free-text content field as JSON; fall back to { text } if not JSON. */
function parseContent(raw?: string): Record<string, unknown> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? v : { value: v };
  } catch {
    return { text: s };
  }
}

async function ensureSingleDefault(supabase: any, type: string, isDefault: boolean, exceptId?: string) {
  if (!isDefault) return;
  let q = supabase.from("automation_templates").update({ is_default: false }).eq("template_type", type).eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}

export async function createAutomationTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const parsed = templateSchema.safeParse(readTemplate(formData));
  if (!parsed.success) return { errors: { name: parsed.error.issues[0]?.message ?? "Invalid" } };
  const supabase = await createSupabaseServerClient();
  await ensureSingleDefault(supabase, parsed.data.template_type, parsed.data.is_default);
  const { error } = await supabase.from("automation_templates").insert({
    template_type: parsed.data.template_type,
    name: parsed.data.name,
    description: parsed.data.description || null,
    content: parseContent(parsed.data.content),
    is_active: parsed.data.is_active,
    is_default: parsed.data.is_default,
  });
  if (error) return { message: error.message };
  revalidatePath("/admin/automation/templates");
  redirect("/admin/automation/templates");
}

export async function updateAutomationTemplate(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const parsed = templateSchema.safeParse(readTemplate(formData));
  if (!parsed.success) return { errors: { name: parsed.error.issues[0]?.message ?? "Invalid" } };
  const supabase = await createSupabaseServerClient();
  await ensureSingleDefault(supabase, parsed.data.template_type, parsed.data.is_default, id);
  const { error } = await supabase.from("automation_templates").update({
    template_type: parsed.data.template_type,
    name: parsed.data.name,
    description: parsed.data.description || null,
    content: parseContent(parsed.data.content),
    is_active: parsed.data.is_active,
    is_default: parsed.data.is_default,
  }).eq("id", id);
  if (error) return { message: error.message };
  revalidatePath("/admin/automation/templates");
  redirect("/admin/automation/templates");
}

export async function toggleAutomationTemplate(id: string, active: boolean) {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const supabase = await createSupabaseServerClient();
  await supabase.from("automation_templates").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/automation/templates");
}

export async function deleteAutomationTemplate(id: string) {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const supabase = await createSupabaseServerClient();
  await supabase.from("automation_templates").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/automation/templates");
}
