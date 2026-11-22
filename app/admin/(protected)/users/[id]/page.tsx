import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { PageHead } from "../../../../../components/admin/ui";
import { StaffUserForm } from "../StaffUserForm";
import { resendStaffInviteAction } from "../actions";
import { staffInviteMessage } from "../../../../../lib/auth/staff-invite";

export const dynamic = "force-dynamic";

export default async function StaffDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; resent?: string; error?: string }> }) {
  await requireModuleAccess("users");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: access }] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name,department,role,is_active,access_control_enabled").eq("id", id).maybeSingle(),
    supabase.from("staff_module_access").select("module_key, access_level").eq("user_id", id),
  ]);
  if (!profile) notFound();
  const sp = await searchParams;
  const staff = profile as { id: string; email: string; full_name: string | null; department: "sales" | "marketing" | "training_operations" | "finance" | "administration" | "management" | "hr" | null; role: "super_admin" | "admin" | "editor" | "trainer"; is_active: boolean; access_control_enabled: boolean };

  return (
    <>
      <PageHead title="Staff User" subtitle={`${staff.email} · ${staff.role.replace("_", " ")}`} action={<Link href="/admin/users" className="ta-btn ta-btn-outline">Back to Staff Users</Link>} />
      {(sp.saved || sp.resent) && <p className="ta-card ta-card-pad" role="status">{sp.resent ? staffInviteMessage("resent", sp.resent) ?? "Invitation sent." : "Staff access saved."}</p>}
      {/* AUTH-1: resend failures were redirected here with ?error= but never shown. */}
      {staffInviteMessage("error", sp.error) && <div className="ta-alert ta-alert-error" role="alert">{staffInviteMessage("error", sp.error)}</div>}
      <div className="ta-card ta-card-pad">
        <StaffUserForm profile={{ ...staff, moduleAccess: (access ?? []).map((row: { module_key: string; access_level: string }) => ({ moduleKey: row.module_key, accessLevel: row.access_level })) }} />
      </div>
      <div className="ta-card ta-card-pad" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Invitation</h3>
        <p style={{ color: "var(--ta-muted)" }}>Hantar semula pautan akaun. Akaun yang belum disahkan menerima jemputan baharu; akaun yang sudah disahkan menerima e-mel untuk menetapkan kata laluan. Akaun tidak aktif tidak akan dihantar apa-apa.</p>
        <form action={resendStaffInviteAction}>
          <input type="hidden" name="user_id" value={staff.id} />
          <button className="ta-btn ta-btn-outline" type="submit">Resend Invite</button>
        </form>
      </div>
    </>
  );
}
