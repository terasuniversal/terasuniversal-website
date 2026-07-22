import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

export const metadata = { title: "Audit Log — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Audit log is admin-only (mirrors the RLS policy).
  await requireRole("admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  const { data: logs, count } = await (supabase
    .from("audit_logs") as any)
    .select("id, actor_email, action, entity_type, entity_id, summary, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <>
      <PageHead title="Audit Log" subtitle="Append-only record of privileged activity." />
      <Card>
        {logs && logs.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Summary</th></tr></thead>
              <tbody>
                {logs.map((l: any) => (
                  <tr key={l.id}>
                    <td style={{ color: "var(--ta-muted)", whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString("en-MY")}</td>
                    <td>{l.actor_email ?? "system"}</td>
                    <td><Badge status={l.action} /></td>
                    <td>{l.entity_type ?? "—"}</td>
                    <td style={{ color: "var(--ta-muted)" }}>{l.summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="📋" message="No activity recorded yet." />
        )}
      </Card>
      <Pagination page={page} pageCount={pageCount} basePath="/admin/audit" />
    </>
  );
}
