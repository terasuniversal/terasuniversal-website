import assert from "node:assert/strict";
import {
  ATTENTION_FILTERS,
  MAX_PAGE,
  PAGE_SIZE,
  PAYMENT_STATUSES,
  REGISTRATION_STATUSES,
  classifyRegistration,
  pageCount,
  parseQueueParams,
  type AttendeeInput,
  type EnrolmentInput,
  type PaymentInput,
  type RegistrationInput,
} from "../lib/registrations/reviewQueue.ts";

// Fixture-only checks of the registration review rules. No database, no live data.

const NOW = new Date("2026-11-05T04:00:00.000Z");
const PAST = "2026-11-05T03:00:00.000Z";
const FUTURE = "2026-11-05T05:00:00.000Z";

const reg = (o: Partial<RegistrationInput> = {}): RegistrationInput => ({
  id: "r1",
  registration_reference: "TU-REG-AAAA",
  created_at: "2026-11-04T04:00:00.000Z",
  schedule_id: "s1",
  course_id: "c1",
  attendee_count: 1,
  amount_due_cents: 50000,
  registration_status: "pending_payment",
  payment_status: "pending",
  hold_expires_at: FUTURE,
  ...o,
});
const att = (o: Partial<AttendeeInput> = {}): AttendeeInput => ({ id: "a1", registration_id: "r1", full_name: "Aina Binti Ali", company: "Acme Sdn Bhd", participant_id: "p1", ...o });
const pay = (o: Partial<PaymentInput> = {}): PaymentInput => ({
  id: "pay1",
  registration_id: "r1",
  payment_provider: "toyyibpay",
  status: "paid",
  amount_cents: 50000,
  verified_cents: 50000,
  bill_creation_state: "attached",
  has_transaction_id: true,
  callback_received: true,
  ...o,
});
const enrolled = (...ids: string[]): EnrolmentInput => ({ known: true, participantIds: new Set(ids) });
const codes = (r: ReturnType<typeof classifyRegistration>) => r.exceptions.map((e) => e.code).sort();

const confirmed = (o: Partial<RegistrationInput> = {}) => reg({ registration_status: "confirmed", payment_status: "paid", hold_expires_at: null, ...o });

// 1. Stages and the healthy path.
{
  const healthy = classifyRegistration(confirmed(), [att()], [pay()], enrolled("p1"), NOW);
  assert.equal(healthy.stage, "confirmed");
  assert.deepEqual(healthy.exceptions, [], "a complete confirmed registration has no exceptions");
  assert.equal(healthy.needsAttention, false);
  assert.deepEqual(healthy.crm, { state: "complete", attendees: 1, linked: 1, enrolled: 1 });
  assert.equal(healthy.paidCents, 50000);
  assert.equal(healthy.primaryAttendee, "Aina Binti Ali");
  assert.equal(healthy.company, "Acme Sdn Bhd");

  assert.equal(classifyRegistration(reg(), [att()], [], enrolled(), NOW).stage, "new");
  assert.equal(classifyRegistration(reg(), [att()], [pay({ status: "pending", has_transaction_id: false, callback_received: false })], enrolled(), NOW).stage, "awaiting_payment");
  assert.equal(classifyRegistration(reg({ registration_status: "payment_pending", payment_status: "processing" }), [att()], [pay({ status: "processing" })], enrolled(), NOW).stage, "awaiting_payment");
  assert.equal(classifyRegistration(reg({ registration_status: "failed", payment_status: "failed" }), [att()], [pay({ status: "failed" })], enrolled(), NOW).stage, "failed");
  assert.equal(classifyRegistration(reg({ registration_status: "cancelled", payment_status: "cancelled" }), [att()], [], enrolled(), NOW).stage, "cancelled");
  assert.equal(classifyRegistration(reg({ registration_status: "expired", payment_status: "cancelled" }), [att()], [], enrolled(), NOW).stage, "expired");
  assert.equal(classifyRegistration(reg({ registration_status: "weird" }), [att()], [], enrolled(), NOW).stage, "unknown");
  // An open registration with a hold in the future and no payment is normal, not an exception.
  assert.deepEqual(classifyRegistration(reg(), [att()], [], enrolled(), NOW).exceptions, []);
}

// 2. Expired hold still open (boundary: the hold instant itself counts as ended).
{
  assert.deepEqual(codes(classifyRegistration(reg({ hold_expires_at: PAST }), [att()], [], enrolled(), NOW)), ["hold_expired_active"]);
  assert.deepEqual(codes(classifyRegistration(reg({ hold_expires_at: NOW.toISOString() }), [att()], [], enrolled(), NOW)), ["hold_expired_active"]);
  assert.deepEqual(codes(classifyRegistration(reg({ hold_expires_at: FUTURE }), [att()], [], enrolled(), NOW)), []);
  assert.deepEqual(codes(classifyRegistration(reg({ hold_expires_at: null }), [att()], [], enrolled(), NOW)), [], "no hold, nothing to expire");
  assert.deepEqual(codes(classifyRegistration(reg({ registration_status: "expired", hold_expires_at: PAST }), [att()], [], enrolled(), NOW)), [], "an expired registration is not still open");
}

// 3. Late payment signal: a provider transaction recorded after the registration ended.
{
  const ended = (status: string) => reg({ registration_status: status, payment_status: "cancelled", hold_expires_at: null });
  const late = pay({ status: "cancelled", has_transaction_id: true, callback_received: true });
  assert.ok(codes(classifyRegistration(ended("expired"), [att()], [late], enrolled(), NOW)).includes("late_payment_signal"));
  assert.ok(codes(classifyRegistration(ended("cancelled"), [att()], [late], enrolled(), NOW)).includes("late_payment_signal"));
  assert.ok(!codes(classifyRegistration(ended("expired"), [att()], [pay({ status: "cancelled", has_transaction_id: false, callback_received: false })], enrolled(), NOW)).includes("late_payment_signal"), "no provider transaction recorded");
  assert.ok(!codes(classifyRegistration(ended("expired"), [att()], [pay({ status: "cancelled", has_transaction_id: true, callback_received: false })], enrolled(), NOW)).includes("late_payment_signal"), "transaction id without a callback is not a late payment");
  assert.ok(!codes(classifyRegistration(ended("expired"), [att()], [pay({ status: "refunded" })], enrolled(), NOW)).includes("late_payment_signal"), "a refunded payment is already handled");
  assert.ok(!codes(classifyRegistration(reg({ registration_status: "payment_pending", payment_status: "processing" }), [att()], [late], enrolled(), NOW)).includes("late_payment_signal"), "the registration has not ended");
}

// 4. Orphaned or failed bill creation.
{
  for (const state of ["failed", "orphaned"]) {
    assert.ok(codes(classifyRegistration(reg(), [att()], [pay({ status: "failed", bill_creation_state: state })], enrolled(), NOW)).includes("bill_creation_failed"), state);
  }
  assert.ok(!codes(classifyRegistration(reg(), [att()], [pay({ status: "pending", bill_creation_state: "attached" })], enrolled(), NOW)).includes("bill_creation_failed"));
  assert.ok(!codes(classifyRegistration(reg(), [att()], [pay({ payment_provider: "bank_transfer", status: "pending", bill_creation_state: "not_claimed" })], enrolled(), NOW)).includes("bill_creation_failed"), "bill state only matters for Toyyibpay");
  assert.ok(!codes(classifyRegistration(confirmed(), [att()], [pay({ bill_creation_state: "orphaned" })], enrolled("p1"), NOW)).includes("bill_creation_failed"), "a confirmed registration is complete");
}

// 5. Paid but not confirmed is an anomaly, never a normal state.
{
  const a = classifyRegistration(reg({ payment_status: "paid", registration_status: "payment_pending" }), [att()], [pay()], enrolled(), NOW);
  assert.equal(a.stage, "payment_received");
  assert.ok(codes(a).includes("paid_not_confirmed"));
  assert.equal(a.exceptions[0].severity, "action");
  // A paid attempt with the registration still unpaid is caught from the attempt side too.
  assert.ok(codes(classifyRegistration(reg({ registration_status: "payment_pending", payment_status: "processing" }), [att()], [pay()], enrolled(), NOW)).includes("paid_not_confirmed"));
  // Confirmed without payment recorded; a free registration (amount 0) is fine.
  assert.ok(codes(classifyRegistration(confirmed({ payment_status: "pending" }), [att()], [], enrolled("p1"), NOW)).includes("confirmed_not_paid"));
  assert.ok(!codes(classifyRegistration(confirmed({ payment_status: "pending", amount_due_cents: 0 }), [att()], [], enrolled("p1"), NOW)).includes("confirmed_not_paid"));
}

// 6. Participant links and enrolments, including nulls.
{
  const noLink = classifyRegistration(confirmed(), [att({ participant_id: null })], [pay()], enrolled(), NOW);
  assert.ok(codes(noLink).includes("participant_link_missing"));
  assert.equal(noLink.crm.state, "incomplete");
  assert.equal(noLink.crm.linked, 0);
  const noAttendees = classifyRegistration(confirmed(), [], [pay()], enrolled(), NOW);
  assert.ok(codes(noAttendees).includes("participant_link_missing"), "a confirmed registration with no attendee rows has nothing linked");
  const partial = classifyRegistration(confirmed({ attendee_count: 2 }), [att(), att({ id: "a2", participant_id: null })], [pay()], enrolled("p1"), NOW);
  assert.ok(codes(partial).includes("participant_link_missing"));
  assert.equal(partial.crm.linked, 1);

  const notEnrolled = classifyRegistration(confirmed(), [att()], [pay()], enrolled("someone-else"), NOW);
  assert.ok(codes(notEnrolled).includes("enrolment_missing"));
  assert.equal(notEnrolled.crm.enrolled, 0);
  assert.equal(notEnrolled.exceptions.find((e) => e.code === "enrolment_missing")?.severity, "review");

  const unknown = classifyRegistration(confirmed(), [att()], [pay()], { known: false, participantIds: new Set() }, NOW);
  assert.ok(codes(unknown).includes("enrolment_unknown"));
  assert.equal(unknown.crm.state, "unknown");
  assert.equal(unknown.crm.enrolled, null);
  assert.equal(unknown.exceptions.find((e) => e.code === "enrolment_unknown")?.severity, "unknown", "uncheckable is UNKNOWN, not a guess");

  // Not confirmed: links and enrolments are not expected yet.
  assert.deepEqual(codes(classifyRegistration(reg(), [att({ participant_id: null })], [], enrolled(), NOW)), []);
  assert.equal(classifyRegistration(reg(), [att({ participant_id: null })], [], enrolled(), NOW).crm.state, "not_applicable");
}

// 7. Amount verification.
{
  assert.ok(codes(classifyRegistration(confirmed(), [att()], [pay({ verified_cents: 49999 })], enrolled("p1"), NOW)).includes("amount_mismatch"));
  assert.ok(codes(classifyRegistration(confirmed(), [att()], [pay({ verified_cents: null })], enrolled("p1"), NOW)).includes("amount_mismatch"), "a paid attempt with no verified amount cannot be confirmed");
  assert.ok(codes(classifyRegistration(confirmed(), [att()], [pay({ amount_cents: 40000 })], enrolled("p1"), NOW)).includes("amount_mismatch"), "attempt amount differs from the amount due");
  assert.ok(!codes(classifyRegistration(confirmed(), [att()], [pay()], enrolled("p1"), NOW)).includes("amount_mismatch"));
  assert.ok(!codes(classifyRegistration(reg(), [att()], [pay({ status: "pending", verified_cents: null })], enrolled(), NOW)).includes("amount_mismatch"), "only paid attempts are verified");
}

// 8. Duplicate and inconsistent payment states.
{
  const dup = classifyRegistration(confirmed(), [att()], [pay(), pay({ id: "pay2" })], enrolled("p1"), NOW);
  assert.ok(codes(dup).includes("duplicate_paid_payments"));
  assert.equal(dup.paidCents, 100000, "both verified amounts are visible, so the double charge is visible");

  assert.ok(codes(classifyRegistration(confirmed(), [att()], [pay({ status: "cancelled" })], enrolled("p1"), NOW)).includes("payment_status_inconsistent"), "registration paid with no paid attempt");
  assert.ok(codes(classifyRegistration(confirmed({ payment_status: "processing" }), [att()], [pay()], enrolled("p1"), NOW)).includes("payment_status_inconsistent"), "a paid attempt but the registration is not paid");
  assert.ok(codes(classifyRegistration(reg({ payment_status: "pending" }), [att()], [pay({ status: "refunded" })], enrolled(), NOW)).includes("payment_status_inconsistent"), "a refunded attempt not reflected on the registration");
  assert.ok(codes(classifyRegistration(confirmed({ payment_status: "refunded" }), [att()], [pay({ status: "refunded" })], enrolled("p1"), NOW)).includes("payment_status_inconsistent"), "refunded but still confirmed");
  assert.ok(!codes(classifyRegistration(confirmed(), [att()], [pay()], enrolled("p1"), NOW)).includes("payment_status_inconsistent"));
}

// 9. UNKNOWN provider outcome.
{
  const waiting = pay({ status: "processing", has_transaction_id: false, callback_received: false, bill_creation_state: "attached" });
  const u = classifyRegistration(reg({ hold_expires_at: PAST, registration_status: "payment_pending", payment_status: "processing" }), [att()], [waiting], enrolled(), NOW);
  assert.ok(codes(u).includes("provider_outcome_unknown"));
  assert.equal(u.exceptions.find((e) => e.code === "provider_outcome_unknown")?.severity, "unknown");
  assert.ok(u.exceptions.find((e) => e.code === "provider_outcome_unknown")!.detail.includes("UNKNOWN"));
  assert.ok(!codes(classifyRegistration(reg({ registration_status: "payment_pending", payment_status: "processing" }), [att()], [waiting], enrolled(), NOW)).includes("provider_outcome_unknown"), "still inside the hold: normal waiting");
  assert.ok(codes(classifyRegistration(reg({ registration_status: "expired", payment_status: "cancelled" }), [att()], [waiting], enrolled(), NOW)).includes("provider_outcome_unknown"), "an ended registration with a still-processing attempt");
}

// 10. Ordering: action first, then review, then unknown.
{
  const mixed = classifyRegistration(
    reg({ registration_status: "expired", payment_status: "cancelled", hold_expires_at: null }),
    [att()],
    [pay({ status: "processing", has_transaction_id: true, callback_received: true, bill_creation_state: "orphaned" }), pay({ id: "pay2", status: "processing", has_transaction_id: false, callback_received: false, bill_creation_state: "attached" })],
    enrolled(),
    NOW,
  );
  const severities = mixed.exceptions.map((e) => e.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => ["action", "review", "unknown"].indexOf(a) - ["action", "review", "unknown"].indexOf(b)));
  assert.equal(new Set(mixed.exceptions.map((e) => e.code)).size, mixed.exceptions.length, "each code appears once");
  assert.equal(mixed.needsAttention, true);
}

// 11. Pagination and filter boundaries.
{
  assert.equal(PAGE_SIZE, 25);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(25), 1);
  assert.equal(pageCount(26), 2);
  assert.equal(pageCount(50), 2);
  assert.equal(pageCount(51), 3);
  assert.equal(pageCount(-5), 1);

  const none = parseQueueParams({});
  assert.deepEqual(none, { page: 1, status: null, payment: null, attention: null });
  assert.equal(parseQueueParams({ page: "3" }).page, 3);
  for (const bad of ["0", "-1", "abc", "1.5", "1e3", " 2", "", "000000", "100000", "2 OR 1=1"]) assert.equal(parseQueueParams({ page: bad }).page, 1, `page "${bad}" falls back to 1`);
  assert.equal(parseQueueParams({ page: "99999" }).page, MAX_PAGE, "page is capped");
  assert.equal(parseQueueParams({ page: ["4", "5"] }).page, 4, "an array takes the first value");
  for (const s of REGISTRATION_STATUSES) assert.equal(parseQueueParams({ status: s }).status, s);
  for (const s of PAYMENT_STATUSES) assert.equal(parseQueueParams({ payment: s }).payment, s);
  for (const s of ATTENTION_FILTERS) assert.equal(parseQueueParams({ attention: s }).attention, s);
  for (const bad of ["CONFIRMED", "confirmed,or(id.eq.1)", "confirmed)", "%", "*", "all"]) {
    assert.equal(parseQueueParams({ status: bad }).status, null, `status "${bad}" is ignored`);
    assert.equal(parseQueueParams({ payment: bad }).payment, null);
    assert.equal(parseQueueParams({ attention: bad }).attention, null);
  }
}

console.log("Registration review queue tests passed.");
