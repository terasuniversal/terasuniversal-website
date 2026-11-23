/**
 * W4-a remediation contract (owner-approved W4-a-G1, local only). Proves the three named edits do exactly what was
 * approved, and that reverting them restores the files byte for byte to HEAD at the time of approval (5b8a77ad).
 * Run: node --experimental-strip-types scripts/w4a-remediation-contract.mts
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { revertW4a, W4A_CHANGED } from "./w4a-approved.mts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) of each changed file at the approved base, before W4-a.
const BEFORE: Record<string, string> = {
  "components/premium/header.module.css": "a92ea861098e795654332a0702dc51b04048f7f21a09017b3f1f91d2f2362a98",
  "app/globals.css": "8c5f36435a7576bb1a5b58cf9d79b0d6b8368fdcc382c55f54a6398f75cc26d6",
  "app/layout.js": "e07b0076456a28e32b0fbd9894779f34b1b7f190356a49a5b612e9c6ee4eb797",
};

check("only the three approved files carry W4-a edits", () => {
  assert(JSON.stringify(W4A_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W4A_CHANGED.join(", "));
});
check("reverting the named edits restores each file exactly (nothing else changed)", () => {
  for (const [path, hash] of Object.entries(BEFORE)) assert(sha256(revertW4a(path, read(path))) === hash, path);
});

const header = read("components/premium/header.module.css").replace(/\r\n/g, "\n");
check("NE-1: one max-width 359px block, after the 590px block, only spacing and padding", () => {
  const block = header.match(/@media \(max-width: 359px\) \{([\s\S]*?)\n\}/);
  assert(block, "359px block missing");
  assert(header.indexOf("@media (max-width: 359px)") > header.indexOf("@media (max-width: 590px)"), "order");
  const decls = [...block![1].matchAll(/\{([^}]*)\}/g)].flatMap((m) => m[1].split(";").map((d) => d.trim().split(":")[0]).filter(Boolean));
  for (const prop of decls) assert(["gap", "padding-inline", "padding", "flex"].includes(prop), `unexpected property ${prop}`);
  assert(!/height|font-size|display/.test(block![1]), "no height, font-size or display change (44px targets, 54px logo)");
});
check("NE-1: the 54px mobile logo and the 44px menu button are unchanged", () => {
  assert(/@media \(max-width: 820px\) \{[\s\S]*?\.logo img \{ height: 54px; \}/.test(header), "54px logo");
  assert(/\.hdr :global\(\.menu-button\) \{ width: 44px; height: 44px;/.test(header), "44px menu button");
});

const css = read("app/globals.css").replace(/\r\n/g, "\n");
check("NE-2: Read article / Read summary target 44px, 14px text, navy arrow", () => {
  assert(/\.insight-card a \{ display: inline-flex; align-items: center; gap: 5px; min-height: 44px; font-size: 14px; \}/.test(css), "link rule");
  assert(/\.insight-card a span \{ color: var\(--navy\); \}/.test(css), "navy arrow");
});
check("NE-3: the skip link moves focus to the page <main> and draws no ring around it", () => {
  const layout = read("app/layout.js");
  assert(/import SkipLink from "\.\.\/components\/SkipLink";/.test(layout) && /<SkipLink \/>/.test(layout), "layout uses SkipLink");
  assert(!/href="#main-content" className="skip-link"/.test(layout), "old inline anchor removed");
  assert(/<div id="main-content">\{children\}<\/div>/.test(layout), "#main-content wrapper unchanged");
  const skip = read("components/SkipLink.js");
  assert(/^"use client";/.test(skip), "client component");
  assert(/href="#main-content" className="skip-link"/.test(skip) && />\s*Skip to main content\s*</.test(skip), "same href, class and text (works without JS)");
  assert(/document\.querySelector\("#main-content main"\)/.test(skip) && /setAttribute\("tabindex", "-1"\)/.test(skip) && /main\.focus\(\)/.test(skip), "focuses the page main");
  assert(/#main-content main\[tabindex="-1"\]:focus \{ outline: none; \}/.test(css), "no ring on the main landmark");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
