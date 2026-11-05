import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

// Premium V2 Phase A contract: the shell redesign stays display-only, admin
// scoped and accessible. Static checks; the rendered result is covered by the
// responsive/accessibility QA recorded in the PR.

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

const { NAV, breadcrumbsFor } = await import("../lib/admin-nav.ts");

const read = (file: string) => readFile(file, "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const [adminCss, tailwindCss, globalsCss, adminLayout, rootLayout, shell, sidebar, topbar] = await Promise.all([
  read("app/admin/admin.css"),
  read("app/admin/admin-tailwind.css"),
  read("app/globals.css"),
  read("app/admin/layout.tsx"),
  read("app/layout.js"),
  read("components/admin/AdminShell.tsx"),
  read("components/admin/Sidebar.tsx"),
  read("components/admin/Topbar.tsx"),
]);
const css = strip(adminCss);

// 0. Saved shell preferences: cookies read by the server layout (no flash, one shared state for
// desktop sidebar and drawer), tolerant parsing, scoped to /admin, never used for access.
const { COLLAPSED_COOKIE, RAIL_COOKIE, collapsedCookie, parseCollapsed, parseRail, railCookie } = await import("../lib/admin-shell-prefs.ts");
assert.equal(parseRail("1"), true);
assert.equal(parseRail("0"), false);
assert.equal(parseRail(undefined), false);
assert.deepEqual(parseCollapsed(undefined), []);
assert.deepEqual(parseCollapsed(encodeURIComponent(JSON.stringify(["Sales", "x".repeat(5000)]))), [], "oversized cookie is refused before parsing");
assert.deepEqual(parseCollapsed("not-json"), [], "malformed cookie means nothing collapsed");
assert.deepEqual(parseCollapsed("%7B%22a%22%3A1%7D"), [], "non-array cookie is ignored");
assert.deepEqual(parseCollapsed(encodeURIComponent(JSON.stringify(["Sales", 7, null, "x".repeat(200)]))), ["Sales"], "only short strings survive");
assert.deepEqual(parseCollapsed(collapsedCookie(["Sales", "Marketing"]).split(";")[0].slice(COLLAPSED_COOKIE.length + 1)), ["Sales", "Marketing"], "round trip");
for (const c of [railCookie(true), collapsedCookie(["Sales"])]) assert.match(c, /; path=\/admin; max-age=\d+; samesite=lax$/, "cookies are scoped to /admin");
assert.ok(railCookie(true).startsWith(`${RAIL_COOKIE}=1`));
const protectedLayout = await read("app/admin/(protected)/layout.tsx");
assert.match(protectedLayout, /parseRail\(jar\.get\(RAIL_COOKIE\)\?\.value\)/, "server layout reads the rail cookie");
assert.match(protectedLayout, /initialCollapsed=\{initialCollapsed\}/, "server layout passes saved groups to the shell");
assert.match(shell, /useState\(initialRail\)/, "shell starts from the saved rail state");
assert.match(shell, /onToggleGroup: toggleGroup/, "desktop sidebar and drawer share one group state");
assert.ok(!/localStorage/.test(shell + (await read("components/admin/Sidebar.tsx"))), "shell state no longer lives in localStorage");

// 1. Breadcrumbs come from NAV only and never invent a route.
const labels = (path: string) => breadcrumbsFor(path).map((c) => c.label);
assert.deepEqual(labels("/admin/dashboard"), ["Overview", "Dashboard"]);
assert.deepEqual(labels("/admin/sales/leads"), ["Sales", "Leads"]);
assert.deepEqual(labels("/admin/sales/leads/new"), ["Sales", "Leads", "New"]);
assert.deepEqual(labels("/admin/sales/leads/3f2a1b4c-1111-2222-3333-444455556666"), ["Sales", "Leads", "Details"]);
assert.deepEqual(labels("/admin/participants/12/edit"), ["Training Operations", "Participants", "Details", "Edit"]);
assert.deepEqual(labels("/admin/unknown-area"), ["Unknown area"]);
assert.deepEqual(labels("/admin"), ["Admin"]);
assert.deepEqual(labels("/admin/sales/%E0%A4%A"), ["Sales", "Sales Dashboard", "%E0%A4%A"], "malformed escapes render instead of throwing");
const navHrefs = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));
for (const path of ["/admin/sales/leads/new", "/admin/marketing/campaigns/abc", "/admin/invoices/12"]) {
  for (const crumb of breadcrumbsFor(path)) if (crumb.href) assert.ok(navHrefs.has(crumb.href), `${crumb.href} must be a NAV route`);
}
assert.equal(breadcrumbsFor("/admin/sales/leads").at(-1)?.href, undefined, "current page is not a link");
assert.match(topbar, /<nav className="ta-crumbs" aria-label="Breadcrumb">/, "Topbar renders a labelled breadcrumb landmark");
assert.match(topbar, /aria-current=\{last \? "page" : undefined\}/, "last crumb is aria-current");

// 2. Access filtering is untouched; collapsing a group only hides via the hidden attribute.
assert.match(sidebar, /visibleNavGroups\(role, moduleKeys, accessControlEnabled\)/, "sidebar still filters through visibleNavGroups");
assert.match(sidebar, /group\.items\.map\(\(item\)/, "every visible item is still rendered");
assert.match(sidebar, /hidden=\{!open\}/, "collapse uses the hidden attribute, not removal");
assert.match(sidebar, /aria-expanded=\{open\}/, "group toggle exposes aria-expanded");
assert.match(sidebar, /aria-controls=\{listId\}/, "group toggle names the list it controls");
assert.match(sidebar, /const open = rail \|\| !collapsed\.has\(group\.label\)/, "rail never hides a group");
assert.ok(!/(?:role|canAccessModule|moduleKeys)[^\n]*localStorage|localStorage[^\n]*(?:role|moduleKeys)/.test(sidebar), "stored UI state never feeds access decisions");

// 3. Drawer behaviour stays on the Radix Sheet; the rail is desktop-only.
assert.match(shell, /<Sheet open=\{navOpen\} onOpenChange=\{setNavOpen\}>/, "drawer still uses the Sheet (focus trap, Escape, focus return)");
assert.match(shell, /<Sidebar \{\.\.\.sidebarProps\} rail=\{rail\} onToggleRail=\{toggleRail\} \/>/, "desktop sidebar gets the rail");
const drawer = shell.slice(shell.indexOf("<SheetContent"), shell.indexOf("</SheetContent>"));
assert.ok(!/rail/.test(drawer), "the mobile drawer never renders the rail");
assert.match(shell, /aria-label="Close navigation"/, "drawer keeps its Close button");
assert.match(shell, /className="ta-skip-link"/, "skip link kept");
assert.match(css, /\.ta-sidebar-drawer \.ta-nav-item \{ min-height: 44px; \}/, "drawer rows meet the 44px touch target");
// Phone overflow guard (staging iPhone QA): the topbar search must be able to shrink, the sheet must be pinned to
// the column width, and nothing inside the column may widen or sideways-pan the page.
assert.match(css, /\.ta-search \{ flex: 1; min-width: 0;/, "search box can shrink");
assert.match(css, /\.ta-search input \{[^}]*min-width: 0;[^}]*appearance: none;/, "search input has no intrinsic width");
assert.match(css, /@media \(max-width: 900px\) \{ \.ta-content \{ margin: 0; width: 100%;/, "sheet is pinned to the column width on phones");
assert.match(css, /\.ta-main \{ margin-left: 0; max-width: 100%; overflow-x: clip; \}/, "column clips horizontal overflow on phones");
assert.match(css, /\.ta-search input \{ height: 44px; font-size: 16px; \}/, "phone search text is 16px so iOS does not zoom on focus");
assert.match(css, /\.ta-user \{[^}]*flex: none;/, "signed-in controls never shrink");

// 4. Rail keeps accessible names: labels are clipped visually, never display:none.
const railLabel = css.match(/\.ta-rail \.ta-sidebar-brand span,\s*\.ta-rail \.ta-nav-label,[^{]*\{([^}]*)\}/);
assert.ok(railLabel, "rail label rule exists");
assert.match(railLabel[1], /clip: rect\(0 0 0 0\)/, "rail labels are visually hidden");
assert.ok(!/display:\s*none/.test(railLabel[1]), "rail labels must stay in the accessibility tree");
assert.match(sidebar, /title=\{rail \? item\.label : undefined\}/, "rail icons carry a tooltip");

// 5. Motion: transitions only when the user has not asked for reduced motion.
assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.ta-nav-item, \.ta-nav-group-chev, \.ta-rail-toggle \{ transition:/, "shell transitions are gated on no-preference");

// 6. Premium V2 tokens, Inter body, Montserrat headings, no Poppins in admin.
for (const token of ["--ta-ink: #0F1B2D", "--ta-bg: #F3F5F8", "--ta-line: #E6EAF0", "--ta-active: #E6EAF0", "--ta-navy: #0B3A63", "--ta-gold: #D4AF37", "--ta-sidebar-w: 232px"]) {
  assert.ok(css.includes(token), `admin.css defines ${token}`);
}
assert.match(css, /font-family: var\(--font-inter\)/, "admin body font is Inter");
assert.match(css, /\.teras-admin h3 \{\s*font-family: var\(--font-montserrat\)/, "admin headings stay Montserrat");
assert.ok(!/poppins/i.test(css + tailwindCss), "admin styles no longer use Poppins");
assert.ok(!/gradient/.test(css.slice(css.indexOf("/* --- Layout shell"), css.indexOf(".ta-page-head"))), "shell has no gradients");

// 7. Public site isolation: Inter lives only in the admin layout; shell rules never touch global selectors.
assert.match(adminLayout, /Inter\(\{[^}]*variable: "--font-inter"/, "admin layout loads Inter");
assert.match(adminLayout, /className=\{`teras-admin \$\{inter\.variable\}`\}/, "the Inter variable is scoped to .teras-admin");
assert.ok(!/Inter/.test(rootLayout), "root layout (public site) must not load Inter");
assert.ok(!/--ta-|\.ta-|font-inter/.test(globalsCss), "globals.css carries no admin tokens, shell classes or the admin font");
for (const line of css.split("\n")) {
  assert.ok(!/^\s*(?:html|body|:root|\*)\s*[{,]/.test(line), `admin.css must not style global selectors: ${line.trim()}`);
}

// 8. The emblem is the official, unmodified logo-pack file (SHA-256 recorded in the design baseline).
const emblem = createHash("sha256").update(await readFile("public/brand/teras-emblem-256.png")).digest("hex");
assert.equal(emblem, "7e69fe190c8443ba19ca37c5bb69458e686256507919e98c329eb4769d56799b", "emblem matches the official logo pack");
assert.match(sidebar, /src="\/brand\/teras-emblem-256\.png"/, "sidebar uses the official emblem");

console.log("Admin premium shell contract passed.");
