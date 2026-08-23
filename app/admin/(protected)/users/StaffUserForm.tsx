"use client";

import { useActionState, useState, type FormEvent } from "react";
import { DEPARTMENTS, MODULE_CATALOG } from "../../../../lib/auth/rbac";
import { inviteStaffAction, updateStaffAction, type StaffActionState } from "./actions";
import type { Profile, UserRole } from "../../../../lib/supabase/database.types";

type AccessMode = "role_default" | "custom";

type StaffFormProfile = Pick<Profile, "id" | "email" | "full_name" | "department" | "role" | "is_active" | "access_control_enabled"> & {
  moduleKeys: string[];
};

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
  const [selected, setSelected] = useState<string[]>(profile?.moduleKeys ?? []);

  function toggleModule(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
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
                <div className="ta-grid cols-2">
                  {MODULE_CATALOG.map((module) => (
                    <label key={module.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" name="module_key" value={module.key} checked={selected.includes(module.key)} onChange={() => toggleModule(module.key)} />
                      <span>{module.label}</span>
                      <small style={{ color: "var(--ta-muted)" }}>{module.group}</small>
                    </label>
                  ))}
                </div>
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
