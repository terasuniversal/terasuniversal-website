"use client";

import { useActionState, useRef } from "react";
import { Card } from "../../../../../components/admin/ui";
import { DEPARTMENT_LABELS, hasMinRole } from "../../../../../lib/auth/rbac";
import type { Profile, StaffModuleCatalog, ModuleAccessLevel, StaffDepartment, UserRole } from "../../../../../lib/supabase/database.types";
import { updateStaffProfile, saveStaffModuleAccess, type StaffActionState } from "../actions";

const LEVELS: ("none" | ModuleAccessLevel)[] = ["none", "view", "edit", "admin"];

const ROLES: UserRole[] = ["super_admin", "admin", "editor", "trainer", "client", "participant"];

/**
 * Module-access header pill. The text reflects the profile's real effective
 * mode — Super Admin always has full access, explicit mode shows the explicit
 * state, and everything else shows the role-default fallback.
 */
function AccessModePill({ profile }: { profile: Profile }) {
  if (profile.role === "super_admin") {
    return <span className="ta-badge-pill super_admin">Full Access</span>;
  }
  if (profile.access_control_enabled) {
    return <span className="ta-badge-pill restricted">Explicit Access</span>;
  }
  return <span className="ta-badge-pill editor">Role Default</span>;
}

export function StaffUserForm({
  profile,
  catalog,
  existingAccess,
  departments,
}: {
  profile: Profile;
  catalog: StaffModuleCatalog[];
  existingAccess: Record<string, ModuleAccessLevel>;
  departments: StaffDepartment[];
}) {
  const [profileState, profileAction, profilePending] = useActionState(
    updateStaffProfile.bind(null, profile.id),
    {} as StaffActionState
  );
  const [accessState, accessAction, accessPending] = useActionState(
    saveStaffModuleAccess.bind(null, profile.id),
    {} as StaffActionState
  );
  const modulesRef = useRef<HTMLInputElement>(null);

  const explicit = profile.access_control_enabled;
  const isSuper = profile.role === "super_admin";

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
      <Card title="Profile details">
        <div className="ta-card-pad">
          <form action={profileAction}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <label className="ta-field">
                <span>Display name</span>
                <input name="full_name" type="text" defaultValue={profile.full_name ?? ""} required minLength={2} maxLength={120} />
              </label>
              <label className="ta-field">
                <span>Department</span>
                <select name="department" defaultValue={profile.department ?? ""}>
                  <option value="">Not assigned</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>{DEPARTMENT_LABELS[dept]}</option>
                  ))}
                </select>
              </label>
              <label className="ta-field">
                <span>Role</span>
                <select name="role" defaultValue={profile.role}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="is_active" type="checkbox" defaultChecked={profile.is_active} />
                <span>Active account</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="access_control_enabled" type="checkbox" defaultChecked={explicit} />
                <span>Enable explicit module access (disables role-default fallback)</span>
              </label>
            </div>
            <div style={{ marginTop: 14 }}>
              <button type="submit" className="ta-btn ta-btn-gold" disabled={profilePending}>
                {profilePending ? "Saving…" : "Save profile"}
              </button>
              {profileState?.message && <span style={{ marginLeft: 10, color: "var(--ta-muted)" }}>{profileState.message}</span>}
              {profileState?.errors && Object.entries(profileState.errors).map(([k, v]) => (
                <span key={k} role="alert" style={{ display: "block", color: "#b3261e", fontSize: 12 }}>{k}: {v}</span>
              ))}
            </div>
          </form>
        </div>
      </Card>

      <Card title="Module access" action={<AccessModePill profile={profile} />}>
        <div className="ta-card-pad">
          <form action={accessAction} onSubmit={serializeModules}>
            <input ref={modulesRef} type="hidden" name="modules" value="" readOnly />
            {!explicit && (
              <div
                role="status"
                style={{
                  background: "var(--ta-bg)",
                  border: "1px solid var(--ta-line)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 14,
                  color: "var(--ta-ink)",
                }}
              >
                <strong style={{ color: "var(--ta-navy)" }}>
                  {isSuper ? "Full Access — Super Admin" : "Using role defaults"}
                </strong>
                <div style={{ color: "var(--ta-muted)", fontSize: 13, marginTop: 2 }}>
                  {isSuper
                    ? "This account has full access to every module by role. Explicit module access is disabled."
                    : "Explicit module access is disabled. Access is inherited from the staff role."}
                </div>
              </div>
            )}

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
                                defaultValue={existingAccess[item.module_key] ?? "none"}
                                aria-label={`${item.label} access level`}
                              >
                                {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                              </select>
                            ) : (
                              <span style={{ color: isSuper || hasMinRole(profile.role, item.min_role) ? "var(--ta-success)" : "var(--ta-muted)", fontSize: 13 }}>
                                {isSuper ? "Full Access" : hasMinRole(profile.role, item.min_role) ? "Role default" : "No access via role"}
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

            <button
              type="submit"
              className="ta-btn ta-btn-outline"
              disabled={!explicit || accessPending}
              title={explicit ? undefined : "Enable explicit module access to edit module permissions."}
            >
              {accessPending ? "Saving…" : "Save module access"}
            </button>
            {!explicit && (
              <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ta-muted)" }}>
                Enable explicit module access to edit permissions.
              </span>
            )}
            {accessState?.message && <span style={{ marginLeft: 10, color: "var(--ta-muted)" }}>{accessState.message}</span>}
          </form>
        </div>
      </Card>
    </div>
  );
}
