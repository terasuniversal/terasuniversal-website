"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { fieldErrors, marketingCampaignSchema } from "../../../../../lib/validation/schemas";

export type CampaignFormState = { message?: string; errors?: Record<string, string> };

function readForm(fd: FormData) {
  return { name: fd.get("name"), channel: fd.get("channel"), status: fd.get("status"), objective: fd.get("objective") ?? "", budget: fd.get("budget") || null, start_date: fd.get("start_date") ?? "", end_date: fd.get("end_date") ?? "", notes: fd.get("notes") ?? "" };
}

async function saveCampaign(id: string | null, _prev: CampaignFormState, fd: FormData): Promise<CampaignFormState> {
  const profile = await requireRole("editor");
  const parsed = marketingCampaignSchema.safeParse(readForm(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const payload = { ...parsed.data, objective: parsed.data.objective || null, start_date: parsed.data.start_date || null, end_date: parsed.data.end_date || null, notes: parsed.data.notes || null, budget: parsed.data.budget ?? null };
  const supabase = await createSupabaseServerClient();
  const result = id
    ? await supabase.from("marketing_campaigns").update(payload).eq("id", id)
    : await supabase.from("marketing_campaigns").insert({ ...payload, created_by: profile.id });
  if (result.error) return { message: result.error.code === "23505" ? "A campaign with this name already exists." : "Unable to save campaign. Please try again." };
  revalidatePath("/admin/marketing/campaigns");
  redirect("/admin/marketing/campaigns");
}

export async function createCampaign(prev: CampaignFormState, fd: FormData) { return saveCampaign(null, prev, fd); }
export async function updateCampaign(id: string, prev: CampaignFormState, fd: FormData) { return saveCampaign(id, prev, fd); }

export async function archiveCampaign(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("marketing_campaigns").update({ status: "archived" }).eq("id", id);
  if (error) throw new Error("Unable to archive campaign. Please try again.");
  revalidatePath("/admin/marketing/campaigns");
}
