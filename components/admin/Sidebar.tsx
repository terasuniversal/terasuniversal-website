"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`ta-sidebar${collapsed ? " is-collapsed" : ""}`} aria-label="Admin navigation">
      <div className="ta-sidebar-brand">
        <img src="/teras-universal-logo.png" alt="" />
        <span>
          <strong>TERAS UNIVERSAL</strong>
          Admin CMS
        </span>
      </div>
      <button className="ta-sidebar-toggle" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? "›" : "‹"}</button>
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
                    <span className="ta-ico" aria-hidden="true" title={collapsed ? item.label : undefined}>
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
