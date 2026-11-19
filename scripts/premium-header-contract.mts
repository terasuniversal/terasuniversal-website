import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Contract for the shared public header logo (Phase S2C). Static checks of repository files only.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// SHA-256 of the originals in TERAS_UNIVERSAL_COMPLETE_LOGO_PACK (02_VECTOR/TERAS_UNIVERSAL_White.svg and
// 01_PNG/TERAS_UNIVERSAL_Full_Color_Transparent_Original.png), recorded on 7 Nov 2026. The website copies must stay identical.
// The full-colour file is not used by the header since S2D; it is kept, unmodified, for later light-background public pages.
const OFFICIAL = {
  "public/brand/teras-universal-logo-white.svg": "3de869b7f28b863e751bf54f6f9062df2cf0ad44d443dfaf264d485c42f9de5a",
  "public/brand/teras-universal-logo-full-color.png": "7c6fe8170d785f586f6ab61132e140ab4d77da36f47cd1a1a2e273c504cddf5c",
};

check("logo files are byte-identical to the official logo pack", () => {
  for (const [path, hash] of Object.entries(OFFICIAL)) assert.equal(sha256(path), hash, path);
});
check("white SVG is a plain vector (no script, no external reference, no embedded raster)", () => {
  const svg = read("public/brand/teras-universal-logo-white.svg");
  assert.match(svg, /viewBox="0 0 1184 847"/);
  assert.ok(!/<script|on\w+=|href="http|<image|data:image/i.test(svg));
});

const header = read("components/premium/PremiumHeader.js");
check("header uses the official white SVG at its intrinsic 1184 x 847 size", () => {
  assert.match(header, /\/brand\/teras-universal-logo-white\.svg/);
  assert.match(header, /width=\{1184\} height=\{847\}/);
  assert.ok(!header.includes("/teras-universal-logo.png"), "the old chip logo is no longer used by the header");
});
check("owner-approved Option A only: no variant switch, no full-colour logo, no light header", () => {
  assert.ok(!/variant|full-color|hdr\.light|LOGOS/.test(header));
});
check("the SVG is served as is (unoptimized), so no resized raster can change its ratio", () => {
  assert.match(header, /<Image src=\{LOGO_SRC\}[^>]*\bunoptimized\b/);
});
check("logo link has an accessible name and the image keeps alt text", () => {
  assert.match(header, /aria-label="TERAS UNIVERSAL home"/);
  assert.match(header, /alt="TERAS UNIVERSAL"/);
});

const css = read("components/premium/header.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
const logoImgRules = [...css.matchAll(/\.logo img \{([^}]*)\}/g)].map((m) => m[1]);
check("logo is never cropped or stretched: object-fit contain, width auto, no fixed width", () => {
  assert.ok(logoImgRules.length >= 1);
  assert.match(logoImgRules[0], /object-fit: contain/);
  assert.match(logoImgRules[0], /width: auto/);
  for (const rule of logoImgRules) assert.ok(!/(^|[\s;])width:\s*\d/.test(rule), `fixed width in "${rule.trim()}"`);
  assert.ok(!/\.logo[^{]*\{[^}]*(object-fit:\s*(cover|fill)|clip-path|overflow:\s*hidden)/.test(css));
});
check("no white chip or badge behind the logo", () => {
  const logoRule = /\.logo \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(!/background/.test(logoRule), logoRule.trim());
});
check("logo height is within the owner's range (desktop 65–80px, phones 45–55px)", () => {
  const heights = logoImgRules.map((rule) => Number(/height:\s*(\d+)px/.exec(rule)?.[1])).filter(Boolean);
  assert.ok(heights.length >= 2, `heights ${heights}`);
  assert.ok(heights[0] >= 65 && heights[0] <= 80, `desktop ${heights[0]}`);
  assert.ok(heights.slice(1).every((h) => h >= 45 && h <= 55), `phone ${heights.slice(1)}`);
});
check("header row is tall enough for the logo plus clear space", () => {
  const row = Number(/\.hdrRow \{[^}]*min-height: (\d+)px/.exec(css)?.[1]);
  const logo = Number(/height:\s*(\d+)px/.exec(logoImgRules[0])?.[1]);
  assert.ok(row >= logo + 16, `row ${row} logo ${logo}`);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
