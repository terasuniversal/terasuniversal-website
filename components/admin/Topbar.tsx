"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Profile } from "../../lib/supabase/database.types";
import { canAccessModule } from "../../lib/auth/rbac";
import { breadcrumbsFor } from "../../lib/admin-nav";
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

// The long search hint only fits above the drawer breakpoint (admin.css, 900px); below it the
// field is narrower and the placeholder would clip. The accessible name is the aria-label, not this text.
const COMPACT_QUERY = "(max-width: 900px)";
const PLACEHOLDER_FULL = "Search courses, participants, companies, enquiries…";
const PLACEHOLDER_COMPACT = "Search…";
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const compactSnapshot = () => window.matchMedia(COMPACT_QUERY).matches;
// Server render and hydration use the full text, so there is no hydration mismatch; phones switch right after load.
const compactServerSnapshot = () => false;

/**
 * Top bar: mobile nav trigger (opens AdminShell's drawer, so it must render
 * inside its Sheet), breadcrumbs from the nav tree, global search box (Cmd-K style — posts to the
 * global_search RPC), and the signed-in user menu with sign-out.
 */
export function Topbar({ profile, moduleKeys = [], pathname }: { profile: Profile; moduleKeys?: readonly string[]; pathname: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, compactServerSnapshot);
  const initials = (profile.full_name || profile.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const crumbs = breadcrumbsFor(pathname);
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
        <Button variant="ghost" size="icon" className="ta-hamburger size-11 [&_svg]:size-6" aria-label="Open navigation">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <nav className="ta-crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={`${index}-${crumb.label}`}>
                {crumb.href && !last ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <form className="ta-search" onSubmit={onSearch} role="search">
        <span className="ta-search-ico" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={compact ? PLACEHOLDER_COMPACT : PLACEHOLDER_FULL}
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
        <Button variant="outline" size="sm" className="max-[900px]:h-11" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
