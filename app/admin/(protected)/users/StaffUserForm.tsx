"use client";

import { useActionState, useState } from "react";
import { DEPARTMENTS, MODULE_CATALOG, SALES_PRESET } from "../../../../lib/auth/rbac";
import { inviteStaffAction, updateStaffAction, type StaffActionState } from "./actions";
import type { Profile, UserRole } from "../../../../lib/supabase/database.types";

type StaffFormProfile = Pick<Profile, "id" | "email" | "full_name" | "department" | "role" | "is_active"> & {
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
  const [selected, setSelected] = useState<string[]>(profile?.moduleKeys ?? [...SALES_PRESET]);

  function onDepartmentChange(value: string) {
    setDepartment(value as typeof department);
    if (value === "sales") setSelected([...SALES_PRESET]);
  }

  function toggleModule(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  return (
    <form action={formAction} className="ta-form">
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
          <select id="department" name="department" value={department} onChange={(event) => onDepartmentChange(event.target.value)} required>
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
        {role === "super_admin" ? (
          <p style={{ color: "var(--ta-muted)", margin: 0 }}>Super Admin is unrestricted and does not require permission rows.</p>
        ) : (
          <div className="ta-grid cols-2">
            {MODULE_CATALOG.map((module) => (
              <label key={module.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" name="module_key" value={module.key} checked={selected.includes(module.key)} onChange={() => toggleModule(module.key)} />
                <span>{module.label}</span>
                <small style={{ color: "var(--ta-muted)" }}>{module.group}</small>
              </label>
            ))}
          </div>
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
