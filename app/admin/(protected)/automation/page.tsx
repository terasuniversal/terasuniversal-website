import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, Badge, EmptyState } from "../../../../components/admin/ui";
import { getAutomationSettings } from "./actions";
import { formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Automation Centre — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const RUN_LABELS: Record<string, string> = {
  bulk_import: "Bulk import",
  bulk_certificate: "Bulk certificate generation",
  bulk_download: "Bulk certificate download",
  email_queue: "Email queue",
  qr_generate: "QR generation",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function AutomationCentrePage() {
  await requireRole("admin");
  await requireModuleAccess("automation");
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const [settings, runsRes, auditRes, upcomingRes, importsRes, pendingCertsRes, templatesRes] = await Promise.all([
    getAutomationSettings(),
    supabase.from("automation_runs").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("audit_logs").select("actor_email, action, entity_type, summary, created_at").order("created_at", { ascending: false }).limit(12),
    supabase.from("course_schedules").select("id, start_date, status").gte("start_date", today).lte("start_date", in14).is("deleted_at", null).not("status", "in", "(cancelled)").order("start_date").limit(6),
    supabase.from("automation_runs").select("*").eq("run_type", "bulk_import").order("created_at", { ascending: false }).limit(5),
    supabase.from("v_certificate_eligibility").select("participant_id", { count: "exact", head: true }).eq("eligible", true),
    supabase.from("automation_templates").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);

  const runs = (runsRes.data ?? []) as any[];
  const audit = (auditRes.data ?? []) as any[];
  const upcoming = (upcomingRes.data ?? []) as any[];
  const imports = (importsRes.data ?? []) as any[];
  const pendingCerts = pendingCertsRes.count ?? 0;
  const templateCount = templatesRes.count ?? 0;

  // --- Notification Centre: synthesise alerts from live state ---
  const notifications: { icon: string; text: string; tone: string; href?: string }[] = [];
  if (upcoming.length) notifications.push({ icon: "📅", tone: "info", text: `${upcoming.length} training session(s) in the next 14 days.`, href: "/admin/schedules" });
  if (pendingCerts > 0) notifications.push({ icon: "🏅", tone: "warn", text: `${pendingCerts} eligible participant(s) awaiting certificate generation.`, href: "/admin/certificates/generate" });
  for (const r of runs.slice(0, 3)) {
    if (r.status === "failed") notifications.push({ icon: "⛔", tone: "danger", text: `${RUN_LABELS[r.run_type] ?? r.run_type} failed — ${r.summary}`, href: "/admin/automation" });
    else if (r.status === "partial") notifications.push({ icon: "⚠️", tone: "warn", text: `${r.summary}`, href: "/admin/automation" });
  }
  if (imports[0]) notifications.push({ icon: "📥", tone: "success", text: `Last import: ${imports[0].summary}`, href: "/admin/participants/import" });
  if (!notifications.length) notifications.push({ icon: "✅", tone: "success", text: "All clear — no pending automation alerts." });

  return (
    <>
      <PageHead
        title="Operational Automation Centre"
        subtitle="Bulk operations, auto-numbering, notifications, activity and templates — configurable by administrators."
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/automation/templates" className="ta-btn ta-btn-outline ta-btn-sm">🧩 Templates</Link>
            <Link href="/admin/automation/settings" className="ta-btn ta-btn-primary ta-btn-sm">⚙️ Settings</Link>
          </div>
        }
      />

      {/* Snapshot */}
      <div className="ta-grid cols-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔁" label="Automation runs (recent)" value={runs.length} />
        <StatCard icon="🏅" label="Certs awaiting generation" value={pendingCerts} href="/admin/certificates/generate" />
        <StatCard icon="📅" label="Upcoming (14 days)" value={upcoming.length} href="/admin/schedules" />
        <StatCard icon="🧩" label="Templates" value={templateCount} href="/admin/automation/templates" />
      </div>

      {/* Quick actions */}
      <Card title="Quick Actions">
        <div className="ta-card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/participants/import" className="ta-btn ta-btn-outline">📥 Bulk Participant Import</Link>
          <Link href="/admin/certificates/generate" className="ta-btn ta-btn-outline">🏅 Bulk Certificate Generation</Link>
          <Link href="/admin/certificates" className="ta-btn ta-btn-outline">🗜 Bulk Certificate Download (ZIP)</Link>
          <Link href="/admin/automation/templates" className="ta-btn ta-btn-outline">🧩 Template Manager</Link>
          <Link href="/admin/automation/settings" className="ta-btn ta-btn-outline">⚙️ System Settings</Link>
          <button className="ta-btn ta-btn-outline" disabled title="Email delivery — coming soon">✉ Email Queue (soon)</button>
        </div>
      </Card>

      <div className="ta-grid cols-2" style={{ marginTop: 18, alignItems: "start" }}>
        {/* Notification Centre */}
        <Card title="Notification Centre">
          <div className="ta-card-pad" style={{ display: "grid", gap: 10 }}>
            {notifications.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: "var(--ta-bg-subtle, #f6f8fb)" }}>
                <span aria-hidden="true" style={{ fontSize: 16 }}>{n.icon}</span>
                <span style={{ fontSize: 13.5, flex: 1 }}>{n.text}</span>
                {n.href && <Link href={n.href} style={{ fontSize: 12.5, color: "var(--ta-info)", whiteSpace: "nowrap" }}>Open ↗</Link>}
              </div>
            ))}
          </div>
        </Card>

        {/* Activity Timeline */}
        <Card title="Activity Timeline" action={<Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/audit">Full log</Link>}>
          {audit.length ? (
            <div className="ta-card-pad" style={{ display: "grid", gap: 0 }}>
              {audit.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: i < audit.length - 1 ? "1px solid var(--ta-border, #eef1f6)" : "none" }}>
                  <Badge status={l.action} />
                  <span style={{ fontSize: 13, flex: 1 }}>{l.summary ?? `${l.action} ${l.entity_type ?? ""}`}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ta-muted)", whiteSpace: "nowrap" }}>{timeAgo(l.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState icon="📋" message="No activity yet." />}
        </Card>
      </div>

      {/* Automation run history (import history + bulk ops) */}
      <Card title="Automation Run History">
        {runs.length ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>When</th><th>Type</th><th>Status</th><th>Total</th><th>OK</th><th>Skipped</th><th>Failed</th><th>Summary</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ta-muted)" }}>{formatMalaysiaDateTime(r.created_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{RUN_LABELS[r.run_type] ?? r.run_type}</td>
                    <td><Badge status={r.status} /></td>
                    <td>{r.total_count}</td>
                    <td style={{ color: "var(--ta-success)" }}>{r.success_count}</td>
                    <td>{r.skipped_count}</td>
                    <td style={{ color: r.failed_count ? "var(--ta-danger)" : undefined }}>{r.failed_count}</td>
                    <td style={{ color: "var(--ta-muted)", fontSize: 12.5 }}>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="🔁" message="No automation runs recorded yet. Run a bulk import or certificate generation to see history here." />}
      </Card>
    </>
  );
}
