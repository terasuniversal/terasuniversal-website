import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Guards the rule that Tailwind/shadcn styling reaches /admin only.
// Static checks only: the byte-for-byte public CSS comparison against the
// base commit still needs a real `next build` (see the PR test plan).
const root = process.cwd();
const read = (file: string) => readFile(path.join(root, file), "utf8");
// Generated output, dependencies and scratch areas; `work/` is a dead
// snapshot per CLAUDE.md §2a and is never imported by the app.
const ignored = new Set(["node_modules", ".next", ".git", "work", "tmp", "output", "artifacts"]);

async function repoFiles(directory = "", out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const rel = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await repoFiles(rel, out);
    } else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const files = await repoFiles();
const code = files.filter((f) => !f.endsWith(".css"));
const css = files.filter((f) => f.endsWith(".css"));

// Matches JS/TS imports and CSS @import of the admin entry, not comments.
const importers: string[] = [];
for (const file of files) {
  if (/(?:^|\n)\s*(?:@?import)\s+(?:url\()?["'][^"']*admin-tailwind\.css["']/.test(await read(file))) importers.push(file);
}
assert.deepEqual(importers, ["app/admin/layout.tsx"], "admin-tailwind.css must be imported only by the admin root layout");

const adminCss = await read("app/admin/admin-tailwind.css");
assert.ok(!/@import\s+["']tailwindcss["']/.test(adminCss), "must not import the full tailwindcss bundle (includes preflight)");
assert.ok(!/tailwindcss\/preflight/.test(adminCss), "preflight must stay out of the admin entry");
assert.match(adminCss, /tailwindcss\/utilities"\s+layer\(utilities\)\s+source\(none\)/, "utilities must disable automatic source scanning");
assert.match(adminCss, /@layer theme, base, utilities;/, "layer order must keep utilities above the base reset");

for (const file of css.filter((f) => f !== "app/admin/admin-tailwind.css")) {
  const rules = (await read(file)).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/@(?:import\s+["']tailwindcss|tailwind\b|theme\b|source\b|utility\b|plugin\b)/.test(rules), `${file} must not contain Tailwind directives`);
}

// Nothing outside the admin surface may import the shadcn primitives.
const adminSurface = /^(?:app\/admin\/|components\/admin\/|components\/ui\/|lib\/|scripts\/)/;
for (const file of code) {
  if (adminSurface.test(file)) continue;
  assert.ok(!/from\s+["'][^"']*components\/ui\//.test(await read(file)), `${file} is outside admin and must not import components/ui`);
}

// postcss.config.mjs must keep Next's default plugins, via public packages.
const postcss = await read("postcss.config.mjs");
assert.ok(!postcss.includes("next/dist"), "postcss.config.mjs must not depend on Next internals");
for (const plugin of ["@tailwindcss/postcss", "postcss-flexbugs-fixes", "postcss-preset-env"]) {
  assert.ok(postcss.includes(`"${plugin}"`), `postcss.config.mjs must list ${plugin}`);
}

// The CSS browser list lives in the PostCSS config, not package.json, so
// Next keeps choosing its own JavaScript targets. Reading Next's constant
// here (test only) flags drift after a Next upgrade.
const pkg = JSON.parse(await read("package.json"));
assert.equal(pkg.browserslist, undefined, "package.json must not set browserslist; it would also pin Next's JS targets");
const { default: postcssConfig } = await import(pathToFileURL(path.join(root, "postcss.config.mjs")).href);
const presetEnv = postcssConfig.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "postcss-preset-env");
const { MODERN_BROWSERSLIST_TARGET } = createRequire(import.meta.url)("next/dist/shared/lib/constants.js");
assert.deepEqual(presetEnv?.[1]?.browsers, MODERN_BROWSERSLIST_TARGET, "preset-env browsers must match Next's default target");

const uiFiles = (await readdir(path.join(root, "components/ui"))).filter((f) => f.endsWith(".tsx"));
for (const file of uiFiles) {
  assert.match(await read(`components/ui/${file}`), /data-slot=/, `components/ui/${file} must set data-slot for scoped focus/border rules`);
}

console.log(`admin shadcn foundation contract: ok (${uiFiles.length} primitives, ${files.length} files scanned)`);
