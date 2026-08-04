import { requireCertificate } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { TemplateForm } from "../TemplateForm";
import { createTemplate } from "../actions";

export const metadata = { title: "New Template — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireCertificate(true);
  return (
    <>
      <PageHead title="New Certificate Template" subtitle="Design a reusable certificate." />
      <TemplateForm action={createTemplate} mode="create" />
    </>
  );
}
