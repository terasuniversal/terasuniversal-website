// DOC-2 / DOC-3 unit tests: invoice A4 layout (lib/documents/invoice-layout.ts) and print readiness rules
// (lib/documents/print-readiness.ts). With --mutations, each mutation is applied to a temporary copy of the
// libraries and the same checks must fail ("killed").
// Usage: node --experimental-strip-types --no-warnings scripts/doc-print-layout.test.mts [--mutations]
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
const FILES = ["pagination.ts", "invoice-layout.ts", "print-readiness.ts"] as const;
type Source = Record<(typeof FILES)[number], string>;
const real: Source = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")])) as Source;

const TABLE_OVERHEAD = 51; // mirrors invoice-layout.ts (thead + table margin once per paper with rows)

async function load(src: Source, tag: string) {
  const dir = mkdtempSync(join(tmpdir(), "doc-print-"));
  for (const f of FILES) writeFileSync(join(dir, f), src[f]);
  const layout = await import(`${pathToFileURL(join(dir, "invoice-layout.ts")).href}?${tag}`);
  const readiness = await import(`${pathToFileURL(join(dir, "print-readiness.ts")).href}?${tag}`);
  return { layout, readiness, dir };
}

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 7 === 0 ? "Panjang" : "kata"}${i}`).join(" ");
const longText = (chars: number, seed: string) => words(chars, seed).slice(0, chars);
const item = (i: number, descChars: number, nameChars = 60, pkg = 0) => ({
  id: `item-${i}`,
  course_name_snapshot: longText(nameChars, `N${i}`),
  description: longText(descChars, `D${i}`),
  package_includes_snapshot: Array.from({ length: pkg }, (_, k) => ({ label: `Package entry ${k} for item ${i}` })),
});
const baseInput = (over: Record<string, unknown> = {}) => ({
  items: [item(1, 80)],
  billTo: ["Short Customer Sdn Bhd", "Lot 1, Jalan Satu, 50000 Kuala Lumpur", "finance@example.test", "03-1234 5678"],
  hasTraining: true,
  showTax: true,
  paymentCount: 1,
  termsText: "Payment due within 30 days.",
  notes: "Thank you.",
  ...over,
});
const FIXTURES: Record<string, ReturnType<typeof baseInput>> = {
  short: baseInput(),
  long: baseInput({
    items: Array.from({ length: 12 }, (_, i) => item(i, 145, 90, i % 3)),
    billTo: ["Syarikat Pelanggan Dengan Nama Yang Sangat Panjang Untuk Ujian Sdn Bhd", longText(300, "Alamat"), "Training / Service Address: " + longText(200, "Latihan"), "accounts.department@example.test", "+60 12-345 6789"],
    paymentCount: 3,
    termsText: "Payment due within 30 days.\n" + longText(900, "Terma"),
    notes: longText(1200, "Nota"),
  }),
  extreme: baseInput({
    items: Array.from({ length: 40 }, (_, i) => item(i, 500, 200, 6)),
    billTo: [longText(200, "Nama"), longText(200, "Syarikat"), "Reg. No. 202401234567 (1234567-X)", longText(1000, "Alamat"), "Training / Service Address: " + longText(1000, "Tapak"), "a-very-long-email-address@example.test", "+60 12-345 6789"],
    paymentCount: 12,
    termsText: "Payment due within 30 days.\n" + longText(3000, "Terma"),
    notes: longText(3000, "Nota"),
  }),
  noNotesNoPayments: baseInput({ paymentCount: 0, notes: null, items: Array.from({ length: 6 }, (_, i) => item(i, 200)) }),
};

function runAll(m: Awaited<ReturnType<typeof load>>): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => { try { fn(); } catch (e) { failures.push(`${name}: ${(e as Error).message.split("\n")[0]}`); } };
  const L = m.layout; const R = m.readiness;

  // ---- DOC-3 layout ----
  for (const [name, input] of Object.entries(FIXTURES)) {
    const pages = L.layoutInvoicePages(input);
    check(`${name}: every item exactly once, in order`, () => {
      assert.deepEqual(pages.flatMap((p: { items: Array<{ id: string }> }) => p.items.map((it) => it.id)), input.items.map((it) => it.id));
    });
    check(`${name}: no paper exceeds its capacity`, () => {
      pages.forEach((p: unknown, i: number) => {
        const cap = L.pageCapacity(i);
        const used = L.pageUsedHeight(p, input);
        assert.ok(used <= cap, `page ${i + 1} uses ${used} > ${cap}`);
      });
      // independent of pageUsedHeight: items + closing blocks on a page with a whole Bill To
      if (pages[0].billTo?.mode === "full") {
        const p = pages[0];
        const own = (p.items.length ? TABLE_OVERHEAD : 0) + p.items.reduce((s: number, it: unknown) => s + L.invoiceItemHeight(it), 0) + p.final.reduce((s: number, b: unknown) => s + L.finalBlockHeight(b, input), 0);
        assert.ok(own <= L.firstPageCapacity(input), `page 1 items/closing ${own} > ${L.firstPageCapacity(input)}`);
      }
    });
    check(`${name}: closing blocks complete and in order`, () => {
      const blocks = pages.flatMap((p: { final: Array<{ kind: string; lines?: string[]; first?: boolean }> }) => p.final);
      const kinds = blocks.map((b: { kind: string }) => b.kind).filter((k: string, i: number, a: string[]) => k !== a[i - 1]);
      const expected = ["totals", ...(input.paymentCount > 0 ? ["payments"] : []), "terms", "paymentInstructions", ...(input.notes ? ["notes"] : [])];
      assert.deepEqual(kinds, expected);
      const terms = blocks.filter((b: { kind: string }) => b.kind === "terms");
      assert.deepEqual(terms.flatMap((b: { lines: string[] }) => b.lines), L.wrapLines(input.termsText, L.INVOICE_CPL.terms));
      assert.equal(terms.filter((b: { first: boolean }) => b.first).length, 1, "terms title exactly once");
      assert.equal(terms[0].first, true, "terms title on the first chunk");
      if (input.notes) assert.deepEqual(blocks.filter((b: { kind: string }) => b.kind === "notes").flatMap((b: { lines: string[] }) => b.lines), L.wrapLines(String(input.notes).trim(), L.INVOICE_CPL.notes));
      // totals only once, items all before totals
      assert.equal(blocks.filter((b: { kind: string }) => b.kind === "totals").length, 1);
      const totalsPage = pages.findIndex((p: { final: Array<{ kind: string }> }) => p.final.some((b) => b.kind === "totals"));
      const lastItemPage = pages.map((p: { items: unknown[] }) => p.items.length > 0).lastIndexOf(true);
      assert.ok(totalsPage >= lastItemPage, "totals after the last item");
    });
    check(`${name}: Bill To complete, once, on the first paper(s)`, () => {
      const blocks = pages.map((p: { billTo?: { mode: string; lines?: string[]; first?: boolean } }) => p.billTo).filter(Boolean);
      assert.ok(pages[0].billTo, "page 1 has Bill To");
      if (blocks[0].mode === "full") assert.equal(blocks.length, 1);
      else {
        const fields = input.billTo.map((f) => String(f ?? "").trim()).filter(Boolean);
        assert.deepEqual(blocks.flatMap((b: { lines: string[] }) => b.lines), fields.flatMap((f) => L.wrapLines(f, L.INVOICE_CPL.billTo)));
        assert.equal(blocks.filter((b: { first: boolean }) => b.first).length, 1);
        const lastBillToPage = pages.map((p: { billTo?: unknown }) => Boolean(p.billTo)).lastIndexOf(true);
        const firstItemPage = pages.findIndex((p: { items: unknown[] }) => p.items.length > 0);
        assert.ok(firstItemPage >= lastBillToPage, "items after Bill To");
      }
      assert.equal(pages.filter((p: { training?: boolean }) => p.training).length, input.hasTraining ? 1 : 0, "training summary once");
    });
    check(`${name}: no empty trailing paper`, () => {
      const last = pages[pages.length - 1];
      assert.ok(last.items.length + last.final.length > 0);
    });
  }
  // The DuitNow payment-instructions block (~240px) does not fit beside a full page 1 even today, so a one-item
  // invoice is two papers; it must not be more.
  check("short invoice needs at most two pages", () => assert.ok(L.layoutInvoicePages(FIXTURES.short).length <= 2));
  check("long invoice needs several pages", () => assert.ok(L.layoutInvoicePages(FIXTURES.long).length >= 3));
  check("extreme invoice is not squeezed into few pages", () => assert.ok(L.layoutInvoicePages(FIXTURES.extreme).length >= 12));
  check("extreme Bill To flows by line instead of overflowing page 1", () => assert.equal(L.layoutInvoicePages(FIXTURES.extreme)[0].billTo.mode, "lines"));
  check("normal Bill To renders whole", () => { assert.equal(L.layoutInvoicePages(FIXTURES.short)[0].billTo.mode, "full"); assert.equal(L.layoutInvoicePages(FIXTURES.long)[0].billTo.mode, "full"); });
  check("wrapLines keeps every character and the width", () => {
    const text = `${longText(700, "W")}\n\nSecond paragraph ${"x".repeat(150)}`;
    const lines = L.wrapLines(text, 72);
    assert.ok(lines.every((line: string) => line.length <= 72));
    assert.equal(lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.ok(lines.includes(""), "blank line preserved");
  });
  check("taller text means taller item", () => assert.ok(L.invoiceItemHeight(item(1, 400)) > L.invoiceItemHeight(item(1, 40))));
  check("long Bill To shrinks page 1", () => assert.ok(L.firstPageCapacity(FIXTURES.long) < L.firstPageCapacity(FIXTURES.short)));
  check("training section shrinks page 1", () => assert.ok(L.firstPageCapacity({ ...FIXTURES.short, hasTraining: true }) < L.firstPageCapacity({ ...FIXTURES.short, hasTraining: false })));

  // Calibration: every estimate must be at least the height Chromium rendered (screen media, 794px paper,
  // CLOSEOUT-02 DOCQA fixtures, global <section> padding neutralised). Screen is the larger of screen/print.
  check("calibration: 108-130 char description row >= 73px", () => {
    for (const len of [108, 120, 130]) assert.ok(L.invoiceItemHeight({ id: "c", course_name_snapshot: null, description: "x".repeat(len) }) >= 73, `len ${len}`);
  });
  check("calibration: 145 char description row >= 93px", () => assert.ok(L.invoiceItemHeight({ id: "c", course_name_snapshot: null, description: "x".repeat(145) }) >= 93));
  check("calibration: long DOCQA Bill To >= 358px (334 + 24 margin)", () => {
    const company = "Syarikat Sintetik Kejuruteraan Perancah dan Keselamatan Industri Pantai Timur Berhad (Ujian Dokumen Panjang)";
    const contact = "Puan Nur Aisyah binti Abdul Rahman Shah — Pengurus Latihan dan Pembangunan Sumber Manusia (Sintetik)";
    const address = "Lot 12345, Jalan Perindustrian Sintetik 7/9, Kawasan Perindustrian Gebeng Fasa 4, 26080 Kuantan, Pahang Darul Makmur, Malaysia (alamat ujian sahaja)";
    assert.ok(L.billToHeight([contact, company, "Reg. No. 202601999999 (SYNTH-0001)", address, `Training / Service Address: ${address}`, "document.qa@example.test", "+60 3-0000 0000"]) >= 358);
  });
  check("calibration: closing blocks >= rendered", () => {
    assert.ok(L.finalBlockHeight({ kind: "totals" }, { showTax: false, paymentCount: 0 }) >= 167);
    assert.ok(L.finalBlockHeight({ kind: "payments" }, { showTax: false, paymentCount: 1 }) >= 50);
    assert.ok(L.finalBlockHeight({ kind: "payments" }, { showTax: false, paymentCount: 3 }) >= 103);
    assert.ok(L.finalBlockHeight({ kind: "paymentInstructions" }, { showTax: false, paymentCount: 0 }) >= 22 + 195 + 22);
    assert.ok(L.finalBlockHeight({ kind: "terms", lines: ["a", "b", "c"], first: true }, { showTax: false, paymentCount: 0 }) >= 22 + 78 + 22);
    assert.ok(L.finalBlockHeight({ kind: "terms", lines: Array(22).fill("a"), first: false }, { showTax: false, paymentCount: 0 }) >= 374);
    assert.ok(L.finalBlockHeight({ kind: "notes", lines: Array(25).fill("a") }, { showTax: false, paymentCount: 0 }) >= 16 + 400);
  });
  check("calibration: headers leave the running footer clear", () => {
    // content starts at 48px; the 2-line running footer starts at 1045px.
    assert.ok(48 + 248 + 24 + L.pageCapacity(0) <= 1045, "page 1");
    assert.ok(48 + 63 + 18 + L.pageCapacity(1) <= 1045, "continuation");
  });

  // ---- DOC-2 readiness ----
  const ready = { paperCount: 2, papersVisible: true, obstructed: false, fontsLoaded: true, imagesPending: 0, imagesFailed: 0, overflowingPapers: 0, layoutStable: true };
  check("all checks pass -> ready", () => assert.deepEqual(R.evaluateReadiness(ready), { state: "ready" }));
  const cases: Array<[string, Record<string, unknown>, unknown]> = [
    ["no papers", { paperCount: 0 }, { state: "waiting", reason: "not_mounted" }],
    ["papers hidden (streaming segment)", { papersVisible: false }, { state: "waiting", reason: "not_mounted" }],
    ["loading screen on top", { obstructed: true }, { state: "waiting", reason: "obstructed" }],
    ["fonts loading", { fontsLoaded: false }, { state: "waiting", reason: "fonts" }],
    ["logo loading", { imagesPending: 1 }, { state: "waiting", reason: "images" }],
    ["layout moving", { layoutStable: false }, { state: "waiting", reason: "layout" }],
    ["logo failed", { imagesFailed: 1 }, { state: "blocked", reason: "asset_failed" }],
    ["logo failed while still obstructed", { imagesFailed: 1, obstructed: true }, { state: "blocked", reason: "asset_failed" }],
    ["paper overflows A4", { overflowingPapers: 1 }, { state: "blocked", reason: "layout_overflow" }],
  ];
  for (const [name, over, expected] of cases) check(`readiness: ${name}`, () => assert.deepEqual(R.evaluateReadiness({ ...ready, ...over }), expected));
  const readyState = { state: "ready" };
  const waiting = { state: "waiting", reason: "obstructed" };
  check("auto print when ready, once", () => {
    assert.equal(R.shouldAutoPrint({ readiness: readyState, alreadyAutoPrinted: false, timedOut: false, documentVisible: true }), true);
    assert.equal(R.shouldAutoPrint({ readiness: readyState, alreadyAutoPrinted: true, timedOut: false, documentVisible: true }), false);
  });
  check("no auto print while not ready", () => assert.equal(R.shouldAutoPrint({ readiness: waiting, alreadyAutoPrinted: false, timedOut: false, documentVisible: true }), false));
  check("no auto print after the ceiling", () => assert.equal(R.shouldAutoPrint({ readiness: readyState, alreadyAutoPrinted: false, timedOut: true, documentVisible: true }), false));
  check("no auto print in a background tab", () => assert.equal(R.shouldAutoPrint({ readiness: readyState, alreadyAutoPrinted: false, timedOut: false, documentVisible: false }), false));
  check("manual print only when ready", () => {
    assert.equal(R.canManuallyPrint(readyState), true);
    assert.equal(R.canManuallyPrint(waiting), false);
    assert.equal(R.canManuallyPrint({ state: "blocked", reason: "asset_failed" }), false);
  });
  check("messages", () => {
    assert.equal(R.statusMessage({ readiness: waiting, autoPrinted: false, timedOut: false }), R.READINESS_MESSAGES.waiting);
    assert.equal(R.statusMessage({ readiness: waiting, autoPrinted: false, timedOut: true }), R.READINESS_MESSAGES.timed_out);
    assert.equal(R.statusMessage({ readiness: readyState, autoPrinted: true, timedOut: false }), R.READINESS_MESSAGES.printed);
    assert.equal(R.statusMessage({ readiness: readyState, autoPrinted: false, timedOut: true }), R.READINESS_MESSAGES.ready);
    assert.equal(R.statusMessage({ readiness: { state: "blocked", reason: "layout_overflow" }, autoPrinted: false, timedOut: false }), R.READINESS_MESSAGES.layout_overflow);
  });
  check("ceiling is a ceiling, not a print trigger", () => assert.ok(R.READINESS_CAP_MS >= 10_000));
  return failures;
}

const base = await load(real, "real");
const failures = runAll(base);
rmSync(base.dir, { recursive: true, force: true });
for (const f of failures) console.log(`not ok - ${f}`);
assert.equal(failures.length, 0, `${failures.length} check(s) failed`);
console.log("ok - doc-print-layout: all checks passed");

if (process.argv.includes("--mutations")) {
  const mutations: Array<[string, (typeof FILES)[number], string, string]> = [
    ["DOC-3 revert to optimistic chars-per-line", "invoice-layout.ts", "item: 34, itemPackage: 40", "item: 68, itemPackage: 80"],
    ["DOC-3 ignore Bill To height", "invoice-layout.ts", "- billToHeight(input.billTo) -", "- 0 -"],
    ["DOC-3 ignore training section", "invoice-layout.ts", "(input.hasTraining ? TRAINING_SECTION : 0)", "0"],
    ["DOC-3 never break pages for items", "invoice-layout.ts", "if (!isEmpty(current()) && used + (current().items.length === 0 ? TABLE_OVERHEAD : 0) + h > capacity()) newPage();", ""],
    ["DOC-3 drop the last terms line", "invoice-layout.ts", "const chunk = remaining.slice(0, take);", "const chunk = remaining.slice(0, remaining.length <= take ? remaining.length - 1 : take);"],
    ["DOC-3 notes before payment instructions", "invoice-layout.ts", "  place({ kind: \"paymentInstructions\" });\n  const noteLines", "  const noteLines"],
    ["DOC-3 Bill To never flows", "invoice-layout.ts", "if (fullBillTo <= capacity()) {", "if (true) {"],
    ["DOC-3 Bill To flow drops lines", "invoice-layout.ts", "remaining = remaining.slice(take);\n      current().billTo = block;", "remaining = remaining.slice(take + 1);\n      current().billTo = block;"],
    ["DOC-3 ignore header height", "invoice-layout.ts", "(pageIndex === 0 ? HEADER_HEIGHT : CONTINUATION_HEADER_HEIGHT)", "0"],
    ["DOC-2 ignore loading screen", "print-readiness.ts", "if (s.obstructed) return", "if (false) return"],
    ["DOC-2 ignore fonts", "print-readiness.ts", "if (!s.fontsLoaded) return", "if (false) return"],
    ["DOC-2 ignore pending images", "print-readiness.ts", "if (s.imagesPending > 0) return", "if (false) return"],
    ["DOC-2 print with broken logo", "print-readiness.ts", "if (s.imagesFailed > 0) return { state: \"blocked\", reason: \"asset_failed\" };", ""],
    ["DOC-2 ignore layout stability", "print-readiness.ts", "if (!s.layoutStable) return", "if (false) return"],
    ["DOC-2 ignore A4 overflow", "print-readiness.ts", "if (s.overflowingPapers > 0) return", "if (false) return"],
    ["DOC-2 repeat auto print", "print-readiness.ts", "&& !input.alreadyAutoPrinted", ""],
    ["DOC-2 print on timeout", "print-readiness.ts", "&& !input.timedOut", ""],
    ["DOC-2 manual print bypasses checks", "print-readiness.ts", "return readiness.state === \"ready\";", "return true;"],
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
  console.log(`# doc-print-layout mutations: ${killed}/${mutations.length} killed`);
  assert.equal(killed, mutations.length, "every mutation must be killed");
}
