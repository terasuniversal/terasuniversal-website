import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { Badge, Card, EmptyState, PageHead, Pagination, StatCard } from "../../../../components/admin/ui";
import type { Profile, UserRole } from "../../../../lib/supabase/database.types";

export const metadata = { title: "Users & Roles — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const roles: UserRole[] = ["super_admin", "admin", "editor", "trainer", "client", "participant"];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; role?: string; status?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("profiles")
    .select("id, email, full_name, job_title, role, is_active, last_login_at, created_at", { count: "exact" })
    .order("full_name", { ascending: true, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q}%,email.ilike.%${sp.q}%`);
  if (roles.includes(sp.role as UserRole)) query = query.eq("role", sp.role as UserRole);
  if (sp.status === "active") query = query.eq("is_active", true);
  if (sp.status === "inactive") query = query.eq("is_active", false);

  const [{ data, count }, { count: activeCount }, { count: adminCount }] = await Promise.all([
    query,
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["super_admin", "admin"]),
  ]);
  const users = (data ?? []) as Pick<Profile, "id" | "email" | "full_name" | "job_title" | "role" | "is_active" | "last_login_at" | "created_at">[];
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const key of ["q", "role", "status"] as const) if (sp[key]) qsBase[key] = sp[key]!;
  const filtersApplied = Boolean(sp.q || sp.role || sp.status);

  return <>
    <PageHead title="Users & Roles" subtitle="Staff directory and access overview. Changes to access remain deliberately restricted." action={<Link href="/admin/audit" className="ta-btn ta-btn-outline">View audit log</Link>} />
    <div className="ta-grid cols-3" style={{ marginBottom: 18 }}>
      <StatCard icon="👥" label="Matching staff" value={count ?? 0} />
      <StatCard icon="✓" label="Active accounts" value={activeCount ?? 0} />
      <StatCard icon="🔐" label="Admin-level accounts" value={adminCount ?? 0} />
    </div>
    <form className="ta-toolbar" role="search" style={{ alignItems: "flex-end" }}>
      <div className="ta-search" style={{ maxWidth: 280 }}>
        <span className="ta-search-ico" aria-hidden="true">⌕</span>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or email…" aria-label="Search users" />
      </div>
      <select name="role" defaultValue={sp.role ?? ""} style={selectStyle} aria-label="Role">
        <option value="">All roles</option>
        {roles.map((role) => <option key={role} value={role}>{role.replace("_", " ")}</option>)}
      </select>
      <select name="status" defaultValue={sp.status ?? ""} style={selectStyle} aria-label="Account status">
        <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
      </select>
      <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply filters</button>
      {filtersApplied && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/users">Reset filters</Link>}
    </form>
    <Card title="Staff accounts">
      {users.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Last login</th><th>Added</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.id}><td><strong>{user.full_name || "Unnamed user"}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{user.email}{user.job_title ? ` · ${user.job_title}` : ""}</div></td><td><Badge status={user.role} /></td><td><Badge status={user.is_active ? "active" : "inactive"} /></td><td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString("en-MY") : <span style={{ color: "var(--ta-muted)" }}>Never</span>}</td><td>{new Date(user.created_at).toLocaleDateString("en-MY")}</td></tr>)}
      </tbody></table></div> : <EmptyState icon="👥" message={filtersApplied ? "No staff accounts match these filters." : "No staff accounts are available."} />}
    </Card>
    <p className="ta-page-note">For security, account invitations, role changes and deactivation should be handled through an approved administrator process and recorded in the audit log.</p>
    <Pagination page={page} pageCount={pageCount} basePath="/admin/users" query={qsBase} />
  </>;
}

const selectStyle = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 170 } as const;
