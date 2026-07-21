"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Profile } from "../../lib/supabase/database.types";

/**
 * Top bar: mobile nav toggle, global search box (Cmd-K style — posts to the
 * global_search RPC), and the signed-in user menu with sign-out.
 */
export function Topbar({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [q, setQ] = useState("");
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
          placeholder="Search courses, enquiries, media…"
          aria-label="Global search"
        />
      </form>
      <div className="ta-topbar-spacer" />
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
