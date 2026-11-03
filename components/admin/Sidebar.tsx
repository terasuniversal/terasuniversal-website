"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { activeNavKey, visibleNavGroups } from "../../lib/admin-nav";
import type { UserRole } from "../../lib/supabase/database.types";
import { NavIcon } from "./icons";

// Spoken after a nav count so "Certificates 4" is not ambiguous.
const BADGE_DESCRIPTIONS: Record<string, string> = {
  certificates: "draft certificates",
  participants: "registered participants",
};

/**
 * Sidebar contents: brand, navigation and status footer. Renders only the
 * items the current role may access, grouped by department. AdminShell
 * places it in the fixed desktop column and in the mobile drawer; counts
 * and the current path come in as props so this stays a pure component.
 */
export function Sidebar({
  role,
  moduleKeys = [],
  accessControlEnabled = false,
  badges = {},
  pathname,
  onNavigate,
  brandAction,
}: {
  role: UserRole;
  moduleKeys?: readonly string[];
  accessControlEnabled?: boolean;
  badges?: Record<string, number>;
  pathname: string;
  /** Called when a nav link is chosen (the drawer closes itself). */
  onNavigate?: () => void;
  /** Extra control in the brand row, such as the drawer's close button. */
  brandAction?: ReactNode;
}) {
  const idPrefix = useId();
  const groups = visibleNavGroups(role, moduleKeys, accessControlEnabled);
  const activeKey = activeNavKey(pathname, groups.flatMap((group) => group.items));

  return (
    <>
      <div className="ta-sidebar-brand">
        <img src="/teras-universal-logo.png" alt="" />
        <span>
          <strong>TERAS UNIVERSAL</strong>
          <small>Admin CMS</small>
        </span>
        {brandAction}
      </div>
      <nav className="ta-nav" aria-label="Admin navigation">
        {groups.length === 0 && (
          <p className="m-0 px-3 py-4 text-[13px] leading-normal text-[#c7d6ea]">
            No modules are assigned to your account yet. Ask a system administrator for access.
          </p>
        )}
        {groups.map((group, index) => {
          const labelId = `${idPrefix}-group-${index}`;
          return (
            <div key={group.label} role="group" aria-labelledby={labelId}>
              <div id={labelId} className="ta-nav-group-label">{group.label}</div>
              <ul role="list" className="m-0 list-none p-0">
                {group.items.map((item) => {
                  const active = item.key === activeKey;
                  const count = badges[item.key];
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        className={`ta-nav-item${active ? " active" : ""}`}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                      >
                        <span className="ta-ico" aria-hidden="true">
                          <NavIcon name={item.icon} />
                        </span>
                        <span className="ta-nav-label">{item.label}</span>
                        {count ? (
                          <span className="ta-badge">
                            {count}
                            {BADGE_DESCRIPTIONS[item.key] && <span className="sr-only"> {BADGE_DESCRIPTIONS[item.key]}</span>}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="ta-sidebar-footer">
        <span className="ta-status-dot" aria-hidden="true" />
        <div>
          <strong>Secure workspace</strong>
          <small>Admin system online</small>
        </div>
      </div>
    </>
  );
}
