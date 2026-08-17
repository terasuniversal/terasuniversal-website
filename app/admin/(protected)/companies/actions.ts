"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { companySchema, fieldErrors } from "../../../../lib/validation/schemas";

export type CompanyFormState = { errors?: Record<string, string>; message?: string };

const FIELDS = [
  "company_name", "registration_no", "industry", "company_type", "address", "postcode",
  "city", "state", "country", "phone", "email", "website", "person_in_charge",
  "pic_position", "pic_phone", "pic_email", "billing_address", "status", "remarks",
];

// Sales CRM Phase 4A handoff — present only when creating a company from a
// Won Opportunity's "Create Company" action.
const HANDOFF_FIELD = "source_opportunity_id";

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
  const profile = await requireRole("admin");
  // Unconditional, same as every other companies route and matching
  // schedules/actions.ts's identical Sales-handoff precedent — see
  // new/page.tsx's comment for why the earlier presence-only exemption on
  // source_opportunity_id was removed rather than hardened.
  await requireModuleAccess("companies");
  const parsed = companySchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const sourceOpportunityId = String(formData.get(HANDOFF_FIELD) ?? "").trim() || null;

  // Sales CRM Phase 4A duplicate safety (Task 5) — scoped to the handoff
  // path only, per instruction not to change the standalone Companies
  // module's own create behavior. No DB unique constraint exists on
  // company_name (only company_id, the generated business code, is
  // unique) or on registration_no despite createCompany's own mapErr()
  // below assuming one -- see DATABASE_AUDIT note in this migration's
  // commit; app-level exact-match check is the only real protection here.
  if (sourceOpportunityId) {
    const { data: existing } = await supabase
      .from("companies")
      .select("id, company_name")
      .is("deleted_at", null)
      .ilike("company_name", parsed.data.company_name)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        message: `A company named "${existing.company_name}" already exists. Use "Link Existing Company" on the opportunity instead of creating a duplicate.`,
      };
    }
  }

  const { data: created, error } = await supabase.from("companies").insert(toPayload(parsed.data)).select("id").single();
  if (error) return mapErr(error);

  if (sourceOpportunityId && created) {
    const { data: opp } = await supabase
      .from("sales_opportunities")
      .select("lead_metadata_id")
      .eq("id", sourceOpportunityId)
      .maybeSingle();
    await supabase
      .from("sales_opportunities")
      .update({ company_id: created.id, updated_at: new Date().toISOString() })
      .eq("id", sourceOpportunityId);
    if (opp?.lead_metadata_id) {
      await supabase.from("sales_activity").insert({
        lead_metadata_id: opp.lead_metadata_id,
        opportunity_id: sourceOpportunityId,
        type: "company_created",
        note: `Company "${parsed.data.company_name}" created and linked`,
        actor_id: profile.id,
      });
    }
    revalidatePath(`/admin/sales/opportunities/${sourceOpportunityId}`);
    revalidatePath("/admin/companies");
    redirect(`/admin/sales/opportunities/${sourceOpportunityId}`);
  }

  revalidatePath("/admin/companies");
  redirect("/admin/companies");
}

export async function updateCompany(id: string, _prev: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  await requireRole("admin");
  await requireModuleAccess("companies");
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
  await requireModuleAccess("companies");
  const supabase = await createSupabaseServerClient();
  await supabase.from("companies").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/companies");
}

export async function restoreCompany(id: string) {
  await requireRole("admin");
  await requireModuleAccess("companies");
  const supabase = await createSupabaseServerClient();
  await supabase.from("companies").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${id}`);
}
