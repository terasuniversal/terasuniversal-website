import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { requireRegistrationAccess } from "../personal-registration/actions";
import { loadEligibleRegistrationSchedules, checkLeadRegistrationEligibility } from "../../registration-schedules";
import { loadCompanyOptions } from "../../../../participants/loadSchedules";
import { PageHead, Card, EmptyState } from "../../../../../../../components/admin/ui";
import { CompanyRegistrationForm } from "./CompanyRegistrationForm";

export const metadata = { title: "Company Registration — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function CompanyRegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRegistrationAccess();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: lead } = await supabase.from("v_sales_lead_inbox").select("*").eq("lead_metadata_id", id).maybeSingle();
  if (!lead) notFound();

  const eligibility = checkLeadRegistrationEligibility({ status: lead.status, is_test: lead.is_test });
  const [schedules, companies] = await Promise.all([loadEligibleRegistrationSchedules(), loadCompanyOptions()]);

  return (
    <>
      <PageHead
        title="Company Registration"
        subtitle={`Enroll multiple participants from this company lead into one existing schedule.`}
        action={<Link href={`/admin/sales/leads/${id}`} className="ta-btn ta-btn-outline">← Back to Lead</Link>}
      />
      <div style={{ maxWidth: 900 }}>
        <Card title="Registration from Lead">
          <div className="ta-card-pad">
            {!eligibility.eligible ? (
              <EmptyState icon="⚠" message={eligibility.reason!} />
            ) : (
              <CompanyRegistrationForm
                leadMetadataId={id}
                lead={{ company: lead.company ?? "", name: lead.contact_name ?? "" }}
                schedules={schedules}
                companies={companies}
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
