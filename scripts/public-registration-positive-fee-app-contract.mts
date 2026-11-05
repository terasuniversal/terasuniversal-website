import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicErrorMessage } from "../lib/public-registration.ts";
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
// The formatter expressions are read from the real components and evaluated here
// (trusted repository source) so the test follows the shipped code.
const calendar = read("components/TrainingCalendar.js");
const feeLabelSource = /const feeLabel = (\(fee\) => [\s\S]*?);\r?\n/.exec(calendar)?.[1];
check("presentation: calendar feeLabel is present", () => assert.ok(feeLabelSource));
const feeLabel = (fee: unknown): string | null => new Function("Intl", `return (${feeLabelSource});`)(Intl)(fee) as string | null;
check("presentation: calendar shows RM1,500 / pax for a positive fee", () => assert.equal(feeLabel(1500), "RM1,500 / pax"));
check("presentation: calendar shows the minimum fee RM0.01 / pax", () => assert.equal(feeLabel(0.01), "RM0.01 / pax"));
check("presentation: calendar keeps decimals (RM1,234.5 / pax)", () => assert.equal(feeLabel(1234.5), "RM1,234.5 / pax"));
check("presentation: calendar hides a zero fee (no RM0)", () => assert.equal(feeLabel(0), null));
check("presentation: calendar hides a NULL fee", () => assert.equal(feeLabel(null), null));
check("presentation: calendar hides undefined, negative and non-numeric fees", () => {
  assert.equal(feeLabel(undefined), null);
  assert.equal(feeLabel(-5), null);
  assert.equal(feeLabel("1500"), null);
  assert.equal(feeLabel(Number.NaN), null);
});

const options = read("components/public/CourseScheduleOptions.tsx");
const moneySource = /const formatMoney = \(value: number \| null\) => ([^\r\n]+?);?\r?\n/.exec(options)?.[1];
check("presentation: course formatMoney is present", () => assert.ok(moneySource));
const formatMoney = (value: unknown): string => new Function("Intl", `return ((value) => ${moneySource});`)(Intl)(value) as string;
check("presentation: course page shows MYR 1,500.00 for a positive fee", () => assert.match(formatMoney(1500), /1,500\.00/));
check("presentation: course page shows the minimum fee MYR 0.01", () => assert.match(formatMoney(0.01), /0\.01/));
check("presentation: course page says 'Fee to be confirmed' for zero", () => assert.equal(formatMoney(0), "Fee to be confirmed"));
check("presentation: course page says 'Fee to be confirmed' for NULL", () => assert.equal(formatMoney(null), "Fee to be confirmed"));
check("presentation: course page never shows 0.00 for zero or negative", () => {
  assert.doesNotMatch(formatMoney(0), /0\.00/);
  assert.equal(formatMoney(-1), "Fee to be confirmed");
});

// ---- CTA stays driven by the server eligibility flag --------------------------
check("cta: the calendar Register link still depends on registration_available only", () => {
  assert.match(calendar, /const sessionUrl = \(session\) => session\.registration_available \?/);
  assert.match(calendar, /const sessionCta = \(session\) => session\.registration_available \? "Register"/);
});
check("cta: the course page Register link still depends on registration_available only", () => {
  assert.match(options, /const active = session\.registration_available === true;/);
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
