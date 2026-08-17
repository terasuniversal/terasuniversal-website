"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import { hasMinRole } from "../../lib/auth/rbac";
import type { Profile } from "../../lib/supabase/database.types";

/**
 * Top bar: mobile nav toggle, global search box (Cmd-K style — posts to the
 * global_search RPC), and the signed-in user menu with sign-out.
 */
export function Topbar({
  profile,
  modules,
}: {
  profile: Profile;
  /** Same module-key list passed to Sidebar — see its `hasModule` for the fallback rule. */
  modules?: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const hasAutomation =
    profile.role === "super_admin" ||
    (hasMinRole(profile.role, "admin") && (!modules || modules.includes("automation")));
  const initials = (profile.full_name || profile.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function toggleNav() {
    document.querySelector(".teras-admin")?.classList.toggle("nav-open");
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`);
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <header className="ta-topbar">
      <button className="ta-hamburger" onClick={toggleNav} aria-label="Toggle navigation">
        ☰
      </button>
      <form className="ta-search" onSubmit={onSearch} role="search">
        <span className="ta-search-ico" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search courses, participants, companies, enquiries…"
          aria-label="Global search"
        />
      </form>
      <div className="ta-topbar-spacer" />
      {hasAutomation && (
        <a className="ta-topbar-link" href="/admin/automation">
          Activity centre
        </a>
      )}
      <a className="ta-topbar-link" href="/admin/account/change-password">
        Change Password
      </a>
      <div className="ta-user">
        <div className="ta-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="ta-user-meta">
          <strong>{profile.full_name || profile.email}</strong>
          <small>{profile.role.replace("_", " ")}</small>
        </div>
        <button className="ta-btn ta-btn-outline ta-btn-sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
