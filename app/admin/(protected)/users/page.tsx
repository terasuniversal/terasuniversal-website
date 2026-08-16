import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../lib/auth/session";
import { Badge, Card, EmptyState, PageHead, Pagination, StatCard } from "../../../../components/admin/ui";
import { STAFF_DEPARTMENTS, DEPARTMENT_LABELS } from "../../../../lib/auth/rbac";
import type { Profile, UserRole, StaffDepartment } from "../../../../lib/supabase/database.types";
import { setStaffActive } from "./actions";
import { ToggleStaffActiveForm } from "./ToggleStaffActiveForm";

export const metadata = { title: "Staff Users — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const roles: UserRole[] = ["super_admin", "admin", "editor", "trainer", "client", "participant"];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; role?: string; department?: string; status?: string }>;
}) {
  await requireModuleAccess("users");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("profiles")
    .select(
      "id, email, full_name, job_title, role, department, is_active, access_control_enabled, updated_at, last_login_at, created_at",
      { count: "exact" }
    )
    .order("full_name", { ascending: true, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q}%,email.ilike.%${sp.q}%`);
  if (roles.includes(sp.role as UserRole)) query = query.eq("role", sp.role as UserRole);
  if (STAFF_DEPARTMENTS.includes(sp.department as StaffDepartment)) query = query.eq("department", sp.department as StaffDepartment);
  if (sp.status === "active") query = query.eq("is_active", true);
  if (sp.status === "inactive") query = query.eq("is_active", false);

  const [{ data, count }, { count: activeCount }, { count: adminCount }, { count: activeSuperAdminCount }, { data: accessRows }] = await Promise.all([
    query,
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["super_admin", "admin"]),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin").eq("is_active", true),
    supabase.from("staff_module_access").select("user_id"),
  ]);

  const users = (data ?? []) as Array<
    Pick<Profile, "id" | "email" | "full_name" | "job_title" | "role" | "department" | "is_active" | "access_control_enabled" | "updated_at" | "last_login_at" | "created_at">
  >;
  const moduleCounts = new Map<string, number>();
  for (const row of (accessRows ?? []) as { user_id: string }[]) {
    moduleCounts.set(row.user_id, (moduleCounts.get(row.user_id) ?? 0) + 1);
  }

  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);
  const qsBase: Record<string, string> = {};
  for (const key of ["q", "role", "department", "status"] as const) if (sp[key]) qsBase[key] = sp[key]!;
  const filtersApplied = Boolean(sp.q || sp.role || sp.department || sp.status);

  return (
    <>
      <PageHead
        title="Staff Users"
        subtitle="Staff directory — department, role, status and module access. Server-side authorization is enforced on every action."
        action={
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/admin/users/new" className="ta-btn ta-btn-gold">+ Add Staff</Link>
            <Link href="/admin/audit" className="ta-btn ta-btn-outline">View audit log</Link>
          </span>
        }
      />
      <div className="ta-grid cols-3" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" label="Matching staff" value={count ?? 0} />
        <StatCard icon="✓" label="Active accounts" value={activeCount ?? 0} />
        <StatCard icon="🔐" label="Admin-level accounts" value={adminCount ?? 0} />
      </div>
      <form className="ta-toolbar" role="search" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or email…" aria-label="Search users" />
        </div>
        <select name="role" defaultValue={sp.role ?? ""} style={selectStyle} aria-label="Role">
          <option value="">All roles</option>
          {roles.map((role) => <option key={role} value={role}>{role.replace("_", " ")}</option>)}
        </select>
        <select name="department" defaultValue={sp.department ?? ""} style={selectStyle} aria-label="Department">
          <option value="">All departments</option>
          {STAFF_DEPARTMENTS.map((dept) => <option key={dept} value={dept}>{DEPARTMENT_LABELS[dept]}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} style={selectStyle} aria-label="Account status">
          <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply filters</button>
        {filtersApplied && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/users">Reset filters</Link>}
      </form>
      <Card title="Staff accounts">
        {users.length ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Staff member</th><th>Department</th><th>Role</th><th>Status</th><th>Module access</th><th>Last updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name || "Unnamed user"}</strong>
                      <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{user.email}{user.job_title ? ` · ${user.job_title}` : ""}</div>
                    </td>
                    <td>{user.department ? DEPARTMENT_LABELS[user.department] : "—"}</td>
                    <td><Badge status={user.role} /></td>
                    <td><Badge status={user.is_active ? "active" : "inactive"} /></td>
                    <td>
                      {user.access_control_enabled ? (
                        <span><Badge status="restricted" /> <span style={{ color: "var(--ta-muted)" }}>{moduleCounts.get(user.id) ?? 0} module(s)</span></span>
                      ) : (
                        <span style={{ color: "var(--ta-muted)" }}>Role defaults</span>
                      )}
                    </td>
                    <td>{user.updated_at ? new Date(user.updated_at).toLocaleString("en-MY") : <span style={{ color: "var(--ta-muted)" }}>Never</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Link href={`/admin/users/${user.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View / Edit</Link>
                        <ToggleStaffActiveForm
                          userId={user.id}
                          isActive={user.is_active}
                          isLastActiveSuperAdmin={user.role === "super_admin" && user.is_active && (activeSuperAdminCount ?? 0) === 1}
                          action={setStaffActive}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="👥" message={filtersApplied ? "No staff accounts match these filters." : "No staff accounts are available."} />
        )}
      </Card>
      <p className="ta-page-note">
        Accounts with "Role defaults" follow the module catalog role threshold. Enabling explicit access control restricts them to the modules granted here. Admins can manage non-admin staff; only Super Admins manage admin accounts.
      </p>
      <Pagination page={page} pageCount={pageCount} basePath="/admin/users" query={qsBase} />
    </>
  );
}

const selectStyle = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 170 } as const;
