import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentModuleAccess, hasModuleAccess, requireStaff } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { AdminShell } from "../../../components/admin/AdminShell";
import { COLLAPSED_COOKIE, RAIL_COOKIE, parseCollapsed, parseRail } from "../../../lib/admin-shell-prefs";

/**
 * Protected admin shell. Every route in the (protected) group requires at
 * least the "editor" role — enforced here (server-side) AND by middleware.
 * Renders the sidebar, mobile drawer and topbar (AdminShell) around each page.
 *
 * First-login gate: a staff member who has not changed their temporary
 * password yet is forced to /admin/account/change-password and cannot reach
 * ANY protected module (including direct URLs to /admin/sales etc.) until the
 * password is changed. The change-password page lives outside this group so
 * it stays reachable.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const profile = await requireStaff();
  if (profile.must_change_password) redirect("/admin/account/change-password");
  const moduleKeys = await getCurrentModuleAccess();
  const supabase = await createSupabaseServerClient();
  // Display-only shell preferences, rendered on the first paint (no flash).
  const jar = await cookies();
  const initialRail = parseRail(jar.get(RAIL_COOKIE)?.value);
  const initialCollapsed = parseCollapsed(jar.get(COLLAPSED_COOKIE)?.value);

  const [canSeeCertificates, canSeeParticipants] = await Promise.all([
    hasModuleAccess("certificates"),
    hasModuleAccess("participants"),
  ]);

  // Sidebar badges: operational counts. Cheap head-only queries.
  const [{ count: pendingCerts }, { count: activeParticipants }] = await Promise.all([
    canSeeCertificates ? supabase
      .from("certificates")
      .select("*", { count: "exact", head: true })
      .eq("status", "draft")
      .is("deleted_at", null) : Promise.resolve({ count: null }),
    canSeeParticipants ? supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("status", "registered")
      .is("deleted_at", null) : Promise.resolve({ count: null }),
  ]);

  return (
    <AdminShell
      profile={profile}
      moduleKeys={[...moduleKeys]}
      initialRail={initialRail}
      initialCollapsed={initialCollapsed}
      badges={{
        ...(canSeeCertificates ? { certificates: pendingCerts ?? 0 } : {}),
        ...(canSeeParticipants ? { participants: activeParticipants ?? 0 } : {}),
      }}
    >
      {children}
    </AdminShell>
  );
}
