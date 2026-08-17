import Link from "next/link";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { TemplateForm } from "../TemplateForm";

export const metadata = { title: "New Template — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewAutomationTemplatePage() {
  await requireRole("admin");
  await requireModuleAccess("automation");
  return (
    <>
      <PageHead
        title="New Template"
        subtitle="Create a reusable automation template."
        action={<Link href="/admin/automation/templates" className="ta-btn ta-btn-outline">← Templates</Link>}
      />
      <TemplateForm mode="create" />
    </>
  );
}
