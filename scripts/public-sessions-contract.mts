import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeSession, formatSessionDay } from "../lib/session-display.ts";

// Contract for Phase S3 (public sessions integration): one shared session policy for the homepage "Next public sessions",
// the training calendar and the course-page session cards. Synthetic sessions only; no database, network or form submission.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// data/courseCatalog.js imports a TypeScript module without an extension, which plain Node cannot resolve, so the catalogue
// slugs and durations are read from its source text (the same approach as scripts/home-content-contract.mts).
const courseCatalog = [...read("data/courseCatalog.js").matchAll(/slug: "([^"]+)"[\s\S]*?duration: "([^"]+)"/g)].map(([, slug, duration]) => ({ slug, duration }));
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const base = { id: "s-1", start_date: "2026-11-24", end_date: "2026-11-25", start_time: "08:30:00", venue: "TERAS Training Centre, Jitra", delivery_mode: "Public", status: "open", capacity: 20, available_seats: 6, fee: 950 as number | null, registration_available: true };

// ---- scenarios ----------------------------------------------------------------
check("open + approved positive fee: Register to /registration/<id>, price and seats shown", () => {
  const v = describeSession(base);
  assert.equal(v.state, "open");
  assert.deepEqual([v.action.type, v.action.type === "register" && v.action.href, v.action.label], ["register", "/registration/s-1", "Register"]);
  assert.equal(v.feeText, "RM 950 per participant");
  assert.equal(v.seatsText, "6 seats available");
  assert.equal(v.statusLabel, "Registration open");
});
check("full by status: Full, no Register, no seat number", () => {
  const v = describeSession({ ...base, status: "full", registration_available: false, available_seats: 0 });
  assert.deepEqual([v.state, v.statusLabel, v.action.type, v.action.label, v.seatsText], ["full", "Full", "enquire", "Ask about the next date", "Fully booked"]);
});
check("full by seats with a stale server flag: still Full", () => {
  assert.equal(describeSession({ ...base, available_seats: 0 }).state, "full");
});
check("enquiry-only (no server flag): Enquire, seats confirmed on enquiry", () => {
  const v = describeSession({ ...base, registration_available: false });
  assert.deepEqual([v.state, v.action.type, v.action.label, v.action.shortLabel, v.seatsText], ["enquiry", "enquire", "Enquire about this session", "Enquire", "Confirmed on enquiry"]);
});
check("missing or unapproved fee: never a price, never Register", () => {
  for (const fee of [null, 0, -1]) {
    const v = describeSession({ ...base, fee });
    assert.equal(v.feeAmount, null, String(fee));
    assert.equal(v.feeText, "Fee to be confirmed");
    assert.equal(v.feeShort, "To be confirmed");
    assert.notEqual(v.action.type, "register");
  }
});
check("venue not confirmed: 'Venue to be confirmed', flagged as unconfirmed", () => {
  const v = describeSession({ ...base, venue: null, delivery_mode: null });
  assert.equal(v.venueText, "Venue to be confirmed");
  assert.equal(v.venueConfirmed, false);
});
check("cancelled, completed, in-progress and past sessions are closed and never offer Register or Enquire", () => {
  for (const status of ["cancelled", "completed", "in_progress"]) {
    const v = describeSession({ ...base, status });
    assert.equal(v.state, "closed", status);
    assert.equal(v.action.type, "details", status);
  }
  const past = describeSession({ ...base, start_date: "2026-10-01", end_date: "2026-10-02" }, { today: "2026-11-07" });
  assert.deepEqual([past.state, past.statusLabel, past.action.type], ["closed", "Past session", "details"]);
});
check("status keys: one styling key per state, shared by the calendar and course cards", () => {
  assert.deepEqual(["cancelled", "completed", "in_progress"].map((status) => describeSession({ ...base, status }).statusKey), ["cancelled", "completed", "in_progress"]);
  assert.equal(describeSession({ ...base, start_date: "2026-10-01" }, { today: "2026-11-07" }).statusKey, "completed");
  assert.equal(describeSession({ ...base, registration_available: false }).statusKey, "enquiry");
  // Since S4A (calendar) and S4B (course cards, moved to components/course/CourseSessions.tsx) both use local module pill
  // classes for at least 4.5:1 contrast; both take the key from the policy.
  for (const path of ["components/TrainingCalendar.js", "components/course/CourseSessions.tsx"]) assert.match(read(path), /styles\[`pill_\$\{view\.statusKey\}`\]/, path);
});
check("dates: one calendar-date format everywhere (en-MY, no time-zone drift)", () => {
  const v = describeSession(base);
  assert.equal(v.dateText, "24–25 Nov 2026");
  assert.equal(v.dayText, "24 Nov");
  assert.equal(v.timeText, "8:30 am");
  assert.equal(formatSessionDay("2026-12-02", "ms-MY"), "2 Dis");
});

// ---- one policy, three pages ----------------------------------------------------
const calendar = read("components/TrainingCalendar.js");
// Phase S4B: the course-page session cards moved from components/public/CourseScheduleOptions.tsx to here.
const options = read("components/course/CourseSessions.tsx");
const homepage = read("app/page.js");
const homeSessions = read("components/home/UpcomingDates.js");
check("consistency: homepage, calendar and course cards all call describeSession()", () => {
  for (const [name, source] of [["homepage", homepage], ["calendar", calendar], ["course cards", options]] as const) assert.match(source, /describeSession\(session/, name);
});
check("consistency: no page keeps its own fee formatter, date formatter, status labels or venue fallback", () => {
  for (const [name, source] of [["homepage", homepage], ["calendar session list", calendar.split("function MonthView")[0]], ["course cards", options], ["homepage sessions", homeSessions]] as const) {
    assert.doesNotMatch(source, /Intl\.NumberFormat|const feeLabel|const formatMoney|STATUS_LABELS|statusLabels|scheduleStatusLabel/, name);
    assert.doesNotMatch(source, /"Venue to be confirmed"/, name);
    assert.doesNotMatch(source, /Intl\.DateTimeFormat/, name);
  }
});
check("consistency: enquiry links use the existing enquiryHref() (one URL format)", () => {
  for (const [name, source] of [["homepage", homepage], ["calendar", calendar], ["course cards", options]] as const) assert.match(source, /enquiryHref\(\{ course:/, name);
});
check("consistency: the course page Register buttons use sessionKind()", () =>
  assert.match(read("app/training/[slug]/page.js"), /sessionKind\(session\) === "open"/));

// ---- homepage section --------------------------------------------------------------
check("homepage: the existing schedule function is used and the list is not extended beyond its three rows", () => {
  assert.match(homepage, /const upcomingSchedules = await getUpcomingSchedules\(\);/);
  assert.match(read("lib/public-content.ts"), /\.map\(mapSchedule\)\.slice\(0, 3\)/);
});
// Phase S4B: the mapping and the duration rule moved to lib/course-session-map.ts (equivalence proven by
// scripts/course-session-map-contract.mts); the homepage now calls them.
check("homepage: course mapping keeps the CRM identity first, then the catalogue slug", () => {
  const mapping = read("lib/course-session-map.ts");
  assert.match(mapping, /course\.crmCourseId && course\.crmCourseId === session\.course_id/);
  assert.match(mapping, /course\.slug === session\.slug/);
  assert.match(homepage, /catalogueCourseForSession\(session, courseCatalog\)/);
  assert.match(homepage, /courseHref: scheduleSlug \? `\/training\/\$\{scheduleSlug\}` : null/);
});
check("homepage: the duration is the catalogue's own 'N Days' value only", () => {
  assert.match(read("lib/course-session-map.ts"), /\/\^\\d\+\\s\+Days\?\$\/i\.test\(course\.duration\) \? course\.duration : null/);
  assert.match(homepage, /duration: catalogueDurationText\(course\)/);
  assert.equal(courseCatalog.find((course) => course.slug === "working-at-height")?.duration, "2 Days");
});
check("homepage: the section keeps the Register/hero anchor, the calendar link and the corporate pathway", () => {
  assert.match(homeSessions, /id="upcoming-training"/);
  assert.match(homeSessions, /sessions\.viewAll\.href/);
  assert.match(homeSessions, /sessions\.corporateLink\.href/);
});
check("homepage: no upcoming session shows the empty state (no invented dates)", () => {
  assert.match(homeSessions, /rows\.length > 0 \?/);
  assert.match(homeSessions, /sessions\.empty\.title/);
});
check("homepage: every action has an accessible name with course and date", () => {
  assert.match(homepage, /actionAria: `\$\{view\.action\.label\}: \$\{session\.title\}, \$\{view\.dateText\}`/);
  assert.match(homeSessions, /aria-label=\{row\.actionAria\}/);
});

// ---- fail-closed states kept --------------------------------------------------------
check("fail-closed: the calendar and course pages keep their 'temporarily unavailable' state", () => {
  // Since S4A the calendar's copy lives in content/en/calendar.js; the error branch still comes first and is an alert.
  assert.match(calendar, /loadError \? \(\s*<StateBox state=\{calendarContent\.states\.unavailable\} alert \/>/);
  assert.match(read("content/en/calendar.js"), /unavailable: \{ title: "Training dates are temporarily unavailable\."/);
  assert.match(options, /if \(loadError\) return/);
});
check("fail-closed: getUpcomingSchedules still degrades to an empty list on error", () => {
  const source = read("lib/public-content.ts");
  // W7-a (owner-approved): the cached loader throws, so a failure is never cached; the wrapper still returns [].
  assert.match(source, /p_include_past: false \}\);\s*if \(error\) throw new PublicScheduleLoadError\(error\.code\);/);
  assert.match(source, /export async function getUpcomingSchedules\(\): Promise<PublicSchedule\[\]> \{\s*try \{\s*return await loadUpcomingSchedules\(\);\s*\} catch \(error\) \{[\s\S]*?return \[\];\s*\}\s*\}/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
