// F-UAT-01 regression: an A4 document paper must keep its A4 width when the print controller measures it, whatever
// the viewport. app/globals.css caps some elements (e.g. `main`) at max-width:100%; a paper rendered as one of those
// elements followed a 390px phone viewport during measurement, reflowed taller than A4 and was falsely blocked
// (layout_overflow). For every page whose DocumentPrintController verifies A4 fit, this checks that the paper is either
// not a capped element, or its print geometry (applied by the controller for measurement) resets max-width.
// With --mutations, each mutation is applied to an in-memory copy of the sources and the checks must fail ("killed").
// Usage: node --experimental-strip-types --no-warnings scripts/doc-mobile-print-geometry.test.mts [--mutations]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scopePrintGeometry, PRINT_GEOMETRY_ATTRIBUTE } from "../lib/documents/print-geometry.ts";

const root = join(import.meta.dirname, "..");
const PAGES = ["app/admin/quotation-pdf/[id]/page.tsx", "app/admin/invoice-pdf/[id]/page.tsx"] as const;
type Sources = { globals: string } & Record<(typeof PAGES)[number], string>;
const real: Sources = { globals: readFileSync(join(root, "app/globals.css"), "utf8"), ...Object.fromEntries(PAGES.map((p) => [p, readFileSync(join(root, p), "utf8")])) } as Sources;

/** Bare element selectors that a top-level (unconditional) rule in globals.css caps with a non-`none` max-width. */
function cappedElements(css: string): Set<string> {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const capped = new Set<string>();
  let depth = 0;
  let start = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === "{") {
      if (depth === 0) {
        const selector = flat.slice(start, i).trim();
        const end = flat.indexOf("}", i);
        const body = flat.slice(i + 1, end);
        if (!selector.startsWith("@")) {
          const m = /(?:^|;)\s*max-width\s*:\s*([^;]+)/i.exec(body);
          if (m && m[1].trim() !== "none") for (const s of selector.split(",")) if (/^[a-z][a-z0-9]*$/.test(s.trim())) capped.add(s.trim());
          i = end; start = end + 1; continue;
        }
      }
      depth++;
    } else if (flat[i] === "}") { depth--; if (depth === 0) start = i + 1; }
  }
  return capped;
}

/** Declarations for `selector` inside a flat rule list (the print-geometry string). */
function declarations(css: string, selector: string): string | null {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2];
  return null;
}

function runAll(src: Sources): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => { try { fn(); } catch (e) { failures.push(`${name}: ${(e as Error).message}`); } };
  const capped = cappedElements(src.globals);
  check("globals cap detection sees the known `main` cap", () => assert.ok(capped.has("main") || !/\bmain\s*,/.test(src.globals), "parser missed a main cap"));
  for (const page of PAGES) {
    const text = src[page];
    const controller = /<DocumentPrintController\b([^>]*)\/>/.exec(text);
    check(`${page}: has an A4-verifying print controller`, () => assert.ok(controller && /\bverifyA4Fit\b/.test(controller[1])));
    if (!controller) continue;
    const paperClass = /paperSelector="\.([\w-]+)"/.exec(controller[1])?.[1];
    check(`${page}: paper selector`, () => assert.ok(paperClass));
    if (!paperClass) continue;
    const tag = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*className="${paperClass}"`).exec(text)?.[1];
    check(`${page}: paper element found`, () => assert.ok(tag));
    if (!tag || !capped.has(tag)) continue;
    // A capped paper element is only safe when the controller measures in print geometry that resets the cap.
    check(`${page}: <${tag}> paper is measured in print geometry`, () => assert.match(controller[1], /printGeometryAttribute=\{PRINT_GEOMETRY_ATTRIBUTE\}/));
    const geometry = /const printGeometry = `([^`]*)`/.exec(text)?.[1] ?? "";
    const own = declarations(geometry, `.${paperClass}`) ?? "";
    check(`${page}: print geometry keeps the A4 width`, () => assert.match(own, /(?:^|;)width:210mm(?:;|$)/));
    check(`${page}: print geometry resets the global max-width cap`, () => assert.match(own, /(?:^|;)max-width:none(?:;|$)/));
    const scoped = declarations(scopePrintGeometry(geometry), `html[${PRINT_GEOMETRY_ATTRIBUTE}] .${paperClass}`) ?? "";
    check(`${page}: measurement rule (scoped) resets max-width`, () => assert.match(scoped, /(?:^|;)max-width:none(?:;|$)/));
    check(`${page}: print geometry is applied for print and for measurement`, () => {
      assert.ok(text.includes("@media print{${printGeometry}"), "@media print must use printGeometry");
      assert.ok(text.includes("${scopePrintGeometry(printGeometry)}"), "scoped measurement rules must use printGeometry");
    });
  }
  return failures;
}

const failures = runAll(real);
for (const f of failures) console.log(`not ok - ${f}`);
assert.equal(failures.length, 0, `${failures.length} check(s) failed`);
console.log("ok - doc-mobile-print-geometry: all checks passed");

if (process.argv.includes("--mutations")) {
  const Q = PAGES[0];
  const I = PAGES[1];
  const mutations: Array<[string, keyof Sources, string, string]> = [
    ["F-UAT-01 drop the max-width reset", Q, "width:210mm;max-width:none;", "width:210mm;"],
    ["F-UAT-01 reset only on screen, not in print geometry", Q, ".quotation-print-paper{width:210mm;max-width:none;", ".quotation-print-paper{width:210mm;"],
    ["F-UAT-01 measure on screen instead of print geometry", Q, " printGeometryAttribute={PRINT_GEOMETRY_ATTRIBUTE}", ""],
    ["F-UAT-01 paper width follows the viewport", Q, "width:210mm;max-width:none;", "width:100%;max-width:none;"],
    ["F-UAT-01 measurement rules not scoped from printGeometry", Q, "${scopePrintGeometry(printGeometry)}", ""],
    ["F-UAT-01 invoice paper becomes a capped <main>", I, "<div key={pageIndex} className=\"inv-pdf-page\"", "<main key={pageIndex} className=\"inv-pdf-page\""],
    ["F-UAT-01 A4 verification switched off", Q, "documentLabel=\"Quotation\" verifyA4Fit", "documentLabel=\"Quotation\""],
  ];
  let killed = 0;
  for (const [name, file, from, to] of mutations) {
    assert.ok(real[file].includes(from), `mutation source not found: ${name}`);
    let dead = false;
    try { dead = runAll({ ...real, [file]: real[file].replace(from, to) }).length > 0; } catch { dead = true; }
    if (dead) { killed++; console.log(`ok - mutation killed: ${name}`); } else console.log(`not ok - mutation survived: ${name}`);
  }
  console.log(`# doc-mobile-print-geometry mutations: ${killed}/${mutations.length} killed`);
  assert.equal(killed, mutations.length, "every mutation must be killed");
}
