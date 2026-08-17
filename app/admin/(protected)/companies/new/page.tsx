import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { PageHead } from "../../../../../components/admin/ui";
import { CompanyForm } from "../CompanyForm";
import { createCompany } from "../actions";

export const metadata = { title: "Add Company — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Sales CRM Phase 4A handoff — when opened from a Won Opportunity's
 * "Create Company" action, prefills only what the Opportunity record
 * itself actually holds (company_name/contact_person/contact_email/
 * contact_phone). sales_opportunities has no address/registration/tax
 * fields, so none of those are ever prefilled — matches the task's "never
 * invent" instruction by construction, not by an extra check.
 *
 * Module-access note: the companies module grant is required unconditionally,
 * matching schedules/new/page.tsx's identical Sales-handoff precedent (the
 * Won Opportunity -> Create Training Schedule button requires the schedules
 * grant with no exemption for arriving via opportunityId). An earlier
 * revision of this page exempted the handoff path by checking only for the
 * *presence* of ?opportunityId — that's forgeable by anyone who can type a
 * URL, and diverged from schedules/new's own established, no-exemption
 * pattern; removed rather than hardened, since the simplest fix that
 * matches existing precedent beats a more complex validated exemption.
 */
export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  await requireRole("admin");
  await requireModuleAccess("companies");
  const sp = await searchParams;

  let handoff: { opportunityId: string; opportunityNo?: string } | undefined;
  let prefill: any = undefined;

  if (sp.opportunityId) {
    const supabase = await createSupabaseServerClient();
    const { data: opp } = await supabase
      .from("sales_opportunities")
      .select("opportunity_no, company_name, contact_person, contact_email, contact_phone")
      .eq("id", sp.opportunityId)
      .maybeSingle();
    if (opp) {
      handoff = { opportunityId: sp.opportunityId, opportunityNo: opp.opportunity_no };
      prefill = {
        company_name: opp.company_name ?? "",
        person_in_charge: opp.contact_person ?? "",
        email: opp.contact_email ?? "",
        phone: opp.contact_phone ?? "",
      };
    }
  }

  return (
    <>
      <PageHead title="Add Company" subtitle="A Company ID is generated automatically." />
      <CompanyForm action={createCompany} mode="create" company={prefill} handoff={handoff} />
    </>
  );
}
