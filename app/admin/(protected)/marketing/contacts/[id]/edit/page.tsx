import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../../components/admin/ui";
import { ContactForm } from "../../ContactForm";
import { updateContact } from "../../actions";
import { loadStaffOptions, loadCampaignOptions } from "../../options";
import type { MarketingContact } from "../../../../../../../lib/supabase/database.types";

export const metadata = { title: "Edit Contact — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: contact, error } = await supabase.from("marketing_contacts").select("*").eq("id", id).maybeSingle();
  if (error) {
    return (
      <>
        <PageHead title="Edit Contact" subtitle="Could not load this contact." />
        <div className="ta-alert ta-alert-error">Could not load this contact. Please try again later.</div>
      </>
    );
  }
  if (!contact) notFound();

  const [staff, campaigns] = await Promise.all([loadStaffOptions(), loadCampaignOptions()]);
  const boundUpdate = updateContact.bind(null, id);

  return (
    <>
      <PageHead title="Edit Contact" subtitle={(contact as MarketingContact).contact_number} />
      <ContactForm action={boundUpdate} staff={staff} campaigns={campaigns} contact={contact as MarketingContact} />
    </>
  );
}
