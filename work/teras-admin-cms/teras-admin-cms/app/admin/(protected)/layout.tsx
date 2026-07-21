import type { ReactNode } from "react";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { Sidebar } from "../../../components/admin/Sidebar";
import { Topbar } from "../../../components/admin/Topbar";
import { NavScrim } from "../../../components/admin/NavScrim";

/**
 * Protected admin shell. Every route in the (protected) group requires at
 * least the "editor" role — enforced here (server-side) AND by middleware.
 * Renders the persistent sidebar + topbar around each page.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const profile = await requireRole("editor");
  const supabase = await createSupabaseServerClient();

  // Sidebar badges: operational counts. Cheap head-only queries.
  const [{ count: pendingCerts }, { count: activeParticipants }] = await Promise.all([
    supabase
      .from("certificates")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("status", "registered")
      .is("deleted_at", null),
  ]);

  return (
    <div className="ta-shell">
      <NavScrim />
      <Sidebar
        role={profile.role}
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
