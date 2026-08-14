import { requireRole } from "../../../../../lib/auth/session";
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
 */
export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  await requireRole("admin");
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
