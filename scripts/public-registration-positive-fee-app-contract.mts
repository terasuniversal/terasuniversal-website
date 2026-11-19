import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicErrorMessage } from "../lib/public-registration.ts";
import { fieldErrors, scheduleSchema } from "../lib/validation/schemas.ts";
import { describeSession } from "../lib/session-display.ts";

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
// Phase S3: the calendar, the course-page session cards and the homepage no longer carry their own fee formatters; all three
// render describeSession() from lib/session-display.ts. The same inputs the per-component checks used before are now run
// through that shared policy, and the components are checked to render its output. The invariants are unchanged: a
// positive fee is shown as a price, and zero, NULL, undefined, negative, non-numeric and NaN fees never are.
const calendar = read("components/TrainingCalendar.js");
// Phase S4B: the course-page session cards moved from components/public/CourseScheduleOptions.tsx to here.
const options = read("components/course/CourseSessions.tsx");
const homepage = read("app/page.js");
const sessionBase = { id: "s-1", start_date: "2026-12-01", end_date: "2026-12-02", start_time: null, venue: "TERAS Training Centre, Jitra", delivery_mode: null, status: "open", capacity: 20, available_seats: 5, fee: 1500 as number | null, registration_available: true };
const feeText = (fee: unknown) => describeSession({ ...sessionBase, fee: fee as number | null }).feeText;
check("presentation: calendar, course page and homepage all render the shared describeSession()", () => {
  for (const [name, source] of [["calendar", calendar], ["course page", options], ["homepage", homepage]] as const) assert.match(source, /describeSession\(session/, name);
  // Since S4A the calendar shows the labelled form ("Fee" + amount + unit, or "To be confirmed"), as the homepage does.
  assert.match(calendar, /<b>\{view\.feeShort\}<\/b>\{view\.feeAmount \? view\.feeUnit : null\}/);
  // Since S4B the course cards show the labelled form ("Fee" + amount + unit, or "To be confirmed"), as the calendar does.
  assert.match(options, /<b>\{view\.feeShort\}<\/b>\{view\.feeAmount \? view\.feeUnit : null\}/);
  assert.match(homepage, /feeShort: view\.feeShort/);
});
check("presentation: no component keeps its own fee formatter", () => {
  assert.doesNotMatch(calendar, /const feeLabel =/);
  assert.doesNotMatch(options, /const formatMoney =/);
});
check("presentation: a positive fee is shown (RM 1,500 per participant)", () => assert.equal(feeText(1500), "RM 1,500 per participant"));
check("presentation: the minimum fee is shown (RM 0.01 per participant)", () => assert.equal(feeText(0.01), "RM 0.01 per participant"));
check("presentation: decimals are kept (RM 1,234.50 per participant)", () => assert.equal(feeText(1234.5), "RM 1,234.50 per participant"));
check("presentation: zero is 'Fee to be confirmed', never RM 0", () => {
  assert.equal(feeText(0), "Fee to be confirmed");
  assert.doesNotMatch(feeText(0), /RM\s?0/);
});
check("presentation: NULL is 'Fee to be confirmed'", () => assert.equal(feeText(null), "Fee to be confirmed"));
check("presentation: undefined, negative, non-numeric and NaN fees are never a price", () => {
  for (const fee of [undefined, -5, -1, "1500", Number.NaN]) {
    assert.equal(feeText(fee), "Fee to be confirmed", String(fee));
    assert.equal(describeSession({ ...sessionBase, fee: fee as number | null }).feeAmount, null, String(fee));
  }
});

// ---- CTA stays driven by the server eligibility flag --------------------------
// Register needs the server's registration_available flag; the shared policy only ever withholds it (no fee, no seat,
// status full), never grants it. Every page takes its Register link from that policy.
check("cta: Register (to /registration/<id>) only with the server flag", () => {
  const open = describeSession(sessionBase).action;
  assert.equal(open.type, "register");
  assert.equal(open.type === "register" && open.href, "/registration/s-1");
  for (const fee of [1500, 99999, 0.01]) assert.notEqual(describeSession({ ...sessionBase, fee, registration_available: false }).action.type, "register", String(fee));
});
check("cta: the server flag with a zero or NULL fee, no seat or status full is still not Register", () => {
  for (const patch of [{ fee: 0 }, { fee: null }, { available_seats: 0 }, { status: "full" }]) assert.notEqual(describeSession({ ...sessionBase, ...patch }).action.type, "register", JSON.stringify(patch));
});
check("cta: calendar, course page and homepage take the Register link from the policy action", () => {
  assert.match(calendar, /view\.action\.type === "register"/);
  assert.match(calendar, /if \(view\.action\.type === "register"\) return view\.action\.href;/);
  assert.match(options, /view\.action\.type === "register"\s*\?\s*<Link className=\{kit\.btn\} href=\{view\.action\.href\}/);
  assert.match(homepage, /view\.action\.type === "register"\s*\?\s*view\.action\.href/);
  for (const source of [calendar, options, homepage]) assert.doesNotMatch(source, /registration_available \?/);
});
check("cta: the course page Register buttons use the same decision", () => {
  assert.match(read("app/training/[slug]/page.js"), /const hasRegistration = courseSchedules\.some\(\(session\) => sessionKind\(session\) === "open"\);/);
});
check("source data: public-content keeps the raw fee (presentation-only change)", () => {
  assert.match(read("lib/public-content.ts"), /fee: row\.fee == null \? null : Number\(row\.fee\),/);
});

// ---- Scope guards -----------------------------------------------------------
check("scope: the catalogue course fee schema is unchanged (nonnegative)", () => {
  assert.match(read("lib/validation/schemas.ts"), /fee: z\.coerce\.number\(\)\.nonnegative\(\)\.optional\(\)\.nullable\(\),/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak aplikasi lulus");
process.exit(failures ? 1 : 0);
