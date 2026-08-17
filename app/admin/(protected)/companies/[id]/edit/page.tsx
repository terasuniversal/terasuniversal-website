import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { CompanyForm } from "../../CompanyForm";
import { updateCompany } from "../../actions";

export const metadata = { title: "Edit Company — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  await requireModuleAccess("companies");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase.from("companies").select("*").eq("id", id).single();
  if (!company) notFound();
  const boundUpdate = updateCompany.bind(null, id);
  return (
    <>
      <PageHead title="Edit Company" subtitle={`${company.company_id} · ${company.company_name}`} />
      <CompanyForm action={boundUpdate} company={company} mode="edit" />
    </>
  );
}
