import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { Badge, Card, EmptyState, PageHead, StatCard } from "../../../../components/admin/ui";
import { formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Backup Manager — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

type AuditItem = { created_at: string; summary: string | null; action: string; actor_email: string | null };

export default async function BackupManagerPage() {
  await requireRole("admin");
  await requireModuleAccess("backups");
  const supabase = await createSupabaseServerClient();
  const { data } = await (supabase.from("audit_logs") as any)
    .select("created_at, summary, action, actor_email")
    .or("summary.ilike.%backup%,summary.ilike.%restore%")
    .order("created_at", { ascending: false })
    .limit(10);
  const history = (data ?? []) as AuditItem[];
  const latestBackup = history.find((item) => /backup/i.test(item.summary ?? ""));
  const restoreCount = history.filter((item) => /restore/i.test(`${item.summary ?? ""} ${item.action}`)).length;

  return <>
    <PageHead title="Backup Manager" subtitle="Backup visibility and a safe, provider-managed recovery workflow." action={<Link className="ta-btn ta-btn-outline" href="/admin/system">System Health</Link>} />
    <div className="ta-grid cols-3" style={{ marginBottom: 18 }}>
      <StatCard icon="🗄️" label="Database backups" value="Provider-managed" />
      <StatCard icon="🗂️" label="Storage backups" value="Provider-managed" />
      <StatCard icon="↩️" label="Restore events logged" value={restoreCount} />
    </div>
    <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
      <Card title="Database backup status"><div className="ta-card-pad"><Badge status="provider-managed" /><p>Database recovery is managed by Supabase. Before enabling restores, confirm the project plan and recovery-point policy in the provider console.</p></div></Card>
      <Card title="Storage backup status"><div className="ta-card-pad"><Badge status="provider-managed" /><p>Media files remain in Supabase Storage. Keep an independent export policy for business-critical documents.</p></div></Card>
    </div>
    <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
      <Card title="Manual backup"><div className="ta-card-pad"><p style={{ marginTop: 0 }}>Manual export is intentionally not enabled from the browser. It requires a protected server job and retention policy before it can safely handle production data.</p><button type="button" disabled className="ta-btn ta-btn-outline" aria-describedby="backup-note">Manual backup — pending infrastructure setup</button><p id="backup-note" style={{ fontSize: 12, color: "var(--ta-muted)" }}>This placeholder prevents untracked data exports and accidental credential exposure.</p></div></Card>
      <Card title="Recovery checklist"><div className="ta-card-pad"><ol className="ta-checklist"><li>Confirm the incident and the required recovery point.</li><li>Notify the system owner before any restore begins.</li><li>Use the provider console with an approved recovery procedure.</li><li>Record the outcome in the activity log after validation.</li></ol></div></Card>
    </div>
    <Card title="Restore history">
      {history.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>When</th><th>Action</th><th>Summary</th><th>Actor</th></tr></thead><tbody>{history.map((item, index) => <tr key={index}><td>{formatMalaysiaDateTime(item.created_at)}</td><td><Badge status={item.action} /></td><td>{item.summary ?? "—"}</td><td>{item.actor_email ?? "System"}</td></tr>)}</tbody></table></div> : <EmptyState icon="🛡️" message="No backup or restore events have been recorded by the application." />}
    </Card>
    <p className="ta-page-note">Last backup record in the CMS: <strong>{latestBackup ? formatMalaysiaDateTime(latestBackup.created_at) : "No record recorded yet"}</strong>. Provider backup availability must be confirmed in the provider console.</p>
  </>;
}
