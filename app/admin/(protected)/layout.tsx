import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireStaff } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { Sidebar } from "../../../components/admin/Sidebar";
import { Topbar } from "../../../components/admin/Topbar";
import { NavScrim } from "../../../components/admin/NavScrim";

/**
 * Protected admin shell. Every route in the (protected) group requires at
 * least the "editor" role — enforced here (server-side) AND by middleware.
 * Renders the persistent sidebar + topbar around each page.
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
  const supabase = await createSupabaseServerClient();

  // Sidebar badges: operational counts. Cheap head-only queries.
  const [{ count: pendingCerts }, { count: activeParticipants }, { data: moduleAccess }] = await Promise.all([
    supabase
      .from("certificates")
      .select("*", { count: "exact", head: true })
      .eq("status", "draft")
      .is("deleted_at", null),
    supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("status", "registered")
      .is("deleted_at", null),
    supabase.rpc("get_my_module_access"),
  ]);
  const modules = Array.isArray(moduleAccess)
    ? moduleAccess.map((m: { module_key: string }) => m.module_key)
    : undefined;

  return (
    <div className="ta-shell">
      <NavScrim />
      <Sidebar
        role={profile.role}
        modules={modules}
        badges={{
          certificates: pendingCerts ?? 0,
          participants: activeParticipants ?? 0,
        }}
      />
      <div className="ta-main">
        <Topbar profile={profile} />
        <main className="ta-content">{children}</main>
      </div>
    </div>
  );
}
