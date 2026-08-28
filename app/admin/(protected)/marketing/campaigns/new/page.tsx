import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { CampaignForm } from "../CampaignForm";
import { createCampaign } from "../actions";
import { loadStaffOptions, loadCourseOptions } from "../options";

export const metadata = { title: "New Campaign — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireRole("editor");
  await requireModuleAccess("marketing_campaigns");
  const [staff, courses] = await Promise.all([loadStaffOptions(), loadCourseOptions()]);

  return (
    <>
      <PageHead title="New Campaign" subtitle="Create a marketing campaign." />
      <CampaignForm action={createCampaign} staff={staff} courses={courses} />
    </>
  );
}
