import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { TemplateForm } from "../TemplateForm";

export const metadata = { title: "Edit Template — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditAutomationTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("automation_templates").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) notFound();
  const t = data as any;

  return (
    <>
      <PageHead
        title="Edit Template"
        subtitle={t.name}
        action={<Link href="/admin/automation/templates" className="ta-btn ta-btn-outline">← Templates</Link>}
      />
      <TemplateForm
        mode="edit"
        id={id}
        initialValues={{
          template_type: t.template_type,
          name: t.name,
          description: t.description ?? "",
          content: t.content ? JSON.stringify(t.content, null, 2) : "",
          is_active: t.is_active,
          is_default: t.is_default,
        }}
      />
    </>
  );
}
