import { PageHead } from "../../../../../../components/admin/ui";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { LeadCreateForm } from "../LeadCreateForm";

export const metadata = { title: "Create Lead — TERAS UNIVERSAL Admin" };

export default async function NewLeadPage() {
  await requireRole("editor");
  await requireModuleAccess("sales_leads");
  const supabase = await createSupabaseServerClient();
  const { data: campaignRows } = await supabase
    .from("marketing_campaigns")
    .select("id, name, status")
    .neq("status", "archived")
    .order("name");

  return (
    <>
      <PageHead title="Create Lead" subtitle="Add a lead to the existing Sales pipeline." />
      <LeadCreateForm campaigns={(campaignRows ?? []) as { id: string; name: string; status: string }[]} />
    </>
  );
}
