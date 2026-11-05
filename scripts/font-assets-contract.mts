import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// Contract for the self-hosted fonts (app/fonts): asset integrity, licences, wiring in the two
// layouts, no remaining Google Fonts loader, and Latin-subset glyph coverage of site source.
// Reads the repository only; no network.
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const fontsDir = join(root, "app", "fonts");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

type FontEntry = { family: string; version: string; file: string; source_url: string; kind: string; weights: string; bytes: number; sha256: string };
type Licence = { file: string; copyright: string; sha256: string; bytes: number };
const manifest = JSON.parse(readFileSync(join(fontsDir, "manifest.json"), "utf8")) as {
  subset: string; subset_unicode_range: string; total_font_bytes: number; fonts: FontEntry[];
  licenses: Record<string, Licence>; license: { spdx: string; reserved_font_names: string };
};

// ---- Font files -----------------------------------------------------------------
check("manifest: exactly the six approved Latin WOFF2 files", () => {
  assert.equal(manifest.fonts.length, 6);
  assert.deepEqual(manifest.fonts.map((f) => `${f.family} ${f.version} ${f.weights}`).sort(), [
    "Inter v20 400 600", "Montserrat v31 600 800", "Poppins v24 400", "Poppins v24 500", "Poppins v24 600", "Poppins v24 700",
  ]);
  assert.equal(manifest.subset, "latin");
});
for (const font of manifest.fonts) {
  check(`asset: ${font.file} exists, size and SHA-256 match the manifest`, () => {
    const buffer = readFileSync(join(fontsDir, font.file));
    assert.equal(buffer.length, font.bytes);
    assert.equal(sha256(buffer), font.sha256);
  });
  check(`asset: ${font.file} has a valid TrueType-flavoured WOFF2 header (the payload is exercised by the build and the browser load checks)`, () => {
    const b = readFileSync(join(fontsDir, font.file));
    assert.equal(b.subarray(0, 4).toString("latin1"), "wOF2");
    assert.equal(b.readUInt32BE(4), 0x00010000);
    assert.equal(b.readUInt32BE(8), b.length); // header length field equals the file size
  });
  check(`asset: ${font.file} comes from the official Google Fonts static host`, () => {
    assert.match(font.source_url, /^https:\/\/fonts\.gstatic\.com\/s\/(montserrat|poppins|inter)\/v\d+\/[A-Za-z0-9_-]+\.woff2$/);
  });
}
check("assets: total size matches and no unlisted font file is shipped", () => {
  assert.equal(manifest.fonts.reduce((n, f) => n + f.bytes, 0), manifest.total_font_bytes);
  const onDisk: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(dir)) { const p = join(dir, e); statSync(p).isDirectory() ? walk(p) : /\.(woff2?|ttf|otf|eot)$/i.test(e) && onDisk.push(p.slice(fontsDir.length + 1).replace(/\\/g, "/")); } };
  walk(fontsDir);
  assert.deepEqual(onDisk.sort(), manifest.fonts.map((f) => f.file).sort());
});

// ---- Licences -------------------------------------------------------------------
for (const [family, licence] of Object.entries(manifest.licenses)) {
  check(`licence: ${family} OFL text is present, intact and is SIL OFL 1.1 with its copyright`, () => {
    const text = readFileSync(join(fontsDir, licence.file), "utf8").replace(/\r\n/g, "\n"); // hash the LF form so checkout line endings do not matter
    assert.equal(sha256(Buffer.from(text, "utf8")), licence.sha256);
    assert.ok(text.startsWith(licence.copyright), "copyright line differs from the manifest");
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/i);
    assert.doesNotMatch(text, /with Reserved Font Name/i, "a Reserved Font Name would change the redistribution conditions");
  });
}
check("licence: every shipped family has a licence entry", () => {
  assert.deepEqual(Object.keys(manifest.licenses).sort(), ["Inter", "Montserrat", "Poppins"]);
  assert.equal(manifest.license.spdx, "OFL-1.1");
});

// ---- Wiring ---------------------------------------------------------------------
const rootLayout = read("app/layout.js");
const adminLayout = read("app/admin/layout.tsx");
check("wiring: no next/font/google import remains anywhere in app, components or lib", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== "node_modules" && e !== ".next") walk(p); continue; }
      if (/\.(js|jsx|ts|tsx|mjs)$/.test(e) && /next\/font\/google/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(root.length));
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  assert.deepEqual(offenders, []);
});
check("wiring: root layout uses next/font/local with the approved families, weights, variables and display swap", () => {
  assert.match(rootLayout, /import localFont from "next\/font\/local";/);
  assert.match(rootLayout, /montserrat-v31-latin-wght-normal\.woff2", weight: "600 800"/);
  for (const w of ["400", "500", "600", "700"]) assert.match(rootLayout, new RegExp(`poppins-v24-latin-${w}\\.woff2", weight: "${w}"`));
  assert.match(rootLayout, /variable: "--font-montserrat"/);
  assert.match(rootLayout, /variable: "--font-poppins"/);
  assert.equal((rootLayout.match(/display: "swap"/g) ?? []).length, 2);
  assert.match(rootLayout, /<html lang="en" className=\{montserrat\.variable \+ " " \+ poppins\.variable\}>/);
});
check("wiring: admin layout uses next/font/local for Inter with the same variable and display swap", () => {
  assert.match(adminLayout, /import localFont from "next\/font\/local";/);
  assert.match(adminLayout, /inter-v20-latin-wght-normal\.woff2", weight: "400 600"/);
  assert.match(adminLayout, /variable: "--font-inter"/);
  assert.match(adminLayout, /display: "swap"/);
  assert.match(adminLayout, /className=\{`teras-admin \$\{inter\.variable\}`\}/);
});
check("wiring: every font path referenced by a layout exists", () => {
  const referenced = [...rootLayout.matchAll(/path: "\.\/fonts\/([^"]+)"/g)].map((m) => m[1]).concat([...adminLayout.matchAll(/path: "\.\.\/fonts\/([^"]+)"/g)].map((m) => m[1]));
  assert.equal(referenced.length, 6);
  for (const rel of referenced) assert.ok(existsSync(join(fontsDir, rel)), rel);
  assert.deepEqual(referenced.sort(), manifest.fonts.map((f) => f.file).sort());
});

// ---- Fallback metrics: unchanged from the former Google Fonts loader -------------------
check("fallback: fallbacks.css keeps the exact previous metric-matched local fallbacks", () => {
  const css = read("app/fonts/fallbacks.css").replace(/\s+/g, " ");
  const expected: Record<string, string> = {
    "Montserrat Fallback": "ascent-override: 85.79%; descent-override: 22.25%; line-gap-override: 0.00%; size-adjust: 112.83%;",
    "Poppins Fallback": "ascent-override: 93.62%; descent-override: 31.21%; line-gap-override: 8.92%; size-adjust: 112.16%;",
    "Inter Fallback": "ascent-override: 90.44%; descent-override: 22.52%; line-gap-override: 0.00%; size-adjust: 107.12%;",
  };
  for (const [family, metrics] of Object.entries(expected)) assert.ok(css.includes(`font-family: "${family}"; src: local("Arial"); ${metrics}`), family);
});
check("fallback: the layouts use those fallbacks instead of Next-generated ones", () => {
  assert.match(rootLayout, /import "\.\/fonts\/fallbacks\.css";/);
  assert.equal((rootLayout.match(/adjustFontFallback: false/g) ?? []).length, 2);
  assert.match(rootLayout, /fallback: \["Montserrat Fallback"\]/);
  assert.match(rootLayout, /fallback: \["Poppins Fallback"\]/);
  assert.match(adminLayout, /adjustFontFallback: false/);
  assert.match(adminLayout, /fallback: \["Inter Fallback"\]/);
});

// ---- Glyph coverage: no letters outside the shipped Latin subset in site source ---------
const latinRanges = manifest.subset_unicode_range.split(",").map((part) => part.trim().replace("U+", "")).map((part) => {
  const [a, b] = part.split("-"); return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
});
const inLatin = (cp: number) => latinRanges.some(([a, b]) => cp >= a && cp <= b);
check("coverage: site source has no letters or marks outside the shipped Latin subset", () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (!["node_modules", ".next", "fonts"].includes(e)) walk(p); continue; }
      if (![".js", ".jsx", ".ts", ".tsx", ".css", ".json", ".md", ".mjs"].includes(extname(e))) continue;
      for (const ch of new Set(readFileSync(p, "utf8"))) {
        const cp = ch.codePointAt(0)!;
        // U+FE00-FE0F are invisible variation selectors (emoji presentation) that never use a text font
        if (cp > 0xff && /[\p{L}\p{M}]/u.test(ch) && !inLatin(cp) && !(cp >= 0xfe00 && cp <= 0xfe0f)) found.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")} in ${p.slice(root.length)}`);
      }
    }
  };
  for (const d of ["app", "components", "lib", "data"]) if (existsSync(join(root, d))) walk(join(root, d));
  assert.deepEqual(found, [], "letters outside the Latin subset would fall back to the system font");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan aset fon lulus");
process.exit(failures ? 1 : 0);
