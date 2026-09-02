"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import { marketingCampaignSchema, fieldErrors } from "../../../../../lib/validation/schemas";
import type { MarketingCampaignStatus } from "../../../../../lib/supabase/database.types";

export type CampaignFormState = {
  errors?: Record<string, string>;
  message?: string;
};

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    name: v("name"),
    channel: v("channel"),
    status: v("status") || "draft",
    objective: v("objective"),
    start_date: v("start_date"),
    end_date: v("end_date"),
    budget: formData.get("budget") ? Number(formData.get("budget")) : null,
    actual_spend: formData.get("actual_spend") ? Number(formData.get("actual_spend")) : null,
    owner_id: v("owner_id"),
    course_id: v("course_id"),
    utm_campaign: v("utm_campaign"),
    notes: v("notes"),
  };
}

/**
 * campaign_number is deliberately never set here — the live DEFAULT
 * (app.next_campaign_number()) generates it inside the INSERT itself. See
 * supabase/migrations/20260827090000_create_marketing_campaigns_v1.sql.
 */
export async function createCampaign(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_campaigns");
  const parsed = marketingCampaignSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("marketing_campaigns")
    .insert({
      name: parsed.data.name,
      channel: parsed.data.channel,
      status: parsed.data.status,
      objective: parsed.data.objective || null,
      start_date: parsed.data.start_date || null,
      end_date: parsed.data.end_date || null,
      budget: parsed.data.budget ?? null,
      actual_spend: parsed.data.actual_spend ?? null,
      owner_id: parsed.data.owner_id || null,
      course_id: parsed.data.course_id || null,
      utm_campaign: parsed.data.utm_campaign || null,
      notes: parsed.data.notes || null,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { message: error.message };

  revalidatePath("/admin/marketing/campaigns");
  redirect(`/admin/marketing/campaigns/${created.id}`);
}

function revalidateCampaign(id: string) {
  revalidatePath("/admin/marketing/campaigns");
  revalidatePath(`/admin/marketing/campaigns/${id}`);
}

/**
 * Edit-only — status is deliberately excluded from both the payload and
 * marketingCampaignSchema's writable surface here; lifecycle changes go
 * through activateCampaign/completeCampaign/archiveCampaign below instead,
 * the same "Edit" vs "Stage" split OpportunityActionsPanel uses.
 */
export async function updateCampaign(id: string, _prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_campaigns");
  const parsed = marketingCampaignSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("marketing_campaigns")
    .update({
      name: parsed.data.name,
      channel: parsed.data.channel,
      objective: parsed.data.objective || null,
      start_date: parsed.data.start_date || null,
      end_date: parsed.data.end_date || null,
      budget: parsed.data.budget ?? null,
      actual_spend: parsed.data.actual_spend ?? null,
      owner_id: parsed.data.owner_id || null,
      course_id: parsed.data.course_id || null,
      utm_campaign: parsed.data.utm_campaign || null,
      notes: parsed.data.notes || null,
      updated_by: profile.id,
    })
    .eq("id", id);
  if (error) return { message: error.message };

  revalidateCampaign(id);
  redirect(`/admin/marketing/campaigns/${id}`);
}

/**
 * Single-step lifecycle transition, shared by the three exported actions
 * below. Enforces the exact linear order (draft -> active -> completed ->
 * archived) server-side against the row's CURRENT status — never trusts a
 * client-supplied target status string, so this can't be used to jump
 * straight from draft to archived or to move a row backwards. Fails
 * silently (no-op) on a stale/invalid transition, same fail-closed pattern
 * as sales/tasks/actions.ts's setTaskStatus (RLS would also block an
 * invalid write; this just avoids a wasted round trip).
 */
async function transitionCampaign(id: string, from: MarketingCampaignStatus, to: MarketingCampaignStatus): Promise<void> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_campaigns");
  const supabase = await createSupabaseServerClient();

  const { data: current, error: readError } = await supabase.from("marketing_campaigns").select("status").eq("id", id).maybeSingle();
  if (readError) {
    console.error("marketing_campaigns: failed to read current status before transition", { message: readError.message, id, from, to });
    return;
  }
  if (!current || current.status !== from) return;

  const { data: updated, error } = await supabase
    .from("marketing_campaigns")
    .update({ status: to, updated_by: profile.id })
    .eq("id", id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("marketing_campaigns: transition update failed", { message: error.message, id, from, to });
    return;
  }
  if (!updated) return;

  revalidateCampaign(id);
}

export async function activateCampaign(id: string): Promise<void> {
  await transitionCampaign(id, "draft", "active");
}

export async function completeCampaign(id: string): Promise<void> {
  await transitionCampaign(id, "active", "completed");
}

export async function archiveCampaign(id: string): Promise<void> {
  await transitionCampaign(id, "completed", "archived");
}
