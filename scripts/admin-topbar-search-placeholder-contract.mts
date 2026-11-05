import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// B4 contract: the topbar search keeps its accessible name, role, type and behaviour, shows the full hint on
// wide screens and "Search…" at the drawer breakpoint (<=900px), and cannot cause a hydration mismatch.
// Static source checks; the rendered result is covered by the responsive QA recorded in the PR.

const [topbar, css] = await Promise.all([read("components/admin/Topbar.tsx"), read("app/admin/admin.css")]);
function read(file: string) {
  return readFile(file, "utf8");
}

// 1. Accessibility and semantics are unchanged.
assert.match(topbar, /<form className="ta-search" onSubmit=\{onSearch\} role="search">/, "search form keeps role=search");
assert.match(topbar, /type="search"/, "input keeps type=search");
assert.match(topbar, /aria-label="Global search"/, "full accessible name is unchanged");
assert.ok(!/aria-label=\{/.test(topbar.split('type="search"')[1]?.split("/>")[0] ?? ""), "the accessible name is a fixed string, not tied to the placeholder");

// 2. Behaviour is unchanged.
assert.match(topbar, /if \(q\.trim\(\)\) router\.push\(`\/admin\/search\?q=\$\{encodeURIComponent\(q\.trim\(\)\)\}`\);/, "search still routes to /admin/search with the trimmed, encoded query");

// 3. Wording: full hint above 900px, "Search…" at or below it.
assert.match(topbar, /const PLACEHOLDER_FULL = "Search courses, participants, companies, enquiries…";/, "full placeholder is kept for wide screens");
assert.match(topbar, /const PLACEHOLDER_COMPACT = "Search…";/, "compact placeholder wording");
assert.match(topbar, /placeholder=\{compact \? PLACEHOLDER_COMPACT : PLACEHOLDER_FULL\}/, "placeholder switches on the compact flag");

// 4. The breakpoint matches the drawer breakpoint in admin.css (where the hamburger appears).
assert.match(topbar, /const COMPACT_QUERY = "\(max-width: 900px\)";/, "compact query is 900px and below");
assert.match(css.replace(/\r\n/g, "\n"), /@media \(max-width: 900px\) \{[^@]*\.ta-hamburger \{ display: inline-flex; \}/, "the drawer breakpoint in admin.css is the same 900px");

// 5. No hydration mismatch: external-store subscription with a server snapshot that renders the full text.
assert.match(topbar, /useSyncExternalStore\(subscribeCompact, compactSnapshot, compactServerSnapshot\)/, "media query is read with useSyncExternalStore");
assert.match(topbar, /const compactServerSnapshot = \(\) => false;/, "server and hydration render the full text");
assert.ok(!/useEffect/.test(topbar), "no effect-based placeholder swap");

console.log("Admin topbar search placeholder contract passed.");
