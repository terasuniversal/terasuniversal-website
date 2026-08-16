"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import {
  opportunityStageSchema,
  opportunityAssignSchema,
  opportunityExpectedCloseSchema,
  opportunityLostSchema,
  opportunityEditSchema,
  salesLeadNoteSchema,
  fieldErrors,
} from "../../../../../lib/validation/schemas";
import { sanitizeSearchTerm } from "../../../../../lib/sales/crm";

export type SalesActionState = { message?: string; errors?: Record<string, string> };

function revalidateOpportunity(id: string) {
  revalidatePath(`/admin/sales/opportunities/${id}`);
  revalidatePath("/admin/sales/opportunities");
  revalidatePath("/admin/sales");
}

async function logActivity(supabase: any, leadMetadataId: string, opportunityId: string, type: string, note: string | null, actorId: string) {
  await supabase.from("sales_activity").insert({ lead_metadata_id: leadMetadataId, opportunity_id: opportunityId, type, note, actor_id: actorId });
}

async function getLeadMetadataId(supabase: any, opportunityId: string): Promise<string | null> {
  const { data } = await supabase.from("sales_opportunities").select("lead_metadata_id").eq("id", opportunityId).maybeSingle();
  return data?.lead_metadata_id ?? null;
}

/** Stage transitions other than Won/Lost (those go through the cascade RPCs below) — admin+ only. */
export async function updateOpportunityStage(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = opportunityStageSchema.safeParse({ stage: formData.get("stage") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (parsed.data.stage === "won" || parsed.data.stage === "lost") {
    return { message: "Use Mark Won / Mark Lost for won or lost outcomes so the linked quotation and lead stay consistent." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("sales_opportunities").select("stage, lead_metadata_id").eq("id", opportunityId).maybeSingle();
  if (!current) return { message: "Opportunity not found." };
  if (current.stage === "won" || current.stage === "lost") {
    return { message: `This opportunity is already ${current.stage} — its stage can no longer be changed.` };
  }

  const { error } = await supabase
    .from("sales_opportunities")
    .update({ stage: parsed.data.stage, updated_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) return { message: error.message };

  await logActivity(supabase, current.lead_metadata_id, opportunityId, "status_changed", `Stage changed to ${parsed.data.stage}`, profile.id);

  revalidateOpportunity(opportunityId);
  return {};
}

/** admin+ only, per sales_opportunities RLS. */
export async function assignOpportunity(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = opportunityAssignSchema.safeParse({ assigned_to: formData.get("assigned_to") ?? "" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const assignedTo = parsed.data.assigned_to || null;

  const supabase = await createSupabaseServerClient();
  const leadMetadataId = await getLeadMetadataId(supabase, opportunityId);
  const { error } = await supabase
    .from("sales_opportunities")
    .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) return { message: error.message };

  let assigneeName = "Unassigned";
  if (assignedTo) {
    const { data: assignee } = await supabase.from("profiles").select("full_name").eq("id", assignedTo).maybeSingle();
    assigneeName = assignee?.full_name || "a staff member";
  }
  if (leadMetadataId) await logActivity(supabase, leadMetadataId, opportunityId, "assigned", `Assigned to ${assigneeName}`, profile.id);

  revalidateOpportunity(opportunityId);
  return {};
}

/** Expected close date + probability — admin+ only. */
export async function setOpportunityExpectedClose(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  await requireRole("admin");
  const parsed = opportunityExpectedCloseSchema.safeParse({
    expected_close_date: formData.get("expected_close_date") ?? "",
    probability: formData.get("probability") || null,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sales_opportunities")
    .update({
      expected_close_date: parsed.data.expected_close_date || null,
      probability: parsed.data.probability ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opportunityId);
  if (error) return { message: error.message };

  revalidateOpportunity(opportunityId);
  return {};
}

/**
 * Edits operational Opportunity fields. Once Won, only its display title may
 * change; programme and forecast/value fields remain locked to preserve the
 * accepted commercial context. Assignment has its own safe handoff action.
 */
export async function updateOpportunityDetails(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  const parsed = opportunityEditSchema.safeParse({
    title: formData.get("title"),
    programme: formData.get("programme") ?? "",
    expected_close_date: formData.get("expected_close_date") ?? "",
    probability: formData.get("probability") || null,
    estimated_value: formData.get("estimated_value") || null,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("sales_opportunities")
    .select("stage, lead_metadata_id")
    .eq("id", opportunityId)
    .maybeSingle();
  if (!current) return { message: "Opportunity not found." };

  const d = parsed.data;
  const patch: Record<string, unknown> = { title: d.title, updated_at: new Date().toISOString() };
  if (current.stage !== "won") {
    patch.programme = d.programme || null;
    patch.expected_close_date = d.expected_close_date || null;
    patch.probability = d.probability ?? null;
    patch.estimated_value = d.estimated_value ?? null;
  }
  const { error } = await supabase.from("sales_opportunities").update(patch).eq("id", opportunityId);
  if (error) return { message: error.message };

  await logActivity(
    supabase,
    current.lead_metadata_id,
    opportunityId,
    "note_added",
    current.stage === "won"
      ? "Opportunity title updated after win; commercial fields remain locked."
      : "Opportunity details updated.",
    profile.id
  );
  revalidateOpportunity(opportunityId);
  return {};
}

/** Task 12: lost flow — delegates to the mark_opportunity_lost() cascade RPC (requires a reason, cascades the lead too). */
export async function markOpportunityLost(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  await requireRole("admin");
  const parsed = opportunityLostSchema.safeParse({ lost_reason: formData.get("lost_reason") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_opportunity_lost", {
    p_opportunity_id: opportunityId,
    p_reason: parsed.data.lost_reason,
  });
  if (error) return { message: error.message };

  revalidateOpportunity(opportunityId);
  revalidatePath("/admin/sales/leads");
  return {};
}

/** Notes — editor+ (same rationale as Lead Detail's addLeadNote). */
export async function addOpportunityNote(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("editor");
  const parsed = salesLeadNoteSchema.safeParse({ note: formData.get("note") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const leadMetadataId = await getLeadMetadataId(supabase, opportunityId);
  const { error } = await supabase
    .from("sales_activity")
    .insert({ lead_metadata_id: leadMetadataId, opportunity_id: opportunityId, type: "note_added", note: parsed.data.note, actor_id: profile.id });
  if (error) return { message: error.message };

  revalidateOpportunity(opportunityId);
  return {};
}

// --------------------------------------------------------------------
// Phase 4A — Company linking (Client Onboarding)
// --------------------------------------------------------------------

export interface CompanyCandidate {
  id: string;
  company_id: string;
  company_name: string;
  industry: string | null;
  person_in_charge: string | null;
}

/**
 * Manual search for "Link Existing Company" — editor+ (read-only; the
 * mutation itself, linkCompany(), stays admin+). Exact-name/registration
 * matching for the auto-suggested candidate happens server-side in
 * opportunities/[id]/page.tsx; this is the broader manual search a staff
 * member falls back to when there's no suggestion or it's the wrong one.
 */
export async function searchCompaniesForLink(_prev: CompanyCandidate[], formData: FormData): Promise<CompanyCandidate[]> {
  await requireRole("editor");
  const term = sanitizeSearchTerm(String(formData.get("q") ?? ""));
  if (!term) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("companies")
    .select("id, company_id, company_name, industry, person_in_charge")
    .is("deleted_at", null)
    .ilike("company_name", `%${term}%`)
    .order("company_name")
    .limit(10);
  return (data ?? []) as CompanyCandidate[];
}

/**
 * Confirms a Company link chosen by staff (either the auto-suggested exact
 * match or a manual search result) — admin+, matching the RLS floor on
 * sales_opportunities.company_id's write path. A plain form action (no
 * useActionState) since each candidate row is its own single-button form;
 * failures surface as the opportunity page's next render simply not
 * showing a link yet, which is enough for this low-risk, always-retryable
 * confirmation step.
 */
export async function linkCompany(opportunityId: string, formData: FormData): Promise<void> {
  const profile = await requireRole("admin");
  const companyId = String(formData.get("company_id") ?? "").trim();
  if (!companyId) return;

  const supabase = await createSupabaseServerClient();
  const [{ data: opp }, { data: company }] = await Promise.all([
    supabase.from("sales_opportunities").select("lead_metadata_id").eq("id", opportunityId).maybeSingle(),
    supabase.from("companies").select("id, company_name").eq("id", companyId).is("deleted_at", null).maybeSingle(),
  ]);
  if (!opp || !company) return;

  const { error } = await supabase
    .from("sales_opportunities")
    .update({ company_id: companyId, updated_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) return;

  if (opp.lead_metadata_id) {
    await logActivity(supabase, opp.lead_metadata_id, opportunityId, "company_linked", `Linked to company ${company.company_name}`, profile.id);
  }
  revalidateOpportunity(opportunityId);
}
