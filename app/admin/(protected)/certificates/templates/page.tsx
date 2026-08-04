import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireCertificate } from "../../../../../lib/auth/session";
import { canManageCertificate } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { duplicateTemplate, toggleTemplateActive } from "./actions";

export const metadata = { title: "Certificate Templates — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const profile = await requireCertificate(false);
  const canManage = canManageCertificate(profile.role);
  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase.from("certificate_templates").select("*").is("deleted_at", null).order("is_default", { ascending: false }).order("name");

  return (
    <>
      <PageHead
        title="Certificate Templates"
        subtitle="Reusable, template-based certificate designs."
        action={canManage ? <Link href="/admin/certificates/templates/new" className="ta-btn ta-btn-primary">+ New Template</Link> : undefined}
      />
      <Card>
        {templates && templates.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Name</th><th>Orientation</th><th>Default</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {templates.map((t: any) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong>{t.description ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{t.description}</div> : null}</td>
                    <td style={{ textTransform: "capitalize" }}>{t.orientation}</td>
                    <td>{t.is_default ? "★" : "—"}</td>
                    <td><Badge status={t.is_active ? "published" : "archived"} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canManage && <>
                        <Link href={`/admin/certificates/templates/${t.id}`} className="ta-btn ta-btn-outline ta-btn-sm">Edit</Link>{" "}
                        <form action={duplicateTemplate.bind(null, t.id)} style={{ display: "inline" }}><button className="ta-btn ta-btn-outline ta-btn-sm" title="Duplicate">⧉</button></form>{" "}
                        <form action={toggleTemplateActive.bind(null, t.id, !t.is_active)} style={{ display: "inline" }}><button className="ta-btn ta-btn-outline ta-btn-sm">{t.is_active ? "Deactivate" : "Activate"}</button></form>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🧩" message="No templates yet." />
        )}
      </Card>
    </>
  );
}
