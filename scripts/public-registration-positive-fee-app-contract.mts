import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicErrorMessage } from "../lib/public-registration.ts";
import { FEE_ENQUIRY_TEXT, FEE_UNIT, confirmedFee, formatSessionFee, sessionKind } from "../lib/session-display.ts";
import { fieldErrors, scheduleSchema } from "../lib/validation/schemas.ts";

// Application-side contract for the positive-fee-only registration policy:
// fee > 0 may be registered online; fee = 0 and fee = NULL are enquiry only.
// Synthetic inputs only; no database, network or form submission.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// ---- PublicRegistrationFlow: evaluate the exact guard expression ------------
const flow = read("components/public/PublicRegistrationFlow.tsx");
const guard = /const unavailable = ([^;]+);/.exec(flow)?.[1];
check("flow: guard expression is present", () => assert.ok(guard));
const unavailable = (schedule: Record<string, unknown>): boolean =>
  new Function("schedule", `return ${guard};`)(schedule) as boolean;
const open = { registration_available: true, available_seats: 8 };
check("flow: fee NULL is unavailable", () => assert.equal(unavailable({ ...open, fee: null }), true));
check("flow: fee undefined is unavailable", () => assert.equal(unavailable({ ...open, fee: undefined }), true));
check("flow: fee 0 is unavailable", () => assert.equal(unavailable({ ...open, fee: 0 }), true));
check("flow: negative fee is unavailable", () => assert.equal(unavailable({ ...open, fee: -1 }), true));
check("flow: numeric string fee is unavailable (contract is numeric)", () => assert.equal(unavailable({ ...open, fee: "1500" }), true));
check("flow: minimum positive fee 0.01 proceeds", () => assert.equal(unavailable({ ...open, fee: 0.01 }), false));
check("flow: normal positive fee proceeds", () => assert.equal(unavailable({ ...open, fee: 1500 }), false));
check("flow: server flag false is unavailable even with a fee", () => assert.equal(unavailable({ ...open, fee: 1500, registration_available: false }), true));
check("flow: no seats is unavailable even with a fee", () => assert.equal(unavailable({ ...open, fee: 1500, available_seats: 0 }), true));
check("flow: unavailable state offers the calendar, not a registration form", () => {
  assert.match(flow, /if \(unavailable\) return <section className="registration-state"/);
  assert.match(flow, /View Training Calendar/);
});

// ---- Direct registration URL ------------------------------------------------
const page = read("app/registration/[scheduleId]/page.tsx");
check("direct URL: the page renders the flow for any published schedule, so the flow guard applies", () => {
  assert.match(page, /<PublicRegistrationFlow schedule=\{schedule\} \/>/);
  assert.match(page, /if \(!schedule\) notFound\(\);/);
});

// ---- API error mapping ------------------------------------------------------
const route = read("app/api/registration/route.ts");
check("api: schedule_unavailable maps to a safe public message", () => {
  const message = publicErrorMessage(new Error("schedule_unavailable"));
  assert.equal(message, "This training session is no longer available for registration.");
});
check("api: the public message exposes no internal detail", () => {
  const message = publicErrorMessage(new Error('ERR relation "public.public_registrations" violates constraint amount_check'));
  assert.doesNotMatch(message, /public_registrations|constraint|relation|amount_check/);
});
check("api: a rejected registration answers 400 with a structured error body", () => {
  assert.match(route, /error\.message\.includes\("capacity_exceeded"\) \? 409 : error\.message\.includes\("duplicate_registration"\) \? 409 : 400/);
  assert.match(route, /NextResponse\.json\(\{ error: publicErrorMessage\(error\) \}, \{ status \}\)/);
});

// ---- Admin fee validation ---------------------------------------------------
const base = { course_id: "00000000-0000-4000-8000-000000000001", start_date: "2026-12-01", end_date: "2026-12-02", capacity: 20, status: "open", is_published: true };
const parseFee = (fee: unknown) => scheduleSchema.safeParse({ ...base, fee });
const feeOk = (fee: unknown) => { const r = parseFee(fee); assert.ok(r.success, JSON.stringify(r.success ? "" : fieldErrors(r.error))); return r.data.fee; };
const feeMessage = (fee: unknown) => { const r = parseFee(fee); assert.ok(!r.success); return fieldErrors(r.error).fee; };
check("admin: blank fee clears to NULL", () => assert.equal(feeOk(""), null));
check("admin: null fee stays NULL", () => assert.equal(feeOk(null), null));
check("admin: missing fee is allowed", () => assert.equal(feeOk(undefined), null));
check("admin: minimum positive fee 0.01 is accepted", () => assert.equal(feeOk("0.01"), 0.01));
check("admin: normal fee 1500 is accepted", () => assert.equal(feeOk("1500"), 1500));
check("admin: decimal fee 1234.5 is accepted", () => assert.equal(feeOk("1234.5"), 1234.5));
check("admin: fee 0 is rejected with a clear message", () => assert.match(feeMessage("0"), /above 0/));
check("admin: fee 0.00 is rejected", () => assert.match(feeMessage("0.00"), /above 0/));
check("admin: numeric 0 is rejected", () => assert.match(feeMessage(0), /above 0/));
check("admin: negative fee is rejected", () => assert.match(feeMessage("-5"), /above 0/));
check("admin: non-numeric fee is rejected", () => assert.ok(feeMessage("abc")));

// ---- Admin fee clearing and form --------------------------------------------
const actions = read("app/admin/(protected)/schedules/actions.ts");
check("admin: clean() keeps an explicit NULL fee and only omits an absent one", () => {
  assert.match(actions, /if \(out\.fee === undefined\) delete out\.fee;/);
  assert.doesNotMatch(actions, /out\.fee === null \|\| out\.fee === undefined/);
});
const form = read("app/admin/(protected)/schedules/ScheduleForm.tsx");
check("admin: the fee input rejects zero in the browser (min 0.01)", () => assert.match(form, /name="fee" type="number" min="0\.01" step="0\.01"/));
check("admin: the help text states positive-only and enquiry for a blank fee", () => {
  assert.match(form, /above 0/);
  assert.match(form, /Zero is not accepted/);
  assert.match(form, /enquire/);
});

// ---- Public fee presentation: zero is never shown as a price -----------------
// The shared helper (lib/session-display.ts) is imported and executed here, so the test follows the shipped code.
// The three public surfaces (homepage, course page, calendar) must route every fee and CTA decision through it.
check("presentation: the enquiry wording is 'Fee to be confirmed'", () => assert.equal(FEE_ENQUIRY_TEXT, "Fee to be confirmed"));
check("presentation: a positive fee shows as RM 1,500", () => assert.equal(formatSessionFee(1500), "RM 1,500"));
check("presentation: the minimum fee shows as RM 0.01", () => assert.equal(formatSessionFee(0.01), "RM 0.01"));
check("presentation: a fractional fee keeps two decimals (RM 1,234.50)", () => assert.equal(formatSessionFee(1234.5), "RM 1,234.50"));
check("presentation: the unit is 'per participant'", () => assert.equal(FEE_UNIT, "per participant"));
check("presentation: a zero fee is not a price (no RM 0)", () => {
  assert.equal(formatSessionFee(0), null);
  assert.equal(confirmedFee(0), null);
});
check("presentation: a NULL or undefined fee is not a price", () => {
  assert.equal(formatSessionFee(null), null);
  assert.equal(formatSessionFee(undefined), null);
});
check("presentation: negative, non-numeric and non-finite fees are not prices", () => {
  assert.equal(formatSessionFee(-5), null);
  assert.equal(formatSessionFee("1500" as unknown as number), null);
  assert.equal(formatSessionFee(Number.NaN), null);
  assert.equal(formatSessionFee(Number.POSITIVE_INFINITY), null);
});

// ---- Registration eligibility: the Register state follows the server flag AND a positive fee --------
const session = { status: "open", capacity: 20, available_seats: 8, fee: 1500, registration_available: true } as const;
const kindOf = (overrides: Record<string, unknown>) => sessionKind({ ...session, ...overrides } as Parameters<typeof sessionKind>[0]);
check("eligibility: flag + positive fee + seat is Register (open)", () => assert.equal(kindOf({}), "open"));
check("eligibility: fee 0 with the flag set is never Register", () => assert.notEqual(kindOf({ fee: 0 }), "open"));
check("eligibility: fee NULL with the flag set is never Register", () => assert.notEqual(kindOf({ fee: null }), "open"));
check("eligibility: negative or non-finite fee is never Register", () => {
  assert.notEqual(kindOf({ fee: -1 }), "open");
  assert.notEqual(kindOf({ fee: Number.NaN }), "open");
});
check("eligibility: zero and NULL fee sessions are enquiry-only (not full, not free)", () => {
  assert.equal(kindOf({ fee: 0 }), "enquiry");
  assert.equal(kindOf({ fee: null }), "enquiry");
});
check("eligibility: the server flag false is never Register, even with a fee", () => assert.notEqual(kindOf({ registration_available: false }), "open"));
check("eligibility: no seat or a full status is never Register", () => {
  assert.equal(kindOf({ available_seats: 0 }), "full");
  assert.equal(kindOf({ status: "full" }), "full");
});

// ---- Component wiring: no local formatter, every surface uses the helper ------------------------------
const calendar = read("components/TrainingCalendar.js");
const options = read("components/public/CourseScheduleOptions.tsx");
const home = read("components/home/UpcomingTraining.js");
const coursePage = read("app/training/[slug]/page.js");
check("wiring: calendar, course schedule and homepage import the shared helper", () => {
  for (const source of [calendar, options, home]) assert.match(source, /from "\.\.?\/(?:\.\.\/)?lib\/session-display"/);
});
check("wiring: no component keeps its own currency formatter or hard-coded fee wording", () => {
  for (const source of [calendar, options, home]) {
    assert.doesNotMatch(source, /style:\s*"currency"/);
    assert.doesNotMatch(source, /Fee to be confirmed|Fee confirmed on enquiry/);
    assert.doesNotMatch(source, /\/ pax/);
  }
});
check("wiring: every surface reads the fee only through formatSessionFee(session.fee), never raw", () => {
  for (const [name, source] of [["calendar", calendar], ["course page", options], ["homepage", home]] as const) {
    assert.match(source, /formatSessionFee\(session\.fee\)/, `${name} must format the fee with the shared helper`);
    assert.doesNotMatch(source.replaceAll("formatSessionFee(session.fee)", ""), /session\.fee/, `${name} must not render or test the raw fee`);
  }
});
check("wiring: the course page and the homepage fall back to FEE_ENQUIRY_TEXT when the fee is not confirmed", () => {
  assert.match(options, /FEE_ENQUIRY_TEXT/);
  assert.match(home, /FEE_ENQUIRY_TEXT/);
});
check("wiring: the calendar Register link and label depend on sessionKind === 'open'", () => {
  assert.match(calendar, /const sessionUrl = \(session\) => sessionKind\(session\) === "open" \? `\/registration\/\$\{session\.id\}`/);
  assert.match(calendar, /const sessionCta = \(session\) => sessionKind\(session\) === "open" \? "Register"/);
});
check("wiring: the calendar shows the enquiry wording only for live, upcoming sessions without a confirmed fee", () => {
  assert.match(calendar, /return isUpcoming\(session\) && isLiveStatus\(session\) \? FEE_ENQUIRY_TEXT : null;/);
});
check("wiring: the course page shows the enquiry wording when the fee is not confirmed", () => {
  assert.match(options, /fee \? `\$\{fee\} \$\{FEE_UNIT\}` : FEE_ENQUIRY_TEXT/);
  assert.match(options, /const kind = sessionKind\(session\);/);
});
check("wiring: the course page hero and schedule link depend on sessionKind === 'open'", () => {
  assert.match(coursePage, /courseSchedules\.some\(\(session\) => sessionKind\(session\) === "open"\)/);
});
check("wiring: the homepage upcoming section derives the CTA from sessionKind", () => assert.match(home, /const kind = sessionKind\(session\);/));
check("source data: public-content keeps the raw fee (presentation-only change)", () => {
  assert.match(read("lib/public-content.ts"), /fee: row\.fee == null \? null : Number\(row\.fee\),/);
});

// ---- Scope guards -----------------------------------------------------------
check("scope: the catalogue course fee schema is unchanged (nonnegative)", () => {
  assert.match(read("lib/validation/schemas.ts"), /fee: z\.coerce\.number\(\)\.nonnegative\(\)\.optional\(\)\.nullable\(\),/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak aplikasi lulus");
process.exit(failures ? 1 : 0);
