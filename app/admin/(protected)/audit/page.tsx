import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination, StatCard } from "../../../../components/admin/ui";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Audit Log — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; action?: string; entity?: string }>;
}) {
  await requireRole("admin");
  await requireModuleAccess("audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const searchTerm = sp.q?.trim().slice(0, 80).replace(/[%_,()]/g, " ") ?? "";
  const supabase = await createSupabaseServerClient();
  let query = (supabase.from("audit_logs") as any)
    .select("id, actor_email, action, entity_type, entity_id, summary, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (searchTerm) query = query.or(`actor_email.ilike.%${searchTerm}%,summary.ilike.%${searchTerm}%,entity_id.ilike.%${searchTerm}%`);
  if (sp.action) query = query.eq("action", sp.action);
  if (sp.entity) query = query.eq("entity_type", sp.entity);

  const [{ data: logs, count }, { count: totalCount }, { data: recent }] = await Promise.all([
    query,
    (supabase.from("audit_logs") as any).select("id", { count: "exact", head: true }),
    (supabase.from("audit_logs") as any).select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const key of ["q", "action", "entity"] as const) if (sp[key]) qsBase[key] = sp[key]!;
  const filtersApplied = Boolean(sp.q || sp.action || sp.entity);
  const currentLogs = (logs ?? []) as any[];
  const actionOptions = Array.from(new Set<string>(currentLogs.map((item) => String(item.action ?? "")).filter(Boolean))).slice(0, 20);
  const entityOptions = Array.from(new Set<string>(currentLogs.map((item) => String(item.entity_type ?? "")).filter(Boolean))).slice(0, 20);

  return <>
    <PageHead title="Audit Log" subtitle="Append-only record of privileged activity." action={<Link href="/admin/users" className="ta-btn ta-btn-outline">Users & Roles</Link>} />
    <div className="ta-grid cols-3" style={{ marginBottom: 18 }}>
      <StatCard icon="📋" label="All recorded events" value={totalCount ?? 0} />
      <StatCard icon="🔎" label="Matching events" value={count ?? 0} />
      <StatCard icon="◷" label="Latest activity" value={recent?.created_at ? formatMalaysiaDate(recent.created_at) : "None"} />
    </div>
    <form className="ta-toolbar" role="search" style={{ alignItems: "flex-end" }}>
      <div className="ta-search" style={{ maxWidth: 290 }}><span className="ta-search-ico" aria-hidden="true">⌕</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Actor, summary or record ID…" aria-label="Search audit log" /></div>
      <select name="action" defaultValue={sp.action ?? ""} style={selectStyle} aria-label="Action"><option value="">All actions</option>{actionOptions.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select>
      <select name="entity" defaultValue={sp.entity ?? ""} style={selectStyle} aria-label="Record type"><option value="">All record types</option>{entityOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply filters</button>
      {filtersApplied && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/audit">Reset filters</Link>}
    </form>
    <Card title="Activity records">
      {logs && logs.length > 0 ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Summary</th></tr></thead><tbody>{logs.map((item: any) => <tr key={item.id}><td style={{ color: "var(--ta-muted)", whiteSpace: "nowrap" }}>{formatMalaysiaDateTime(item.created_at)}</td><td>{item.actor_email ?? "System"}</td><td><Badge status={item.action} /></td><td>{item.entity_type ?? "—"}</td><td style={{ color: "var(--ta-muted)" }}>{item.summary ?? "—"}</td></tr>)}</tbody></table></div> : <EmptyState icon="📋" message={filtersApplied ? "No activity matches these filters." : "No activity recorded yet."} />}
    </Card>
    <Pagination page={page} pageCount={pageCount} basePath="/admin/audit" query={qsBase} />
  </>;
}

const selectStyle = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 170 } as const;
