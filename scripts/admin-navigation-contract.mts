import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

// Admin navigation contract (Phase 3C): every nav entry is still listed, the
// role filter is unchanged, one item is current per route, and the shell keeps
// the class names the print stylesheets target.

const loader = `export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.(?:c|m)?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const { NAV, activeNavKey, visibleNavGroups } = await import("../lib/admin-nav.ts");
const { canAccessModule } = await import("../lib/auth/rbac.ts");

const read = (file: string) => readFile(file, "utf8");
const allItems = NAV.flatMap((group) => group.items);

// 1. No entry removed, renamed or re-pointed (snapshot of origin/main e5a8c6e).
assert.deepEqual(
  allItems.map((i) => `${i.key} ${i.href}`),
  [
    "dashboard /admin/dashboard", "reports /admin/reports", "executive /admin/executive",
    "courses /admin/courses", "trainers /admin/trainers", "schedules /admin/schedules",
    "participants /admin/participants", "companies /admin/companies", "registrations /admin/registrations", "attendance /admin/attendance",
    "assessment /admin/assessment", "assessors /admin/assessors", "legacy_import /admin/participants/legacy-import",
    "certificates /admin/certificates", "cert-templates /admin/certificates/templates",
    "sales /admin/sales", "sales_leads /admin/sales/leads", "sales_opportunities /admin/sales/opportunities",
    "sales_quotations /admin/sales/quotations", "invoices /admin/invoices", "hrdf_claims /admin/hrdf-claims",
    "sales_followups /admin/sales/follow-ups", "sales_tasks /admin/sales/tasks", "sales_reports /admin/sales/reports",
    "marketing /admin/marketing", "marketing_campaigns /admin/marketing/campaigns", "marketing_contacts /admin/marketing/contacts",
    "news /admin/news", "gallery /admin/gallery", "faq /admin/faq", "downloads /admin/downloads",
    "company /admin/company", "media /admin/media",
    "automation /admin/automation", "system /admin/system", "backups /admin/backups", "audit /admin/audit", "users /admin/users",
    "feedback /admin/feedback", "feedback_responses /admin/feedback/responses",
    "feedback_issues /admin/feedback/issues", "feedback_actions /admin/feedback/actions",
  ],
  "NAV entries must match the base list exactly",
);

// 2. visibleNavGroups applies canAccessModule item by item, the same check
//    the sidebar used inline before.
const roles = ["super_admin", "admin", "editor", "trainer"] as const;
const grantSets: string[][] = [[], ["sales", "sales_leads", "hrdf_claims"], allItems.map((i) => i.moduleKey ?? i.key)];
for (const role of roles) {
  for (const accessControl of [false, true]) {
    for (const grants of grantSets) {
      const expected = allItems.filter((i) => canAccessModule(role, i.moduleKey ?? i.key, grants, accessControl)).map((i) => i.key);
      const groups = visibleNavGroups(role, grants, accessControl);
      assert.deepEqual(groups.flatMap((g) => g.items).map((i) => i.key), expected, `${role} access=${accessControl} grants=${grants.length}`);
      assert.ok(groups.every((g) => g.items.length > 0), "empty groups are dropped");
    }
  }
}
const editorKeys = visibleNavGroups("editor", [], false).flatMap((g) => g.items).map((i) => i.key);
for (const adminOnly of ["users", "audit", "system", "backups", "automation", "assessors", "cert-templates", "registrations", "executive"]) {
  assert.ok(!editorKeys.includes(adminOnly), `editor must not see ${adminOnly}`);
}
assert.equal(visibleNavGroups("editor", [], true).length, 0, "access control with no grants shows no modules");

// 3. Exactly one current item: the deepest matching href.
const cases: [string, string | undefined][] = [
  ["/admin/sales", "sales"],
  ["/admin/sales/leads", "sales_leads"],
  ["/admin/sales/leads/0b0c-id/edit", "sales_leads"],
  ["/admin/certificates", "certificates"],
  ["/admin/certificates/123", "certificates"],
  ["/admin/certificates/templates", "cert-templates"],
  ["/admin/participants/abc", "participants"],
  ["/admin/participants/legacy-import", "legacy_import"],
  ["/admin/marketing/campaigns/new", "marketing_campaigns"],
  ["/admin/feedback", "feedback"],
  ["/admin/salesforce", undefined],
  ["/admin/search", undefined],
];
for (const [path, key] of cases) assert.equal(activeNavKey(path, allItems), key, path);
// Without access to the child item, its parent stays current.
assert.equal(activeNavKey("/admin/sales/leads", allItems.filter((i) => i.key !== "sales_leads")), "sales");

// 4. Shell wiring.
const [layout, shell, sidebar, topbar, adminCss] = await Promise.all([
  read("app/admin/(protected)/layout.tsx"),
  read("components/admin/AdminShell.tsx"),
  read("components/admin/Sidebar.tsx"),
  read("components/admin/Topbar.tsx"),
  read("app/admin/admin.css"),
]);
assert.match(layout, /requireStaff\(\)/, "layout still requires staff");
assert.match(layout, /must_change_password\) redirect\("\/admin\/account\/change-password"\)/, "first-login gate kept");
assert.match(layout, /<AdminShell/, "layout renders AdminShell");
assert.match(sidebar, /visibleNavGroups\(role, moduleKeys, accessControlEnabled\)/, "sidebar filters through visibleNavGroups");
assert.match(topbar, /canAccessModule\(profile\.role, "automation", moduleKeys, profile\.access_control_enabled\)/, "Activity centre gate kept");
for (const cls of ["ta-shell", "ta-sidebar", "ta-main", "ta-content"]) {
  assert.match(shell, new RegExp(`className="[^"]*\\b${cls}\\b`), `AdminShell keeps .${cls} for print styles`);
}
assert.match(shell, /if \(pathname !== lastPathname\) \{[^}]*setNavOpen\(false\)/, "any pathname change closes the drawer, including back/forward to the opening path");
assert.ok(!/openedOn/.test(shell), "drawer state must not be keyed to the path it was opened on");
assert.match(topbar, /className="ta-topbar"/, "Topbar keeps .ta-topbar for print styles");
assert.ok(!/nav-open/.test(shell + sidebar + topbar + adminCss), "class-toggle drawer is gone");
assert.match(adminCss, /\.ta-sidebar-desktop \{ display: none; \}/, "desktop sidebar leaves the tab order on mobile");

console.log("Admin navigation contract passed.");
