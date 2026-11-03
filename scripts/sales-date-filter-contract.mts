import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Sales Phase 4B Slice 4: the From/To date filters on the Leads list, the Leads
// CSV export and the Opportunities list mean Malaysia calendar days. They used
// to compare `created_at` against the raw string as if it were UTC, which
// dropped the first 8 hours of the From day and kept 8 hours of the day after To.

const { mytDateFilterBounds, resolveReportDateRange } = await import("../lib/sales/reports.ts");

const MYT_HOURS = 8;

// 1. One day: the whole Malaysia day, as a half-open UTC interval.
assert.deepEqual(mytDateFilterBounds("2026-11-03", "2026-11-03"), {
  gte: "2026-11-02T16:00:00.000Z",
  lt: "2026-11-03T16:00:00.000Z",
});

// 2. Against the old predicate, on the three instants that mattered.
// The old code passed the strings straight to the database, whose session timezone on Supabase is UTC:
// created_at >= '2026-11-03' and created_at <= '2026-11-03T23:59:59'. Written out with an explicit Z.
const oldPredicate = (createdUtc: string, from: string, to: string) =>
  Date.parse(createdUtc) >= Date.parse(`${from}T00:00:00Z`) && Date.parse(createdUtc) <= Date.parse(`${to}T23:59:59Z`);
const newPredicate = (createdUtc: string, from: string, to: string) => {
  const { gte, lt } = mytDateFilterBounds(from, to);
  return Date.parse(createdUtc) >= Date.parse(gte!) && Date.parse(createdUtc) < Date.parse(lt!);
};
const day = ["2026-11-03", "2026-11-03"] as const;
// 00:00 MYT on 3 Nov: a lead created at the very start of the day. The old filter lost it.
assert.equal(oldPredicate("2026-11-02T16:00:00.000Z", ...day), false, "old filter dropped the start of the From day");
assert.equal(newPredicate("2026-11-02T16:00:00.000Z", ...day), true, "new filter keeps it");
// 07:59 MYT on 3 Nov: still lost by the old filter.
assert.equal(oldPredicate("2026-11-02T23:59:00.000Z", ...day), false);
assert.equal(newPredicate("2026-11-02T23:59:00.000Z", ...day), true);
// 23:59:59 MYT on 3 Nov: the last second of the day is in for both.
assert.equal(oldPredicate("2026-11-03T15:59:59.000Z", ...day), true);
assert.equal(newPredicate("2026-11-03T15:59:59.000Z", ...day), true);
// 23:59:59.999 MYT: the old to-bound ("T23:59:59") would have cut a millisecond tail; the half-open end does not.
assert.equal(newPredicate("2026-11-03T15:59:59.999Z", ...day), true);
// 00:00 MYT on 4 Nov: belongs to the NEXT day. The old filter wrongly kept it.
assert.equal(oldPredicate("2026-11-03T16:00:00.000Z", ...day), true, "old filter leaked the next day's first 8 hours");
assert.equal(newPredicate("2026-11-03T16:00:00.000Z", ...day), false, "new filter excludes it");

// 3. Calendar edges: month end, year end, leap day, non-leap February.
assert.equal(mytDateFilterBounds(undefined, "2026-11-30").lt, "2026-11-30T16:00:00.000Z");
assert.equal(mytDateFilterBounds(undefined, "2026-12-31").lt, "2026-12-31T16:00:00.000Z", "year end rolls into 1 Jan MYT midnight");
assert.equal(mytDateFilterBounds(undefined, "2028-02-29").lt, "2028-02-29T16:00:00.000Z", "leap day is a real day");
assert.equal(mytDateFilterBounds(undefined, "2027-02-28").lt, "2027-02-28T16:00:00.000Z", "28 Feb rolls into 1 Mar");
assert.equal(mytDateFilterBounds("2026-01-01").gte, "2025-12-31T16:00:00.000Z", "1 Jan starts on 31 Dec UTC");

// 4. Missing bounds are simply absent; padded input is trimmed like the Reports range.
assert.deepEqual(mytDateFilterBounds(), {});
assert.deepEqual(mytDateFilterBounds(null, null), {});
assert.deepEqual(mytDateFilterBounds("", ""), {});
assert.deepEqual(mytDateFilterBounds("2026-11-03"), { gte: "2026-11-02T16:00:00.000Z" });
assert.deepEqual(mytDateFilterBounds(undefined, "2026-11-03"), { lt: "2026-11-03T16:00:00.000Z" });
assert.deepEqual(mytDateFilterBounds("  2026-11-03 ", null), { gte: "2026-11-02T16:00:00.000Z" });

// 5. Anything that is not a real YYYY-MM-DD date is ignored, never passed to the database.
const notDates = [
  "2026-02-31", "2026-02-29", "2027-02-29", "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-32", "2026-04-31",
  "garbage", "2026-1-5", "26-11-03", "2026/11/03", "11-03-2026", "2026-11-03T23:59:59", "2026-11-03 10:00", "2026-11-03; drop table x",
  "2026-11-03Z", "０２６-11-03", "+2026-11-03", "NaN", "null", "undefined", "2026-11-03\n2026-11-04",
];
for (const bad of notDates) {
  assert.deepEqual(mytDateFilterBounds(bad, bad), {}, `ignored: ${JSON.stringify(bad)}`);
  assert.deepEqual(mytDateFilterBounds(bad, "2026-11-03"), { lt: "2026-11-03T16:00:00.000Z" }, `a bad From does not disturb To: ${JSON.stringify(bad)}`);
}
assert.deepEqual(mytDateFilterBounds("2026-02-31", "2026-02-28"), { lt: "2026-02-28T16:00:00.000Z" }, "an impossible date is not rolled into March");

// 5a. Supported years are 1970 to 2200. Date.UTC reads years 0-99 as 1900-1999, so earlier years are refused
//     outright instead of being validated against the wrong century.
for (const early of ["0000-01-01", "0001-01-01", "0099-01-01", "0099-12-31", "1969-12-31", "1899-06-15"]) {
  assert.deepEqual(mytDateFilterBounds(early, early), {}, `year out of range is ignored: ${early}`);
}
for (const late of ["2201-01-01", "9999-12-31"]) assert.deepEqual(mytDateFilterBounds(late, late), {}, `year out of range is ignored: ${late}`);
assert.deepEqual(mytDateFilterBounds("1970-01-01", "1970-01-01"), { gte: "1969-12-31T16:00:00.000Z", lt: "1970-01-01T16:00:00.000Z" }, "the first supported day");
assert.deepEqual(mytDateFilterBounds("2200-12-31", "2200-12-31"), { gte: "2200-12-30T16:00:00.000Z", lt: "2200-12-31T16:00:00.000Z" }, "the last supported day");

// 5b. A repeated query key (?from=a&from=b) reaches the page as an array, and other junk can arrive too:
//     none of it may throw, and none of it becomes a bound.
const notStrings: unknown[] = [["2026-11-03"], ["2026-11-03", "2026-11-04"], [], 20261103, 0, true, false, {}, { toString: () => "2026-11-03" }, Symbol.for("x"), () => "2026-11-03"];
for (const junk of notStrings) {
  assert.doesNotThrow(() => mytDateFilterBounds(junk, junk), `does not throw on ${String(typeof junk)}`);
  assert.deepEqual(mytDateFilterBounds(junk, junk), {}, `ignored: ${typeof junk}`);
  assert.deepEqual(mytDateFilterBounds(junk, "2026-11-03"), { lt: "2026-11-03T16:00:00.000Z" }, `a junk From does not disturb To: ${typeof junk}`);
}

// 6. Four years of days: each bound is a Malaysia midnight, each day is exactly 24 hours, and consecutive days
//    touch with no gap and no overlap, so no lead can fall between two day filters or into two.
const dayMs = 24 * 60 * 60 * 1000;
let previousEnd: number | null = null;
let days = 0;
for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2029, 11, 31); t += dayMs) {
  const key = new Date(t).toISOString().slice(0, 10);
  const { gte, lt } = mytDateFilterBounds(key, key);
  const start = Date.parse(gte!);
  const end = Date.parse(lt!);
  assert.equal(end - start, dayMs, `${key} is exactly 24 hours`);
  assert.equal(new Date(start + MYT_HOURS * 3600_000).toISOString().slice(11), "00:00:00.000Z", `${key} starts at Malaysia midnight`);
  assert.match(gte!, /Z$/);
  if (previousEnd !== null) assert.equal(start, previousEnd, `${key} starts exactly where the previous day ended`);
  previousEnd = end;
  days++;
}
assert.equal(days, 1461, "2026 to 2029 inclusive");

// 7. Independent of the server's own timezone.
const reference = mytDateFilterBounds("2026-11-03", "2026-11-05");
const originalTz = process.env.TZ;
for (const tz of ["UTC", "America/Los_Angeles", "Asia/Kuala_Lumpur", "Pacific/Auckland", "Asia/Kolkata"]) {
  process.env.TZ = tz;
  assert.deepEqual(mytDateFilterBounds("2026-11-03", "2026-11-05"), reference, `same bounds under TZ=${tz}`);
}
if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;

// 8. The lists agree with the Reports range on what a day is.
for (const [from, to] of [["2026-11-03", "2026-11-03"], ["2026-10-01", "2026-10-31"], ["2026-12-30", "2027-01-02"], ["2028-02-28", "2028-03-01"]]) {
  const bounds = mytDateFilterBounds(from, to);
  const report = resolveReportDateRange("custom", { from, to });
  assert.equal(report.key, "custom");
  assert.equal(bounds.gte, report.startUtc, `list From ${from} matches the report start`);
  assert.equal(bounds.lt, report.endUtc, `list To ${to} matches the report end`);
}

// 9. Wiring: all three call sites use the helper, none passes the raw string or an inline UTC day end.
const read = (file: string) => readFile(file, "utf8");
const [leads, opportunities, exportRoute, reportsLib] = await Promise.all([
  read("app/admin/(protected)/sales/leads/page.tsx"),
  read("app/admin/(protected)/sales/opportunities/page.tsx"),
  read("app/admin/(protected)/sales/leads/export/route.ts"),
  read("lib/sales/reports.ts"),
]);
for (const [name, source, from, to] of [
  ["leads page", leads, "sp.from", "sp.to"],
  ["opportunities page", opportunities, "sp.from", "sp.to"],
  ["leads export", exportRoute, 'p.get("from")', 'p.get("to")'],
] as const) {
  assert.ok(source.includes(`mytDateFilterBounds(${from}, ${to})`), `${name} builds its bounds with the helper`);
  assert.match(source, /if \(createdBounds\.gte\) query = query\.gte\("created_at", createdBounds\.gte\);/, `${name} applies the start bound`);
  assert.match(source, /if \(createdBounds\.lt\) query = query\.lt\("created_at", createdBounds\.lt\);/, `${name} applies the exclusive end bound`);
  assert.ok(!source.includes("T23:59:59"), `${name} has no inline UTC day end`);
  assert.ok(!/\.gte\("created_at", (sp\.from|p\.get\("from"\))/.test(source), `${name} never passes the raw From string`);
  // (The leads page keeps an unrelated .lte("created_at", boundary) for its lead-age buckets, so only the To value is checked.)
  assert.ok(!/\.lte\("created_at",\s*(`\$\{)?(sp\.to|p\.get\("to"\))/.test(source), `${name} no longer builds an inclusive end from the To value`);
}
assert.match(reportsLib, /export function mytDateFilterBounds/, "the helper lives next to the Reports range code it mirrors");

// 10. Nothing else about those routes changed: guards stay in place.
for (const source of [leads, opportunities]) {
  assert.match(source, /requireRole\("editor"\)/, "page guard intact");
  assert.match(source, /requireModuleAccess\("sales_(leads|opportunities)"\)/, "module guard intact");
}
assert.match(exportRoute, /!isEditor\(profile\.role\)\) return new NextResponse\("Forbidden", \{ status: 403 \}\)/, "export guard intact");
assert.match(exportRoute, /hasModuleAccess\("sales_leads"\)/, "export module guard intact");
assert.match(exportRoute, /csvCell\(get\(r, staffNames\)/, "the export still escapes cells with csvCell");

console.log(`Sales date filter contract passed (${days} days, ${notDates.length} invalid inputs).`);
