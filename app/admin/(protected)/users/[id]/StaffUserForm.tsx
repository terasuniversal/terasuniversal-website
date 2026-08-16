"use client";

import { useActionState, useRef } from "react";
import { Card, Badge } from "../../../../../components/admin/ui";
import { DEPARTMENT_LABELS } from "../../../../../lib/auth/rbac";
import type { Profile, StaffModuleCatalog, ModuleAccessLevel, StaffDepartment } from "../../../../../lib/supabase/database.types";
import { updateStaffProfile, saveStaffModuleAccess, type StaffActionState } from "../actions";

const LEVELS: ("none" | ModuleAccessLevel)[] = ["none", "view", "edit", "admin"];

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
                  {["super_admin", "admin", "editor", "trainer", "client", "participant"].map((role) => (
                    <option key={role} value={role}>{role.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="is_active" type="checkbox" defaultChecked={profile.is_active} />
                <span>Active account</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="access_control_enabled" type="checkbox" defaultChecked={profile.access_control_enabled} />
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

        <Card title="Module access" action={<Badge status={profile.access_control_enabled ? "restricted" : "editor"} />}>
          <div className="ta-card-pad">
            <form action={accessAction} onSubmit={serializeModules}>
              <input ref={modulesRef} type="hidden" name="modules" value="" readOnly />
              <p style={{ color: "var(--ta-muted)", fontSize: 13, marginBottom: 12 }}>
                Applies when explicit access is enabled. Legacy role-based behavior is preserved otherwise.
              </p>
              {groups.map((group) => (
                <div key={group.group} style={{ marginBottom: 14 }}>
                  <h4 style={{ textTransform: "capitalize", fontSize: 13, marginBottom: 8, color: "var(--ta-muted)" }}>{group.group}</h4>
                  <div className="ta-table-wrap">
                    <table className="ta-table" style={{ minWidth: 420 }}>
                      <thead><tr><th>Module</th><th>Access level</th></tr></thead>
                      <tbody>
                        {group.items.map((item) => (
                          <tr key={item.module_key}>
                            <td>{item.label}</td>
                            <td>
                              <select data-module-level={item.module_key} defaultValue={existingAccess[item.module_key] ?? "none"}>
                                {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <button type="submit" className="ta-btn ta-btn-outline" disabled={accessPending}>
                {accessPending ? "Saving…" : "Save module access"}
              </button>
              {accessState?.message && <span style={{ marginLeft: 10, color: "var(--ta-muted)" }}>{accessState.message}</span>}
            </form>
          </div>
        </Card>
    </div>
  );
}
