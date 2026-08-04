import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { toggleAutomationTemplate, deleteAutomationTemplate } from "../actions";

export const metadata = { title: "Automation Templates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  import: "Import mapping", attendance: "Attendance", assessment: "Assessment", report: "Report", email: "Email",
};

export default async function AutomationTemplatesPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("automation_templates")
    .select("*")
    .is("deleted_at", null)
    .order("template_type")
    .order("name");
  const templates = (data ?? []) as any[];

  return (
    <>
      <PageHead
        title="Template Manager"
        subtitle="Reusable templates for import mapping, attendance, assessment, reports and email."
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/certificates/templates" className="ta-btn ta-btn-outline">🏅 Certificate Templates</Link>
            <Link href="/admin/automation/templates/new" className="ta-btn ta-btn-primary">+ New template</Link>
          </div>
        }
      />

      <Card>
        {templates.length ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Type</th><th>Name</th><th>Description</th><th>Default</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{TYPE_LABELS[t.template_type] ?? t.template_type}</td>
                    <td><strong>{t.name}</strong></td>
                    <td style={{ color: "var(--ta-muted)", fontSize: 13 }}>{t.description ?? "—"}</td>
                    <td>{t.is_default ? <Badge status="default" /> : "—"}</td>
                    <td><Badge status={t.is_active ? "active" : "inactive"} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link href={`/admin/automation/templates/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Edit</Link>{" "}
                      <form action={toggleAutomationTemplate.bind(null, t.id, !t.is_active)} style={{ display: "inline" }}>
                        <button className="ta-btn ta-btn-outline ta-btn-sm" type="submit">{t.is_active ? "Deactivate" : "Activate"}</button>
                      </form>{" "}
                      <form action={deleteAutomationTemplate.bind(null, t.id)} style={{ display: "inline" }}>
                        <button className="ta-btn ta-btn-outline ta-btn-sm" type="submit">Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🧩" message="No templates yet. Create one to standardise imports, reports or emails." />
        )}
      </Card>
    </>
  );
}
