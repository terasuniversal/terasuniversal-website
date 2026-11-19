import assert from "node:assert/strict";
import {
  DEFAULT_SESSION_LOCALE,
  FEE_ENQUIRY_TEXT,
  FEE_UNIT,
  KIND_LABELS,
  confirmedFee,
  formatSessionDates,
  formatSessionFee,
  formatSessionTime,
  formatSessionVenue,
  kindLabels,
  seatsText,
  sessionKind,
  sessionText,
} from "../lib/session-display.ts";

// Contract for lib/session-display.ts (Phase S1). Synthetic inputs only: no database, network or page rendering.
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const base = { status: "open", capacity: 20, available_seats: 5, fee: 1500, registration_available: true };

// ---- Register / Full / Enquire policy ---------------------------------------
check("policy: server flag + positive fee + a seat is Register", () => assert.equal(sessionKind(base), "open"));
check("policy: no server flag is never Register", () => assert.equal(sessionKind({ ...base, registration_available: false }), "enquiry"));
check("policy: a zero fee is never Register (positive-fee-only)", () => assert.equal(sessionKind({ ...base, fee: 0 }), "enquiry"));
check("policy: a NULL fee is never Register", () => assert.equal(sessionKind({ ...base, fee: null }), "enquiry"));
check("policy: a negative fee is never Register", () => assert.equal(sessionKind({ ...base, fee: -10 }), "enquiry"));
check("policy: status full is Full even with the flag", () => assert.equal(sessionKind({ ...base, status: "full" }), "full"));
check("policy: no seat left is Full", () => assert.equal(sessionKind({ ...base, available_seats: 0 }), "full"));
check("policy: unknown capacity with no seat stays enquiry (no invented availability)", () =>
  assert.equal(sessionKind({ ...base, registration_available: false, capacity: 0, available_seats: 0 }), "enquiry"));
check("policy: the extra checks never grant Register without the flag", () =>
  assert.equal(sessionKind({ ...base, registration_available: false, fee: 99999, available_seats: 99 }), "enquiry"));

// ---- labels ------------------------------------------------------------------
check("labels: Register / Full / Enquire wording", () => {
  assert.equal(kindLabels("open").cta, "Register");
  assert.equal(kindLabels("full").pill, "Full");
  assert.equal(kindLabels("enquiry").cta, "Enquire about this session");
});
check("labels: ms-MY falls back to approved English until a translation is approved", () =>
  assert.deepEqual(sessionText("ms-MY"), sessionText("en-MY")));
check("labels: default locale is en-MY", () => assert.equal(DEFAULT_SESSION_LOCALE, "en-MY"));
check("labels: A3-compatible constants equal the A3 wording", () => {
  assert.equal(FEE_UNIT, "per participant");
  assert.equal(FEE_ENQUIRY_TEXT, "Fee to be confirmed");
  assert.deepEqual(KIND_LABELS, {
    open: { pill: "Registration open", cta: "Register" },
    enquiry: { pill: "Open for enquiry", cta: "Enquire about this session" },
    full: { pill: "Full", cta: "Ask about the next date" },
  });
});

// ---- fees: positive approved fees only ---------------------------------------
check("fee: RM 1,500 for 1500", () => assert.equal(formatSessionFee(1500), "RM 1,500"));
check("fee: RM 1,234.50 keeps two decimals", () => assert.equal(formatSessionFee(1234.5), "RM 1,234.50"));
check("fee: RM 0.01 minimum", () => assert.equal(formatSessionFee(0.01), "RM 0.01"));
check("fee: RM 1,000,000 grouping", () => assert.equal(formatSessionFee(1000000), "RM 1,000,000"));
check("fee: zero, null, undefined, negative, NaN, Infinity and strings are not prices", () => {
  for (const value of [0, null, undefined, -5, Number.NaN, Number.POSITIVE_INFINITY, "1500" as unknown as number]) {
    assert.equal(formatSessionFee(value), null);
    assert.equal(confirmedFee(value), null);
  }
});
check("fee: identical output for en-MY and ms-MY", () => assert.equal(formatSessionFee(2450.75, "ms-MY"), formatSessionFee(2450.75, "en-MY")));
check("fee: unit and enquiry text", () => {
  assert.equal(sessionText().feeUnit, "per participant");
  assert.equal(sessionText().feeEnquiry, "Fee to be confirmed");
});

// ---- dates: deterministic, no time zone ---------------------------------------
check("dates: single day", () => assert.equal(formatSessionDates("2026-12-02"), "2 Dec 2026"));
check("dates: same end as start is a single day", () => assert.equal(formatSessionDates("2026-12-02", "2026-12-02"), "2 Dec 2026"));
check("dates: same month range", () => assert.equal(formatSessionDates("2026-11-15", "2026-11-16"), "15–16 Nov 2026"));
check("dates: cross-month range", () => assert.equal(formatSessionDates("2026-11-30", "2026-12-02"), "30 Nov – 2 Dec 2026"));
check("dates: cross-year range", () => assert.equal(formatSessionDates("2026-12-30", "2027-01-02"), "30 Dec 2026 – 2 Jan 2027"));
check("dates: ms-MY month names", () => assert.equal(formatSessionDates("2026-08-03", "2026-12-04", "ms-MY"), "3 Ogo – 4 Dis 2026"));
check("dates: unchanged under a different process time zone", () => {
  const before = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";
  const shifted = formatSessionDates("2026-01-01", "2026-01-02");
  process.env.TZ = "America/Adak";
  const shiftedBack = formatSessionDates("2026-01-01", "2026-01-02");
  process.env.TZ = before;
  assert.equal(shifted, "1–2 Jan 2026");
  assert.equal(shiftedBack, "1–2 Jan 2026");
});

// ---- time, venue, seats ---------------------------------------------------------
check("time: 08:30:00 is 8:30 am, 13:05 is 1:05 pm, 00:00 is 12:00 am", () => {
  assert.equal(formatSessionTime("08:30:00"), "8:30 am");
  assert.equal(formatSessionTime("13:05"), "1:05 pm");
  assert.equal(formatSessionTime("00:00:00"), "12:00 am");
});
check("time: missing or invalid time is null", () => {
  assert.equal(formatSessionTime(null), null);
  assert.equal(formatSessionTime(""), null);
  assert.equal(formatSessionTime("ab:cd"), null);
});
check("venue: recorded mode and venue are shown as given", () =>
  assert.equal(formatSessionVenue({ delivery_mode: "Public", venue: "TERAS Training Centre, Jitra" }), "Public · TERAS Training Centre, Jitra"));
check("venue: nothing recorded shows 'Venue to be confirmed', never an invented venue", () =>
  assert.equal(formatSessionVenue({ delivery_mode: null, venue: null }), "Venue to be confirmed"));
check("seats: counts only for open sessions; full and enquiry never quote a number", () => {
  assert.equal(seatsText({ available_seats: 1 }, "open"), "1 seat available");
  assert.equal(seatsText({ available_seats: 7 }, "open"), "7 seats available");
  assert.equal(seatsText({ available_seats: 7 }, "enquiry"), "Confirmed on enquiry");
  assert.equal(seatsText({ available_seats: 0 }, "full"), "Fully booked");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
