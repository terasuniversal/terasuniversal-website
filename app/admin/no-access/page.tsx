import Link from "next/link";
import { getCurrentModuleAccess, getCurrentProfile } from "../../../lib/auth/session";
import { firstAccessibleHref, NAV } from "../../../lib/admin-nav";
import { NoAccessSignOut } from "./NoAccessSignOut";

export const metadata = { title: "No access — TERAS UNIVERSAL Admin" };
// Depends on the signed-in user's own modules; never cache across users.
export const dynamic = "force-dynamic";

function labelFor(href: string): string {
  for (const group of NAV) for (const item of group.items) if (item.href === href) return item.label;
  return "your workspace";
}

/**
 * Shown when a page guard denies access. It must never be a dead end: it offers the first module the user
 * can actually open (same visibility rule as the sidebar) and a working Sign out. Navigation only; every
 * route still enforces access server-side.
 */
export default async function NoAccessPage() {
  const profile = await getCurrentProfile();
  const destination =
    profile && profile.is_active
      ? firstAccessibleHref(profile.role, [...(await getCurrentModuleAccess())], Boolean(profile.access_control_enabled))
      : null;

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: 24 }}>
      <div className="ta-card ta-card-pad" style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 40 }} aria-hidden="true">
          🔒
        </div>
        <h1 style={{ fontSize: 22, margin: "10px 0" }}>Insufficient permissions</h1>
        <p style={{ color: "var(--ta-muted)" }}>
          You don&apos;t have access to that section. If you believe this is a mistake, contact a Super Admin.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
          {destination ? (
            <Link href={destination} className="ta-btn ta-btn-primary" style={{ minHeight: 44 }}>
              Go to {labelFor(destination)}
            </Link>
          ) : (
            <p style={{ color: "var(--ta-muted)", margin: 0, fontSize: 13 }}>No modules are assigned to this account yet.</p>
          )}
          {profile ? (
            <NoAccessSignOut />
          ) : (
            <Link href="/admin/login" className="ta-btn ta-btn-outline" style={{ minHeight: 44 }}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
