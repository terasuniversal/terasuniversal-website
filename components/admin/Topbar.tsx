"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Profile } from "../../lib/supabase/database.types";
import { canAccessModule } from "../../lib/auth/rbac";
import { Button } from "../ui/button";
import { SheetTrigger } from "../ui/sheet";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

/**
 * Top bar: mobile nav trigger (opens AdminShell's drawer, so it must render
 * inside its Sheet), global search box (Cmd-K style — posts to the
 * global_search RPC), and the signed-in user menu with sign-out.
 */
export function Topbar({ profile, moduleKeys = [], pathname }: { profile: Profile; moduleKeys?: readonly string[]; pathname: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const initials = (profile.full_name || profile.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const onAutomation = pathname === "/admin/automation" || pathname.startsWith("/admin/automation/");

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`);
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/admin/login");
      router.refresh();
    } catch (error) {
      setSigningOut(false);
      throw error;
    }
  }

  return (
    <header className="ta-topbar">
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="ta-hamburger [&_svg]:size-6" aria-label="Open navigation">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <form className="ta-search" onSubmit={onSearch} role="search">
        <span className="ta-search-ico" aria-hidden="true">
          <SearchIcon />
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
      {canAccessModule(profile.role, "automation", moduleKeys, profile.access_control_enabled) && (
        <Link className="ta-topbar-link" href="/admin/automation" aria-current={onAutomation ? "page" : undefined}>
          Activity centre
        </Link>
      )}
      <div className="ta-user">
        <div className="ta-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="ta-user-meta">
          <strong>{profile.full_name || profile.email}</strong>
          <small>{profile.role.replace("_", " ")}</small>
        </div>
        <Button variant="outline" size="sm" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
