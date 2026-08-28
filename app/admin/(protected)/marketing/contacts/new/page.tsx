import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ContactForm } from "../ContactForm";
import { createContact } from "../actions";
import { loadStaffOptions, loadCampaignOptions } from "../options";

export const metadata = { title: "New Contact — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const [staff, campaigns] = await Promise.all([loadStaffOptions(), loadCampaignOptions()]);

  return (
    <>
      <PageHead title="New Contact" subtitle="Add a marketing contact." />
      <ContactForm action={createContact} staff={staff} campaigns={campaigns} />
    </>
  );
}
