import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { CompanyForm } from "../CompanyForm";
import { createCompany } from "../actions";

export const metadata = { title: "Add Company — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await requireRole("admin");
  return (
    <>
      <PageHead title="Add Company" subtitle="A Company ID is generated automatically." />
      <CompanyForm action={createCompany} mode="create" />
    </>
  );
}
