import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireCertificate } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { TemplateForm } from "../TemplateForm";
import { updateTemplate } from "../actions";

export const metadata = { title: "Edit Template — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCertificate(true);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase.from("certificate_templates").select("*").eq("id", id).single();
  if (!template) notFound();
  const boundUpdate = updateTemplate.bind(null, id);
  return (
    <>
      <PageHead title="Edit Template" subtitle={template.name} />
      <TemplateForm action={boundUpdate} template={template} mode="edit" />
    </>
  );
}
