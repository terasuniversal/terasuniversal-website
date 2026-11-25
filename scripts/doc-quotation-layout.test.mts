// DOC-4 / CSS-1 unit tests: quotation A4 layout (lib/documents/quotation-layout.ts) and print-geometry scoping
// (lib/documents/print-geometry.ts). With --mutations, each mutation is applied to a temporary copy of the
// libraries and the same checks must fail ("killed").
// Usage: node --experimental-strip-types --no-warnings scripts/doc-quotation-layout.test.mts [--mutations]
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const libDir = join(import.meta.dirname, "..", "lib", "documents");
const FILES = ["quotation-layout.ts", "print-geometry.ts"] as const;
type Source = Record<(typeof FILES)[number], string>;
const real: Source = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")])) as Source;

async function load(src: Source, tag: string) {
  const dir = mkdtempSync(join(tmpdir(), "doc-quote-"));
  for (const f of FILES) writeFileSync(join(dir, f), src[f]);
  const layout = await import(`${pathToFileURL(join(dir, "quotation-layout.ts")).href}?${tag}`);
  const geometry = await import(`${pathToFileURL(join(dir, "print-geometry.ts")).href}?${tag}`);
  return { layout, geometry, dir };
}

const fill = (seed: string, n: number) => { let out = ""; let i = 0; while (out.length < n) out += `${seed} ${++i} panjang-sintetik `; return out.slice(0, n).trim(); };
const COURSES = ["Scaffolding Erector (Basic) — CIDB-aligned synthetic course with practical assessment, PPE briefing and site familiarisation", "Working at Height — Rescue Plan, Harness Inspection and Anchorage Selection (synthetic long description for page-break testing)", "Confined Space Entry and Standby Person — Gas Testing, Ventilation and Permit-to-Work Coordination (synthetic)"];
type Item = { id: string; course_name_snapshot: string | null; description: string; hrdf_claim: boolean; packageLabels: string[] };
const item = (i: number, over: Partial<Item> = {}): Item => ({ id: `q-${i}`, course_name_snapshot: null, description: `${i + 1}. ${COURSES[i % COURSES.length]}`, hrdf_claim: i % 3 === 0, packageLabels: i % 4 === 0 ? ["Certificate", "Meals", "Training kit"] : [], ...over });
const xItem = (i: number): Item => ({ id: `x-${i}`, course_name_snapshot: fill(`Kursus ekstrem ${i + 1}`, 200), description: fill(`${i + 1}. Huraian ekstrem`, 500), hrdf_claim: i % 3 === 0, packageLabels: ["Certificate", "Meals", "Training kit", "Transport", "Accommodation", "Assessment"] });
const customer = (company: string, contact: string, reg: string, email: string, phone: string) => ({ key: "customer", title: "Customer", cards: [{ label: "Customer / Company", strong: company }, { label: "Attention", text: contact }, { label: "Registration No.", text: reg }, { label: "Contact", text: `${email}\n${phone}` }] });
const addresses = (billing: string, training?: string) => ({ key: "addresses", title: "Addresses", cards: [{ label: "Billing Address", text: billing }, ...(training ? [{ label: "Training / Service Address", text: training }] : [])] });
const names = (count: number, length: number) => Array.from({ length: count }, (_, i) => fill(`Peserta ${String.fromCharCode(65 + (i % 26))}`, length).replace(/[0-9-]/g, "a"));
const programme = (course: string, venue: string, participantNames: string[]) => ({ key: "programme", title: "Programme Details", cards: [{ label: "Programme", strong: course }, { label: "Date / Duration", text: "2026-12-07 → 2026-12-11\n5 hari" }, { label: "Participants", text: `${participantNames.length} Pax\n${participantNames.join("\n")}` }, { label: "Venue / Location", strong: "In-House", text: `\nTapak\n${venue}` }] });
const pkgSection = (acc: string, meals: string, other: string[]) => ({ key: "package", title: "Training Package Summary", cards: [{ label: "Accommodation", text: `Included — 4 nights\n${acc}` }, { label: "Meals", text: `Included — 3 per day\n${meals}` }, { label: "Additional Inclusions", full: true, text: ["Training notes", "Practical assessment", "Certificate", ...other].join("  |  ") }] });
const LONG_ADDRESS = "Lot 12345, Jalan Perindustrian Sintetik 7/9, Kawasan Perindustrian Gebeng Fasa 4, 26080 Kuantan, Pahang Darul Makmur, Malaysia (alamat ujian sahaja)";
const LONG_NOTES = Array.from({ length: 14 }, (_, i) => `Nota ${i + 1}: Ini teks sintetik panjang untuk menguji pemisahan muka surat, pengepala sambungan dan kaki dokumen pada cetakan A4. Tiada data pelanggan sebenar.`).join("\n");
const X_ADDRESS = fill("Alamat ujian ekstrem lot", 1000);
const X_TERMS = Array.from({ length: 10 }, (_, i) => fill(`Terma ekstrem ${i + 1}`, 295)).join("\n");

const FIXTURES = {
  short: { infoSections: [customer("Syarikat Sintetik Ringkas Sdn Bhd", "Encik Ali", "202601999999", "qa@example.test", "+60 3-0000 0000"), addresses("1 Jalan Ujian, 50000 Kuala Lumpur", "1 Jalan Ujian, 50000 Kuala Lumpur")], items: [item(0)], termsText: "This quotation is valid until 31 Dec 2026.\n\n1. Valid 30 days.", notes: "Ringkas.", trainingNotes: false },
  long: { infoSections: [customer("Syarikat Sintetik Kejuruteraan Perancah dan Keselamatan Industri Pantai Timur Berhad", "Puan Nur Aisyah binti Abdul Rahman Shah — Pengurus Latihan", "202601999999 (SYNTH-0001)", "document.qa@example.test", "+60 3-0000 0000"), addresses(LONG_ADDRESS, LONG_ADDRESS)], items: Array.from({ length: 28 }, (_, i) => item(i)), termsText: "This quotation is valid until 31 Dec 2026.\n\n1. Valid 30 days.\n2. Full payment before training.", notes: LONG_NOTES, trainingNotes: false },
  extreme: { infoSections: [customer(fill("Syarikat ekstrem", 200), fill("Kenalan ekstrem", 200), fill("REG", 120), "a.very.long.synthetic.mailbox@example.test", "+60 12-345 6789"), addresses(X_ADDRESS, X_ADDRESS)], items: Array.from({ length: 30 }, (_, i) => xItem(i)), termsText: `This quotation is valid until 31 Dec 2026.\n\n${X_TERMS}`, notes: X_TERMS, trainingNotes: false },
  trainingLong: { infoSections: [customer("Syarikat Sintetik Berhad", "Puan Aisyah", "202601999999", "qa@example.test", "+60 3-0000 0000"), addresses(LONG_ADDRESS, LONG_ADDRESS), programme("Scaffolding Erector (Basic)", LONG_ADDRESS, names(6, 40)), pkgSection("Hotel sintetik.", "Sarapan dan makan tengah hari.", ["PPE asas"])], items: Array.from({ length: 12 }, (_, i) => item(i)), termsText: "This quotation is valid until 31 Dec 2026.", notes: LONG_NOTES, trainingNotes: true },
  trainingExtreme: { infoSections: [customer(fill("Syarikat ekstrem", 200), fill("Kenalan ekstrem", 200), fill("REG", 120), "a.very.long.synthetic.mailbox@example.test", "+60 12-345 6789"), addresses(X_ADDRESS, X_ADDRESS), programme(fill("Program ekstrem", 200), X_ADDRESS, names(100, 160)), pkgSection(fill("Penginapan", 500), fill("Makanan", 500), Array.from({ length: 30 }, (_, i) => fill(`Inklusi ${i + 1}`, 200)))], items: [...Array.from({ length: 29 }, (_, i) => xItem(i)), { ...xItem(29), description: fill("WAJIB HURUF BESAR WWW MMM", 500).toUpperCase(), course_name_snapshot: fill("KURSUS HURUF BESAR", 200).toUpperCase() }], termsText: `This quotation is valid until 31 Dec 2026.\n\n${X_TERMS.slice(0, 2700)}\n${fill("TERMA HURUF BESAR WWW MMM", 290).toUpperCase()}`, notes: X_TERMS, trainingNotes: true },
  noTerms: { infoSections: [customer("A", "B", "C", "d@e.test", "1"), addresses("-")], items: Array.from({ length: 5 }, (_, i) => item(i)), termsText: null, notes: null, trainingNotes: false },
};

function runAll(m: Awaited<ReturnType<typeof load>>): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => { try { fn(); } catch (e) { failures.push(`${name}: ${(e as Error).message.split("\n")[0]}`); } };
  const L = m.layout; const G = m.geometry;
  type Block = { kind: string; key?: string; rows?: Array<{ type: string; text?: string }>; items?: Item[]; first?: boolean; title?: string };

  for (const [name, input] of Object.entries(FIXTURES)) {
    const pages: Array<{ blocks: Block[] }> = L.layoutQuotationPages(input);
    const blocks = pages.flatMap((p) => p.blocks);
    check(`${name}: every item exactly once, in order`, () => assert.deepEqual(blocks.filter((b) => b.kind === "items").flatMap((b) => b.items!.map((i) => i.id)), input.items.map((i) => i.id)));
    check(`${name}: no paper exceeds the A4 capacity`, () => pages.forEach((p, i) => { const used = L.quotationPageUsedHeight(p, input); assert.ok(used <= L.QUOTATION_CAPACITY, `page ${i + 1}: ${used} > ${L.QUOTATION_CAPACITY}`); }));
    check(`${name}: every section complete, once, in order`, () => {
      for (const section of input.infoSections) {
        const whole = blocks.filter((b) => b.kind === "info" && b.key === section.key).length;
        const parts = blocks.filter((b) => b.kind === "infoLines" && b.title === section.title);
        if (whole === 1) assert.equal(parts.length, 0);
        else {
          assert.equal(whole, 0);
          // Flowed chunks drop a gap that would start a new paper; every label and line must survive, in order.
          assert.deepEqual(parts.flatMap((b) => b.rows).filter((r) => r!.type !== "gap"), L.infoSectionRows(section).filter((r: { type: string }) => r.type !== "gap"));
          assert.equal(parts.filter((b) => b.first).length, 1);
          const squash = (value: string) => value.replace(/\s/g, "");
          assert.equal(squash(parts.flatMap((b) => b.rows!).map((r) => r.text ?? "").join("")), squash(section.cards.map((c: { label: string; strong?: string; text?: string }) => `${c.label}${c.strong ?? ""}${c.text ?? ""}`).join("")));
        }
      }
      const order = blocks.map((b) => (b.kind === "info" || b.kind === "infoLines" ? "info" : b.kind)).filter((k, i, a) => k !== a[i - 1]);
      assert.deepEqual(order, ["info", "items", "totals", ...(input.termsText !== null ? ["termsNotes"] : []), ...(input.trainingNotes ? ["trainingNotes"] : [])]);
      assert.equal(blocks.filter((b) => b.kind === "totals").length, 1);
      assert.equal(blocks.filter((b) => b.kind === "items" && b.first).length, 1, "one 'Commercial Breakdown' title");
    });
    check(`${name}: terms and notes complete`, () => {
      const rows = blocks.filter((b) => b.kind === "termsNotes").flatMap((b) => b.rows);
      if (input.termsText === null) { assert.equal(rows.length, 0); return; }
      const expected = L.termsNotesRows(input.termsText, input.notes);
      assert.deepEqual(rows.filter((r) => r!.type !== "gap"), expected.filter((r: { type: string }) => r.type !== "gap"));
      assert.equal(blocks.filter((b) => b.kind === "termsNotes" && b.first).length, 1);
      // Independent of termsNotesRows: every character of the terms and notes reaches the papers, in order.
      const squash = (value: string) => value.replace(/\s/g, "");
      const printed = squash(rows.map((r) => r!.text ?? "").join(""));
      assert.equal(printed, squash(`Terms${input.termsText}${input.notes?.trim() ? `Notes${input.notes}` : ""}`));
    });
    check(`${name}: no orphan label and no leading gap`, () => {
      for (const b of blocks.filter((x) => x.rows)) {
        assert.notEqual(b.rows![0].type, "gap", "chunk starts with a gap");
        const last = b.rows![b.rows!.length - 1];
        assert.ok(last.type !== "label" || b === blocks.filter((x) => x.rows).at(-1), "chunk ends with a label");
      }
    });
    check(`${name}: no empty paper`, () => pages.forEach((p, i) => assert.ok(p.blocks.length > 0, `page ${i + 1} empty`)));
  }
  check("short quotation is one page", () => assert.equal(L.layoutQuotationPages(FIXTURES.short).length, 1));
  check("extreme training details flow by line", () => assert.ok(L.layoutQuotationPages(FIXTURES.trainingExtreme).flatMap((p: { blocks: Block[] }) => p.blocks).some((b: Block) => b.kind === "infoLines")));
  check("normal sections render whole", () => assert.ok(L.layoutQuotationPages(FIXTURES.trainingLong).flatMap((p: { blocks: Block[] }) => p.blocks).every((b: Block) => b.kind !== "infoLines")));

  // Calibration against Chromium print media (210mm paper, 10px type): estimates must be at least the rendered height.
  check("calibration: 123-char row with 3 packages >= 76px", () => assert.ok(L.quotationItemHeight(item(0, { hrdf_claim: false })) >= 76));
  check("calibration: 108-130 char rows >= 57px", () => { for (const len of [108, 120, 130]) assert.ok(L.quotationItemHeight({ id: "c", course_name_snapshot: null, description: "x".repeat(len), hrdf_claim: false, packageLabels: [] }) >= 57, `len ${len}`); });
  check("calibration: max-length row >= 315px", () => assert.ok(L.quotationItemHeight(xItem(0)) >= 315));
  check("calibration: 1000-char address card >= 283px", () => assert.ok(L.cardHeight({ label: "Billing Address", text: X_ADDRESS }) >= 283));
  check("calibration: one-line card >= 51px", () => assert.ok(L.cardHeight({ label: "Attention", text: "Encik Ali" }) >= 51));
  check("calibration: short customer section >= 164px", () => assert.ok(L.infoSectionHeight(FIXTURES.short.infoSections[0]) >= 164));
  check("calibration: content stays above the running footer", () => assert.ok(L.QUOTATION_PAPER.paddingTop + 198 + L.QUOTATION_CAPACITY <= L.QUOTATION_PAPER.footerTop));
  check("wide glyphs count wider", () => { assert.ok(L.visualLength("WWWW") > L.visualLength("wwww")); assert.ok(L.visualLength("ABCD") > L.visualLength("abcd")); });
  check("all-caps text needs more lines", () => assert.ok(L.visualLines("A".repeat(400), 42) > L.visualLines("a".repeat(400), 42)));
  check("wrapVisual keeps every character within the width", () => {
    const text = `${fill("Teks", 700)}\n\n${"X".repeat(150)} ${fill("WWW MMM", 120).toUpperCase()}`;
    const lines = L.wrapVisual(text, 100);
    assert.ok(lines.every((line: string) => L.visualLength(line) <= 100));
    assert.equal(lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.ok(lines.includes(""));
  });

  // Print geometry: the same rules, scoped for measurement.
  check("scope: html/body and plain selectors", () => {
    const scoped = G.scopePrintGeometry("html,body{margin:0!important}.a .b{padding:1px}*{x:y}");
    assert.equal(scoped, "html[data-print-geometry],html[data-print-geometry] body{margin:0!important}html[data-print-geometry] .a .b{padding:1px}html[data-print-geometry] *{x:y}");
  });
  check("scope: every rule keeps its declarations", () => {
    const css = ".q{width:210mm;height:297mm}.r,.s{padding:10mm 12mm 20mm}";
    assert.equal(G.scopePrintGeometry(css).replace(/html\[data-print-geometry\] /g, ""), css);
  });
  check("scope: custom attribute", () => assert.equal(G.scopePrintGeometry(".a{b:c}", "data-x"), "html[data-x] .a{b:c}"));
  return failures;
}

const base = await load(real, "real");
const failures = runAll(base);
rmSync(base.dir, { recursive: true, force: true });
for (const f of failures) console.log(`not ok - ${f}`);
assert.equal(failures.length, 0, `${failures.length} check(s) failed`);
console.log("ok - doc-quotation-layout: all checks passed");

if (process.argv.includes("--mutations")) {
  const mutations: Array<[string, (typeof FILES)[number], string, string]> = [
    ["DOC-4 optimistic description width", "quotation-layout.ts", "description: 42,", "description: 62,"],
    ["DOC-4 optimistic card width", "quotation-layout.ts", "cardHalf: 50,", "cardHalf: 80,"],
    ["DOC-4 ignore wide glyphs", "quotation-layout.ts", "/[A-Z0-9]/.test(ch) ? 1.3 : 1", "/[A-Z0-9]/.test(ch) ? 1 : 1"],
    ["DOC-4 ignore course name", "quotation-layout.ts", "const course = item.course_name_snapshot?.trim() ?", "const course = false ?"],
    ["DOC-4 ignore package line", "quotation-layout.ts", "const pkg = item.packageLabels.length > 0 ?", "const pkg = false ?"],
    ["DOC-4 ignore header", "quotation-layout.ts", "- QUOTATION_PAPER.paddingTop - HEADER -", "- QUOTATION_PAPER.paddingTop -"],
    ["DOC-4 never break for items", "quotation-layout.ts", "    if (current().blocks.length > 0 && used + chrome + h > cap) newPage();\n", ""],
    ["DOC-4 append items past capacity", "quotation-layout.ts", "if (last?.kind === \"items\" && used + h <= cap)", "if (last?.kind === \"items\")"],
    ["DOC-4 sections never flow", "quotation-layout.ts", "if (infoSectionHeight(section) <= cap) place(", "if (true) place("],
    ["DOC-4 flow drops a row", "quotation-layout.ts", "remaining = remaining.slice(take);", "remaining = remaining.slice(take + 1);"],
    ["DOC-4 orphan labels allowed", "quotation-layout.ts", "while (take > 1 && take < remaining.length && (remaining[take - 1].type === \"label\" || remaining[take - 1].type === \"gap\")) take--;", ""],
    ["DOC-4 notes dropped", "quotation-layout.ts", "  if (notes?.trim()) {", "  if (false) {"],
    ["DOC-4 totals before items", "quotation-layout.ts", "  place({ kind: \"totals\" });\n  if (input.termsText", "  if (input.termsText"],
    ["DOC-4 wrap ignores width", "quotation-layout.ts", "if (visualLength(candidate) <= charactersPerLine) { line = candidate; continue; }", "{ line = candidate; continue; }"],
    ["DOC-4 section rows drop card text", "quotation-layout.ts", "for (const paragraph of paragraphs(card.text)) for", "for (const paragraph of paragraphs(card.text).slice(1)) for"],
    ["CSS-1 scope misses root", "print-geometry.ts", "return `${root} ${s}`;", "return s;"],
    ["CSS-1 scope drops body", "print-geometry.ts", "if (s === \"body\") return `${root} body`;", "if (s === \"body\") return \"body\";"],
  ];
  let killed = 0;
  for (const [name, file, from, to] of mutations) {
    assert.ok(real[file].includes(from), `mutation source not found: ${name}`);
    const m = await load({ ...real, [file]: real[file].replace(from, to) }, `m${killed}-${name.length}-${Math.random()}`);
    let dead = false;
    try { dead = runAll(m).length > 0; } catch { dead = true; }
    rmSync(m.dir, { recursive: true, force: true });
    if (dead) { killed++; console.log(`ok - mutation killed: ${name}`); } else console.log(`not ok - mutation survived: ${name}`);
  }
  console.log(`# doc-quotation-layout mutations: ${killed}/${mutations.length} killed`);
  assert.equal(killed, mutations.length, "every mutation must be killed");
}
