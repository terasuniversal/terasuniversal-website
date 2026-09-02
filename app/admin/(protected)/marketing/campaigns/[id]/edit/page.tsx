import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../../components/admin/ui";
import { CampaignForm } from "../../CampaignForm";
import { updateCampaign } from "../../actions";
import { loadStaffOptions, loadCourseOptions } from "../../options";
import type { MarketingCampaign } from "../../../../../../../lib/supabase/database.types";

export const metadata = { title: "Edit Campaign — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("marketing_campaigns");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: campaign, error } = await supabase.from("marketing_campaigns").select("*").eq("id", id).maybeSingle();
  if (error) {
    return (
      <>
        <PageHead title="Edit Campaign" subtitle="Could not load this campaign." />
        <div className="ta-alert ta-alert-error">Could not load this campaign. Please try again later.</div>
      </>
    );
  }
  if (!campaign) notFound();

  const [staff, courses] = await Promise.all([loadStaffOptions(), loadCourseOptions()]);
  const boundUpdate = updateCampaign.bind(null, id);

  return (
    <>
      <PageHead title="Edit Campaign" subtitle={(campaign as MarketingCampaign).campaign_number} />
      <CampaignForm action={boundUpdate} staff={staff} courses={courses} campaign={campaign as MarketingCampaign} />
    </>
  );
}
