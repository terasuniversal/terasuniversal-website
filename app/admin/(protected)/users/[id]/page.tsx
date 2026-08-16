import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge } from "../../../../../components/admin/ui";
import type { Profile, StaffModuleCatalog, StaffModuleAccess, ModuleAccessLevel, StaffDepartment } from "../../../../../lib/supabase/database.types";
import { StaffUserForm } from "./StaffUserForm";

export const metadata = { title: "Edit Staff User — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function StaffUserEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess("users");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, department, role, is_active, access_control_enabled, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!profile) notFound();

  const { data: catalogRows } = await supabase.from("staff_module_catalog").select("*").eq("is_active", true).order("group_key");
  const { data: accessRows } = await supabase.from("staff_module_access").select("*").eq("user_id", id);

  const existingAccess: Record<string, ModuleAccessLevel> = {};
  for (const row of (accessRows ?? []) as Pick<StaffModuleAccess, "module_key" | "access_level">[]) {
    existingAccess[row.module_key] = row.access_level;
  }

  return (
    <>
      <PageHead
        title={profile.full_name || profile.email}
        subtitle={`${profile.email} · ${profile.role} · ${profile.is_active ? "Active" : "Inactive"}`}
        action={<Link href="/admin/users" className="ta-btn ta-btn-outline">← Back to Staff</Link>}
      />
      <StaffUserForm
        profile={profile as unknown as Profile}
        catalog={(catalogRows ?? []) as StaffModuleCatalog[]}
        existingAccess={existingAccess}
        departments={["management", "sales", "marketing", "training_operations", "administration", "finance", "hr"] as StaffDepartment[]}
      />
    </>
  );
}
