import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Sales Phase 4B Slice 2: lead fields typed by the public must not run as
// spreadsheet formulas when staff open the Leads CSV export.

const { csvCell, isFormulaRisk } = await import("../lib/csv.ts");

// Minimal RFC 4180 reader for ONE cell, to check a cell survives a round trip.
function readCell(cell: string): string {
  return cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2 ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

// 1. Formula starters are neutralised, as the spreadsheet will read them.
const attacks = [
  "=1+1", "=HYPERLINK(\"http://evil.example\",\"x\")", "@SUM(1+1)", "+cmd|' /C calc'!A0", "-2+3", "+1+1", "-1+1",
  "\t=1+1", "\r=1+1", " =1+1", "  @SUM(1)", "\n=1+1", " =1+1", "​=1+1", "﻿=1+1", "\u0001=1+1", " +1+1",
];
for (const attack of attacks) {
  const out = readCell(csvCell(attack));
  assert.ok(out.startsWith("'"), `neutralised: ${JSON.stringify(attack)} -> ${JSON.stringify(out)}`);
  assert.equal(out, `'${attack}`, "the original text is kept after the quote");
}

// 2. Ordinary text is left exactly as it was.
for (const plain of ["Ahmad bin Ali", "TERAS UNIVERSAL SDN. BHD.", "ahmad@example.com", "Jalan Tanah Merah 1/2", "1 Nov 2026", "R&D", "a=b", "x+y", "it's fine", "'already quoted", "Hot — warm", "ＳＵＭ", "＝1+1", ""]) {
  assert.equal(readCell(csvCell(plain)), plain, `unchanged: ${plain}`);
}

// 3. Phone numbers: the Phone column keeps phone-shaped values; nothing else gets the exception.
for (const phone of ["+60 19-519 3834", "+60195193834", "+6 (012) 345-6789", "+65 6123 4567"]) {
  assert.equal(readCell(csvCell(phone, { phone: true })), phone, `phone kept: ${phone}`);
  assert.ok(readCell(csvCell(phone)).startsWith("'"), `same value elsewhere is neutralised: ${phone}`);
}
for (const notPhone of ["+1+1", "+cmd|' /C calc'!A0", "-123-4", "+60", "+60 19-519 3834 =1", " +60 19-519 3834", "+=1+1", "+60;ls", "-60 19-519 3834"]) {
  assert.ok(readCell(csvCell(notPhone, { phone: true })).startsWith("'"), `not an exception even in Phone: ${JSON.stringify(notPhone)}`);
}
assert.equal(readCell(csvCell("0195193834", { phone: true })), "0195193834", "a local number is unchanged");

// 4. RFC 4180 structure: commas, quotes, CR and LF force quoting; quotes are doubled.
assert.equal(csvCell("a,b"), '"a,b"');
assert.equal(csvCell('say "hi"'), '"say ""hi"""');
assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
assert.equal(csvCell("line1\rline2"), '"line1\rline2"', "a bare carriage return is quoted too");
assert.equal(csvCell("=A,B"), `"'=A,B"`, "a formula that also needs quoting gets both");
assert.equal(csvCell(null), "");
assert.equal(csvCell(undefined), "");
assert.equal(csvCell(0), "0");

// 5. Exhaustive property check over every string up to length 4 from a hostile alphabet.
const alphabet = ["=", "+", "-", "@", " ", "\t", "\r", "\n", "'", '"', ",", "a", "1"];
let checked = 0;
function* strings(max: number): Generator<string> {
  yield "";
  let frontier = [""];
  for (let length = 1; length <= max; length++) {
    const next: string[] = [];
    for (const prefix of frontier) for (const ch of alphabet) next.push(prefix + ch);
    for (const s of next) yield s;
    frontier = next;
  }
}
for (const s of strings(4)) {
  for (const phone of [false, true]) {
    const cell = csvCell(s, { phone });
    const out = readCell(cell);
    checked++;
    if (isFormulaRisk(s, { phone })) assert.equal(out, `'${s}`, `risk -> quoted: ${JSON.stringify(s)}`);
    else assert.equal(out, s, `safe -> unchanged: ${JSON.stringify(s)}`);
    // The invariant the whole slice exists for: the exported cell never starts as a formula.
    const exported = out.replace(/^[\s\u0000-\u001f\u007f ​-‍⁠﻿]+/, "");
    assert.ok(!/^[=@]/.test(exported) && out[0] !== "\t" && out[0] !== "\r", `no formula start: ${JSON.stringify(s)}`);
    if (!phone) assert.ok(!/^[+-]/.test(exported), `no sign start outside Phone: ${JSON.stringify(s)}`);
    // A cell never splits a row: without quoting it has no separator or line break.
    if (!cell.startsWith('"')) assert.ok(!/[",\r\n]/.test(cell), `unquoted cell is atomic: ${JSON.stringify(s)}`);
  }
}
// 13 characters, lengths 0 to 4: 30,941 strings, each checked in both modes.
assert.equal(checked, 2 * (1 + 13 + 13 ** 2 + 13 ** 3 + 13 ** 4), "the property check covered every generated cell");

// 5b. The phone exception is never reachable by the strings above (it needs 8+ characters), so
//     cover it directly: any leading whitespace, control or zero-width character removes it.
const noise = [" ", "  ", " ", "​", "‌", "‍", "⁠", "﻿", "\u0001", "\u001f", "\u007f", "\n", "\t", "\r", "\r\n", " \t "];
const phoneBodies = ["+1234567", "+60 19-519 3834", "+6 (012) 345-6789", "+65-6123-4567", "+1 (555) 010-9999"];
const phoneTails = ["", "=1", ";x", "|calc", " +1", "\n", "+1"];
let phoneChecked = 0;
for (const body of phoneBodies) {
  assert.equal(isFormulaRisk(body, { phone: true }), false, `plain phone is kept: ${body}`);
  assert.equal(readCell(csvCell(body, { phone: true })), body);
  for (const lead of noise) {
    for (const tail of phoneTails) {
      const value = lead + body + tail;
      const out = readCell(csvCell(value, { phone: true }));
      phoneChecked++;
      assert.equal(out, `'${value}`, `noise-prefixed phone-shaped value is neutralised: ${JSON.stringify(value)}`);
    }
  }
  for (const tail of phoneTails.filter((t) => t !== "")) {
    assert.ok(readCell(csvCell(body + tail, { phone: true })).startsWith("'"), `phone with a hostile tail is neutralised: ${JSON.stringify(body + tail)}`);
  }
}
assert.ok(phoneChecked >= 500, `phone exception cases covered: ${phoneChecked}`);

// 5c. Whole rows: a reader for complete CSV text (multiline and quoted fields), so structure is
//     checked across cells and records, not one cell at a time.
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const hostile = ["=1+1", "+1+1", "-2", "@SUM(1)", "\t=1", "\r=1", "a,b", 'say "hi"', "l1\nl2", "l1\r\nl2", "\n=1+1", "plain", "", "'q", " =1", "+60 19-519 3834"];
const columns = ["Source", "Contact", "Company", "Email", "Phone", "Status", "Assigned To", "Follow-up", "Created At"];
const rowsOut: string[][] = [];
let seed = 7;
const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
const lines = [columns.join(",")];
for (let r = 0; r < 400; r++) {
  const values = columns.map(() => hostile[next() % hostile.length]);
  rowsOut.push(values);
  lines.push(values.map((v, c) => csvCell(v, { phone: columns[c] === "Phone" })).join(","));
}
const parsed = readCsv(lines.join("\n"));
assert.equal(parsed.length, 401, "one header row plus 400 records, none split or merged");
assert.deepEqual(parsed[0], columns, "header is intact");
parsed.slice(1).forEach((cells, r) => {
  assert.equal(cells.length, columns.length, `record ${r} keeps ${columns.length} columns`);
  cells.forEach((cell, c) => {
    const original = rowsOut[r][c];
    const risky = isFormulaRisk(original, { phone: columns[c] === "Phone" });
    assert.equal(cell, risky ? `'${original}` : original, `record ${r} column ${columns[c]} round-trips`);
  });
});

// 6. The route uses the helper, only the Phone column gets the phone exception, and nothing else moved.
const route = await readFile("app/admin/(protected)/sales/leads/export/route.ts", "utf8");
assert.match(route, /import \{ csvCell \} from "[./]*lib\/csv"/, "route imports the shared helper");
assert.ok(!/const esc\s*=/.test(route), "the old unsafe escaper is gone");
assert.match(route, /csvCell\(get\(r, staffNames\), \{ phone: label === "Phone" \}\)/, "phone exception is limited to the Phone column");
assert.equal((route.match(/phone:/g) ?? []).length, 1, "phone exception is passed in exactly one place");
assert.match(route, /COLUMNS\.map\(\(\[label\]\) => label\)\.join\(","\)/, "header row is unchanged");
assert.ok(route.includes('new NextResponse("﻿" + csv'), "UTF-8 BOM is kept");
assert.match(route, /"Content-Type": "text\/csv; charset=utf-8"/, "content type is unchanged");
assert.match(route, /\.limit\(5000\)/, "row cap is unchanged");
assert.match(route, /!isEditor\(profile\.role\)\) return new NextResponse\("Forbidden", \{ status: 403 \}\)/, "editor guard is intact");
assert.match(route, /hasModuleAccess\("sales_leads"\)/, "module guard is intact");
assert.match(route, /p_action: "export"/, "the export is still audit-logged");
assert.ok(!/\.gte\("created_at"[^)]*\)[\s\S]*Malaysia/.test(route), "date bounds are out of scope and untouched");
assert.match(route, /query\.lte\("created_at", `\$\{p\.get\("to"\)\}T23:59:59`\)/, "date filter is unchanged (separate slice)");

console.log(`Sales CSV export safety contract passed (${checked} generated cases).`);
