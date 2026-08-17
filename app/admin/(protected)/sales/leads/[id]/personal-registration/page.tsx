import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { requireRegistrationAccess } from "./actions";
import { loadEligibleRegistrationSchedules } from "../../registration-schedules";
import { PageHead, Card } from "../../../../../../../components/admin/ui";
import { PersonalRegistrationForm } from "./PersonalRegistrationForm";

export const metadata = { title: "Personal Registration — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function PersonalRegistrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRegistrationAccess();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: lead } = await supabase.from("v_sales_lead_inbox").select("*").eq("lead_metadata_id", id).maybeSingle();
  if (!lead) notFound();

  const schedules = await loadEligibleRegistrationSchedules();

  return (
    <>
      <PageHead
        title="Personal Registration"
        subtitle={`Register an individual course participant from this lead.`}
        action={<Link href={`/admin/sales/leads/${id}`} className="ta-btn ta-btn-outline">← Back to Lead</Link>}
      />
      <div style={{ maxWidth: 820 }}>
        <Card title="Registration from Lead">
          <div className="ta-card-pad">
            <PersonalRegistrationForm
              leadMetadataId={id}
              lead={{ name: lead.contact_name ?? "", email: lead.email ?? "", phone: lead.phone ?? "", company: lead.company ?? "" }}
              schedules={schedules}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
