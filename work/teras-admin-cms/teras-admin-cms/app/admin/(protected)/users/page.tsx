import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Users & Roles — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("super_admin");
  return (
    <ScaffoldPage
      title="Users & Roles"
      subtitle="Manage staff accounts (Super Admin only)."
      table="profiles"
      bullets={[
            "Create / edit / deactivate users",
            "Assign roles (super_admin, admin, editor, …)",
            "Granular per-user permission overrides",      ]}
    />
  );
}
