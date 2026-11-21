"use client";

import { useActionState, useState, type FormEvent } from "react";
import { DEPARTMENTS, MODULE_CATALOG, SALES_STAFF_PRESET, type ModuleAccessLevel } from "../../../../lib/auth/rbac";
import { inviteStaffAction, updateStaffAction, type StaffActionState } from "./actions";
import type { Profile, UserRole } from "../../../../lib/supabase/database.types";

type AccessMode = "role_default" | "custom";

type StaffFormProfile = Pick<Profile, "id" | "email" | "full_name" | "department" | "role" | "is_active" | "access_control_enabled"> & {
  moduleAccess: Array<{ moduleKey: string; accessLevel: string }>;
};

const ACCESS_LEVEL_LABELS: Record<ModuleAccessLevel, string> = {
  view: "View",
  edit: "Edit",
  admin: "Admin",
};

function accessLevelOrView(value: string): ModuleAccessLevel {
  return value === "edit" || value === "admin" ? value : "view";
}

export function StaffUserForm({ profile }: { profile?: StaffFormProfile }) {
  const edit = Boolean(profile);
  const [state, formAction, pending] = useActionState<StaffActionState, FormData>(
    edit ? updateStaffAction : inviteStaffAction,
    {},
  );
  const [department, setDepartment] = useState(profile?.department ?? "sales");
  const [role, setRole] = useState<UserRole>(profile?.role ?? "editor");
  // Access mode is an explicit choice, never inferred from checkbox state --
  // an existing profile starts at whatever access_control_enabled already
  // is; a new invite defaults to the safe choice, Role Default. Module keys
  // are only ever meaningful in Custom mode; switching to Role Default
  // doesn't clear `selected` client-side (nothing is submitted for it
  // either way when the mode is role_default -- see the submit gate below),
  // so toggling back to Custom restores whatever was selected before.
  const [mode, setMode] = useState<AccessMode>(profile?.access_control_enabled ? "custom" : "role_default");
  const [selected, setSelected] = useState<string[]>(profile?.moduleAccess.map((item) => item.moduleKey) ?? []);
  const [levels, setLevels] = useState<Record<string, ModuleAccessLevel>>(
    Object.fromEntries(profile?.moduleAccess.map((item) => [item.moduleKey, accessLevelOrView(item.accessLevel)]) ?? []),
  );
  const [presetApplied, setPresetApplied] = useState(false);

  // Per-module access is chosen explicitly: None removes the module, View/Edit set its level. "Admin" is only
  // offered where it is already saved, so this form can never grant a level that the previous form could not.
  function setModuleLevel(key: string, value: ModuleAccessLevel | "none") {
    if (value === "none") {
      setSelected((current) => current.filter((item) => item !== key));
      return;
    }
    setLevels((previous) => ({ ...previous, [key]: value }));
    setSelected((current) => (current.includes(key) ? current : [...current, key]));
  }

  const savedAdminKeys = new Set(profile?.moduleAccess.filter((item) => item.accessLevel === "admin").map((item) => item.moduleKey) ?? []);
  const targetIsAdmin = role === "admin" || role === "super_admin";

  function applySalesPreset() {
    setDepartment(SALES_STAFF_PRESET.department);
    setRole(SALES_STAFF_PRESET.role);
    setMode("custom");
    setSelected(SALES_STAFF_PRESET.modules.map((module) => module.moduleKey));
    setLevels(Object.fromEntries(SALES_STAFF_PRESET.modules.map((module) => [module.moduleKey, module.accessLevel])));
    setPresetApplied(true);
  }

  const showsAccessControls = role !== "super_admin";
  const customWithNoModules = showsAccessControls && mode === "custom" && selected.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (customWithNoModules) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="ta-form">
      {profile && <input type="hidden" name="user_id" value={profile.id} />}
      <div className="ta-grid cols-2">
        <div className="ta-field">
          <label htmlFor="full_name">Full Name</label>
          <input id="full_name" name="full_name" defaultValue={profile?.full_name ?? ""} required minLength={2} maxLength={120} />
        </div>
        <div className="ta-field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={profile?.email ?? ""} readOnly={edit} required />
        </div>
        <div className="ta-field">
          <label htmlFor="department">Department</label>
          <select id="department" name="department" value={department} onChange={(event) => setDepartment(event.target.value as typeof department)} required>
            {DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <small style={{ color: "var(--ta-muted)" }}>Department is organisational metadata; access remains explicit below.</small>
        </div>
        <div className="ta-field">
          <label htmlFor="role">Role</label>
          <select id="role" name="role" value={role} onChange={(event) => setRole(event.target.value as UserRole)} required>
            {profile?.role === "super_admin" && <option value="super_admin">Super Admin</option>}
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="trainer">Trainer</option>
          </select>
        </div>
        <div className="ta-field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={profile?.is_active === false ? "inactive" : "active"}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--ta-line)", borderRadius: 12, padding: 16 }}>
        <legend style={{ padding: "0 8px", fontWeight: 700 }}>Module Access</legend>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={applySalesPreset}>
            {edit ? "Apply Sales Staff preset" : "Use Sales Staff preset"}
          </button>
          <small style={{ color: "var(--ta-muted)" }}>Draft only — review the modules below before saving.</small>
        </div>
        {presetApplied && (
          <p className="ta-card ta-card-pad" role="status" style={{ margin: "0 0 14px", fontSize: 13 }}>
            Sales Staff draft applied: Editor, Sales, and Custom Module Access are selected. Nothing is saved until you submit this form.
          </p>
        )}
        {!showsAccessControls ? (
          <p style={{ color: "var(--ta-muted)", margin: 0 }}>Super Admin is unrestricted and does not require permission rows.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="radio" name="access_mode" value="role_default" checked={mode === "role_default"} onChange={() => setMode("role_default")} />
                <span>Role Default Access</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="radio" name="access_mode" value="custom" checked={mode === "custom"} onChange={() => setMode("custom")} />
                <span>Custom Module Access</span>
              </label>
            </div>
            {mode === "role_default" ? (
              <p style={{ color: "var(--ta-muted)", margin: 0, fontSize: 13 }}>This staff member gets the default modules for their role. No explicit module list is stored or used.</p>
            ) : (
              <>
                <input type="hidden" name="module_access" value={JSON.stringify(selected.map((moduleKey) => ({ module_key: moduleKey, access_level: levels[moduleKey] ?? "view" })))} />
                <div className="ta-grid cols-2">
                  {MODULE_CATALOG.map((module) => {
                    const isSelected = selected.includes(module.key);
                    const current = isSelected ? (levels[module.key] ?? "view") : "none";
                    const viewOnly = module.key === "hrdf_claims" && !targetIsAdmin;
                    const selectId = `module-level-${module.key}`;
                    return (
                      <div key={module.key} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                        {isSelected && <input type="hidden" name="module_key" value={module.key} />}
                        <label htmlFor={selectId} style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                          <span>{module.label}{module.key === "hrdf_claims" ? " (view only for non-admin staff)" : ""}</span>
                          <small style={{ color: "var(--ta-muted)" }}>{module.group}</small>
                        </label>
                        <select
                          id={selectId}
                          aria-label={`${module.label} access`}
                          value={current}
                          onChange={(event) => setModuleLevel(module.key, event.target.value as ModuleAccessLevel | "none")}
                          style={{ minHeight: 44, minWidth: 96 }}
                        >
                          <option value="none">None</option>
                          <option value="view">{ACCESS_LEVEL_LABELS.view}</option>
                          <option value="edit" disabled={viewOnly}>{ACCESS_LEVEL_LABELS.edit}</option>
                          {(savedAdminKeys.has(module.key) || current === "admin") && <option value="admin">{ACCESS_LEVEL_LABELS.admin}</option>}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <p style={{ color: "var(--ta-muted)", margin: "12px 0 0", fontSize: 13 }}>
                  Choose None, View or Edit for each module. View is strictly read-only; Edit allows changes within the role&apos;s own limits (for example, only Admins can accept quotations). Nothing is saved until you submit this form.
                </p>
                {customWithNoModules && (
                  <p className="ta-error" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
                    Select at least one module for Custom Module Access, or choose Role Default Access.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </fieldset>

      {state.error && <p className="ta-error" role="alert">{state.error}</p>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="ta-btn ta-btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : edit ? "Save" : "Send Invitation"}</button>
        {edit && <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Passwords are managed by Supabase Auth.</span>}
      </div>
    </form>
  );
}
