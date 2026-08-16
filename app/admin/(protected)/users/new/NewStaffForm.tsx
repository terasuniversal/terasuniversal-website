"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "../../../../../components/admin/ui";
import { DEPARTMENT_LABELS, STAFF_DEPARTMENTS, hasMinRole } from "../../../../../lib/auth/rbac";
import type { StaffModuleCatalog, ModuleAccessLevel, UserRole, StaffDepartment } from "../../../../../lib/supabase/database.types";
import { createStaff, type StaffActionState } from "../actions";

const LEVELS: ("none" | ModuleAccessLevel)[] = ["none", "view", "edit", "admin"];
const ROLES: UserRole[] = ["super_admin", "admin", "editor", "trainer", "client", "participant"];

/**
 * UI convenience preset — NOT an authorization source. The database RPCs
 * (app.can_manage_staff / set_staff_module_access) remain the enforcement
 * boundary. Privileged modules (users, audit, system, backups, automation,
 * certificate_templates) are intentionally excluded; a Super Admin can grant
 * them manually afterwards.
 */
const SALES_STAFF_PRESET: Record<string, ModuleAccessLevel> = {
  sales: "edit",
  sales_leads: "edit",
  sales_opportunities: "edit",
  sales_quotations: "edit",
  sales_followups: "edit",
  sales_tasks: "edit",
  sales_reports: "view",
};

export function NewStaffForm({ catalog }: { catalog: StaffModuleCatalog[] }) {
  const [state, formAction, pending] = useActionState(createStaff, {} as StaffActionState);
  const [explicit, setExplicit] = useState(true);
  const [role, setRole] = useState<UserRole>("editor");
  const modulesRef = useRef<HTMLInputElement>(null);

  function applyPreset() {
    for (const item of catalog) {
      const el = document.querySelector<HTMLSelectElement>(`[data-module-level="${item.module_key}"]`);
      if (el) el.value = SALES_STAFF_PRESET[item.module_key] ?? "none";
    }
  }

  function serializeModules() {
    const entries: { module_key: string; access_level: ModuleAccessLevel }[] = [];
    for (const item of catalog) {
      const el = document.querySelector<HTMLSelectElement>(`[data-module-level="${item.module_key}"]`);
      const level = (el?.value ?? "none") as "none" | ModuleAccessLevel;
      if (level !== "none") entries.push({ module_key: item.module_key, access_level: level });
    }
    if (modulesRef.current) modulesRef.current.value = JSON.stringify(entries);
  }

  const groups: { group: string; items: StaffModuleCatalog[] }[] = [];
  for (const item of catalog) {
    const last = groups[groups.length - 1];
    if (!last || last.group !== item.group_key) groups.push({ group: item.group_key, items: [item] });
    else last.items.push(item);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 18 }}>
      {state?.created && (
        <Card title="Staff account created">
          <div className="ta-card-pad">
            <p>
              <strong style={{ color: "var(--ta-success)" }}>{state.email}</strong> can now sign in.
            </p>
            <p style={{ marginTop: 8 }}>
              One-time initial password:{" "}
              <code style={{ background: "var(--ta-bg)", border: "1px solid var(--ta-line)", borderRadius: 6, padding: "2px 8px", color: "var(--ta-navy)", fontWeight: 700 }}>
                {state.password}
              </code>
            </p>
            <p style={{ color: "var(--ta-muted)", fontSize: 13, marginTop: 8 }}>
              Share this password securely with the new staff member. Ask them to change it on first sign-in. It is shown only once.
            </p>
            <Link href="/admin/users" className="ta-btn ta-btn-outline" style={{ marginTop: 12 }}>Go to Staff</Link>
          </div>
        </Card>
      )}

      <Card title="Account details">
        <div className="ta-card-pad">
          <form action={formAction} onSubmit={serializeModules}>
            <input ref={modulesRef} type="hidden" name="modules" value="" readOnly />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <label className="ta-field">
                <span>Full name</span>
                <input name="full_name" type="text" required minLength={2} maxLength={120} autoComplete="off" />
              </label>
              <label className="ta-field">
                <span>Email</span>
                <input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="name@company.com" />
              </label>
              <label className="ta-field">
                <span>Department</span>
                <select name="department" defaultValue="sales">
                  <option value="">Not assigned</option>
                  {STAFF_DEPARTMENTS.map((dept: StaffDepartment) => (
                    <option key={dept} value={dept}>{DEPARTMENT_LABELS[dept]}</option>
                  ))}
                </select>
              </label>
              <label className="ta-field">
                <span>Role</span>
                <select name="role" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="is_active" type="checkbox" defaultChecked />
                <span>Active account</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  name="access_control_enabled"
                  type="checkbox"
                  checked={explicit}
                  onChange={(event) => setExplicit(event.target.checked)}
                />
                <span>Enable explicit module access</span>
              </label>
            </div>

            {!explicit && (
              <div
                role="status"
                style={{
                  background: "var(--ta-bg)",
                  border: "1px solid var(--ta-line)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginTop: 14,
                  color: "var(--ta-ink)",
                }}
              >
                <strong style={{ color: "var(--ta-navy)" }}>Using role defaults</strong>
                <div style={{ color: "var(--ta-muted)", fontSize: 13, marginTop: 2 }}>
                  Explicit module access is disabled. Access is inherited from the staff role.
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <button type="submit" className="ta-btn ta-btn-gold" disabled={pending}>
                {pending ? "Creating…" : "Create staff account"}
              </button>
              {state?.message && !state?.created && <span style={{ marginLeft: 10, color: "var(--ta-muted)" }}>{state.message}</span>}
              {state?.errors && Object.entries(state.errors).map(([k, v]) => (
                <span key={k} role="alert" style={{ display: "block", color: "#b3261e", fontSize: 12 }}>{k}: {v}</span>
              ))}
            </div>
          </form>
        </div>
      </Card>

      <Card
        title="Module access"
        action={
          <span className="ta-badge-pill restricted">{explicit ? "Explicit Access" : "Role Default"}</span>
        }
      >
        <div className="ta-card-pad">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <p style={{ color: "var(--ta-muted)", fontSize: 13, margin: 0 }}>
              Applies when explicit access is enabled. Modules excluded here can be granted later by a Super Admin.
            </p>
            <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={applyPreset} disabled={!explicit}>
              Sales Staff preset
            </button>
          </div>

          {groups.map((group) => (
            <div key={group.group} style={{ marginBottom: 16 }}>
              <h4 style={{ textTransform: "capitalize", fontSize: 13, marginBottom: 8, color: "var(--ta-muted)" }}>{group.group}</h4>
              <div className="ta-table-wrap">
                <table className="ta-table" style={{ minWidth: 460 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "55%" }}>Module</th>
                      <th>{explicit ? "Access level" : "Effective access"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.module_key}>
                        <td>{item.label}</td>
                        <td>
                          {explicit ? (
                            <select
                              data-module-level={item.module_key}
                              defaultValue="none"
                              aria-label={`${item.label} access level`}
                            >
                              {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: hasMinRole(role, item.min_role) ? "var(--ta-success)" : "var(--ta-muted)", fontSize: 13 }}>
                              {hasMinRole(role, item.min_role) ? "Role default" : "No access via role"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {!explicit && (
            <p style={{ fontSize: 12, color: "var(--ta-muted)" }}>Enable explicit module access to edit module permissions.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
