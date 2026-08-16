import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { Badge, Card, PageHead, StatCard } from "../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../lib/date-time";

export const metadata = { title: "System Health — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

type Check = { label: string; value: string; status: "healthy" | "attention" | "unknown"; note: string };

export default async function SystemHealthPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const [connection, mediaUsage, latestRun, failedJobs] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    (supabase.from("media") as any).select("file_size").is("deleted_at", null),
    (supabase.from("automation_runs") as any).select("created_at, run_type, status, summary").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    (supabase.from("automation_runs") as any).select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const bytes = ((mediaUsage.data ?? []) as Array<{ file_size?: number | null }>).reduce((sum, item) => sum + (Number(item.file_size) || 0), 0);
  const storage = bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const dbOk = !connection.error;
  const latest = latestRun.data as { created_at?: string; run_type?: string; status?: string; summary?: string } | null;
  const checks: Check[] = [
    { label: "Database connection", value: dbOk ? "Connected" : "Needs attention", status: dbOk ? "healthy" : "attention", note: dbOk ? "Authenticated query completed successfully." : "The health query could not complete. Review connection and RLS configuration." },
    { label: "Storage usage", value: storage, status: "healthy", note: "Based on files registered in the Media Library. Provider quota is managed in Supabase." },
    { label: "Latest backup", value: "Provider-managed", status: "unknown", note: "No application-level backup record is available. Confirm point-in-time recovery in the Supabase project." },
    { label: "Failed jobs", value: String(failedJobs.count ?? 0), status: (failedJobs.count ?? 0) > 0 ? "attention" : "healthy", note: "Counts failed automation runs recorded by the CMS." },
    { label: "System version", value: "Admin CMS v1.2.1", status: "healthy", note: "Current production release version." },
    { label: "Environment", value: process.env.NODE_ENV === "production" ? "Production" : "Preview / development", status: process.env.NODE_ENV === "production" ? "healthy" : "unknown", note: "Never displays credentials or secret values." },
  ];

  return <>
    <PageHead title="System Health" subtitle="Live operational checks for the Admin CMS." action={<Link className="ta-btn ta-btn-outline" href="/admin/backups">Backup Manager</Link>} />
    <div className="ta-grid cols-4" style={{ marginBottom: 18 }}>
      <StatCard icon="🗄️" label="Database" value={dbOk ? "Connected" : "Check"} />
      <StatCard icon="🗂️" label="Registered storage" value={storage} href="/admin/media" />
      <StatCard icon="⛔" label="Failed jobs" value={failedJobs.count ?? 0} href="/admin/automation" />
      <StatCard icon="🔄" label="Latest run" value={latest?.created_at ? formatMalaysiaDate(latest.created_at) : "None"} href="/admin/automation" />
    </div>
    <Card title="Health checks">
      <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Check</th><th>Status</th><th>Current value</th><th>Notes</th></tr></thead><tbody>
        {checks.map((check) => <tr key={check.label}><td><strong>{check.label}</strong></td><td><Badge status={check.status} /></td><td>{check.value}</td><td style={{ color: "var(--ta-muted)", fontSize: 13 }}>{check.note}</td></tr>)}
      </tbody></table></div>
    </Card>
    <Card title="Latest automation activity">
      <div className="ta-card-pad"><p style={{ margin: 0 }}>{latest ? <><strong>{latest.run_type}</strong> · <Badge status={latest.status ?? "unknown"} /> · {latest.summary ?? "No summary recorded."}</> : "No automation activity has been recorded yet."}</p></div>
    </Card>
  </>;
}
