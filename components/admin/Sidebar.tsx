"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "../../lib/admin-nav";
import { hasMinRole } from "../../lib/auth/rbac";
import type { UserRole } from "../../lib/supabase/database.types";

/**
 * Left navigation. Renders only the items the current role may access.
 * Counts (e.g. new enquiries) are passed in so the sidebar stays a pure,
 * cache-friendly client component.
 */
export function Sidebar({
  role,
  badges = {},
}: {
  role: UserRole;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <aside className="ta-sidebar" aria-label="Admin navigation">
      <div className="ta-sidebar-brand">
        <img src="/teras-universal-logo.png" alt="" />
        <span>
          <strong>TERAS UNIVERSAL</strong>
          Admin CMS
        </span>
      </div>
      <nav className="ta-nav">
        {NAV.map((group) => {
          const items = group.items.filter((i) => hasMinRole(role, i.minRole));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <div className="ta-nav-group-label">{group.label}</div>
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const count = badges[item.key];
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`ta-nav-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="ta-ico" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="ta-nav-label">{item.label}</span>
                    {count ? <span className="ta-badge">{count}</span> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
