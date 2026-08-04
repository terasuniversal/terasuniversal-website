import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { Badge, Card, EmptyState, PageHead } from "../../../../components/admin/ui";

export const metadata = { title: "Backup Manager — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function BackupManagerPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { data } = await (supabase.from("audit_logs") as any).select("created_at, summary, action, actor_email").ilike("summary", "%backup%").order("created_at", { ascending: false }).limit(10);
  const history = (data ?? []) as Array<{ created_at: string; summary: string | null; action: string; actor_email: string | null }>;
  return <>
    <PageHead title="Backup Manager" subtitle="Backup visibility and a safe, provider-managed recovery workflow." action={<Link className="ta-btn ta-btn-outline" href="/admin/system">System Health</Link>} />
    <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
      <Card title="Database backup status"><div className="ta-card-pad"><Badge status="provider-managed" /><p>Database recovery is managed by Supabase. Before enabling restores, confirm the project plan and recovery-point policy in the provider console.</p></div></Card>
      <Card title="Storage backup status"><div className="ta-card-pad"><Badge status="provider-managed" /><p>Media files remain in Supabase Storage. Keep an independent export policy for business-critical documents.</p></div></Card>
    </div>
    <Card title="Manual backup"><div className="ta-card-pad"><p style={{ marginTop: 0 }}>Manual export is intentionally not enabled from the browser. It requires a protected server job and retention policy before it can safely handle production data.</p><button type="button" disabled className="ta-btn ta-btn-outline" aria-describedby="backup-note">Manual backup — pending infrastructure setup</button><p id="backup-note" style={{ fontSize: 12, color: "var(--ta-muted)" }}>This placeholder prevents untracked data exports and accidental credential exposure.</p></div></Card>
    <Card title="Restore history">
      {history.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>When</th><th>Action</th><th>Summary</th><th>Actor</th></tr></thead><tbody>{history.map((item, index) => <tr key={index}><td>{new Date(item.created_at).toLocaleString("en-MY")}</td><td><Badge status={item.action} /></td><td>{item.summary ?? "—"}</td><td>{item.actor_email ?? "System"}</td></tr>)}</tbody></table></div> : <EmptyState icon="🛡️" message="No backup or restore events have been recorded by the application." />}
    </Card>
  </>;
}
