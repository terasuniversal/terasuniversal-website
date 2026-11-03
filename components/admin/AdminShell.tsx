"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Profile } from "../../lib/supabase/database.types";
import { Button } from "../ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "../ui/sheet";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

// admin.css swaps the fixed sidebar for the drawer at max-width: 900px.
const DESKTOP_QUERY = "(min-width: 901px)";

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Client frame for the protected admin: fixed sidebar on desktop, a modal
 * drawer below 900px, and the topbar that opens it. Data and access checks
 * stay in the server layout; this only owns the drawer state.
 */
export function AdminShell({
  profile,
  moduleKeys,
  badges,
  children,
}: {
  profile: Profile;
  moduleKeys: readonly string[];
  badges: Record<string, number>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  // Any route change (a link, back/forward, a redirect) closes the drawer.
  // Adjusted during render, as React recommends for state derived from a
  // changed value, so there is no flash of an open drawer on the new page.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setNavOpen(false);
  }

  // Close if the window widens past the breakpoint while the drawer is open.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) setNavOpen(false); };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const sidebarProps = {
    role: profile.role,
    moduleKeys,
    accessControlEnabled: profile.access_control_enabled,
    badges,
    pathname,
  };

  return (
    <Sheet open={navOpen} onOpenChange={setNavOpen}>
      <div className="ta-shell">
        <a href="#admin-main" className="ta-skip-link">Skip to main content</a>
        <div className="ta-sidebar ta-sidebar-desktop">
          <Sidebar {...sidebarProps} />
        </div>
        <SheetContent className="ta-sidebar ta-sidebar-drawer" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <Sidebar
            {...sidebarProps}
            onNavigate={() => setNavOpen(false)}
            brandAction={
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="ml-auto text-white hover:bg-white/10 [&_svg]:size-5" aria-label="Close navigation">
                  <CloseIcon />
                </Button>
              </SheetClose>
            }
          />
        </SheetContent>
        <div className="ta-main">
          <Topbar profile={profile} moduleKeys={moduleKeys} pathname={pathname} />
          <main id="admin-main" tabIndex={-1} className="ta-content">{children}</main>
        </div>
      </div>
    </Sheet>
  );
}
