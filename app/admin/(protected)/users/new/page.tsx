import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import type { StaffModuleCatalog } from "../../../../../lib/supabase/database.types";
import { NewStaffForm } from "./NewStaffForm";

export const metadata = { title: "Add Staff — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewStaffPage() {
  await requireModuleAccess("users", "admin");
  const supabase = await createSupabaseServerClient();
  const { data: catalogRows } = await supabase
    .from("staff_module_catalog")
    .select("*")
    .eq("is_active", true)
    .order("group_key");

  return (
    <>
      <PageHead
        title="Add Staff"
        subtitle="Create a new staff account with department, role, status and module access. Server-side authorization is enforced on every step."
        action={<Link href="/admin/users" className="ta-btn ta-btn-outline">← Back to Staff</Link>}
      />
      <NewStaffForm catalog={(catalogRows ?? []) as StaffModuleCatalog[]} />
    </>
  );
}
