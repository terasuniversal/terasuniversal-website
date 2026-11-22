import assert from "node:assert/strict";
import {
  EVIDENCE_SELECT,
  NO_EVIDENCE,
  RECONCILIATION_VIEWS,
  REGISTRATION_LEVEL_VIEWS,
  VIEW_META,
  capacityView,
  evidenceReasons,
  isUuid,
  parseEvidence,
  parseSearch,
  parseView,
} from "../lib/registrations/reconciliation.ts";
import { classifyRegistration, type PaymentInput, type RegistrationInput } from "../lib/registrations/reviewQueue.ts";

// PKG-1d-B staff payment reconciliation: fixture-only checks of the pure rules. No database, no live data.

// 1. Views: every bucket has a label and a unit; registration-level views are a subset.
{
  assert.deepEqual([...RECONCILIATION_VIEWS], ["paid_confirmed", "paid_unconfirmed", "payment_pending", "failed_cancelled", "late_success", "manual_transfer", "conflict"]);
  for (const v of RECONCILIATION_VIEWS) {
    assert.ok(VIEW_META[v].label.length > 0 && ["registrations", "attempts"].includes(VIEW_META[v].unit), v);
  }
  for (const v of REGISTRATION_LEVEL_VIEWS) assert.equal(VIEW_META[v].unit, "registrations", v);
  assert.equal(parseView("late_success"), "late_success");
  assert.equal(parseView(["conflict", "late_success"]), "conflict");
  for (const bad of [undefined, "", "LATE_SUCCESS", "late_success ", "paid_confirmed;drop", "__proto__"]) assert.equal(parseView(bad), null, String(bad));
}

// 2. Search: exact identifiers only; PostgREST structural characters and wildcards are refused, never sanitised into a pattern.
{
  for (const ok of ["TU-REG-ABC123", "tu-reg-abc123", "TP_123456789", "BILL-xyz", "abc"]) assert.equal(parseSearch(ok), ok, ok);
  assert.equal(parseSearch("  TU-REG-ABC  "), "TU-REG-ABC", "surrounding spaces are trimmed");
  for (const bad of [undefined, "", "ab", "a%b", "a,b", "a(b)", "a b", "a*b", "a.b", "-abc", "_abc", "x".repeat(65), "TU-REG-ABC'--", "a\nb"]) {
    assert.equal(parseSearch(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseSearch(["TU-REG-1", "other"]), "TU-REG-1");
}

// 3. UUIDs.
{
  assert.ok(isUuid("00000000-0000-0000-0000-00000000a001"));
  assert.ok(isUuid("7A3B1C2D-0000-4000-8000-ABCDEFABCDEF"));
  for (const bad of ["", "not-a-uuid", "00000000-0000-0000-0000-00000000a00", "00000000-0000-0000-0000-00000000a0011", null, 42]) assert.ok(!isUuid(bad), String(bad));
}

// 4. Evidence parsing: only the named keys, malformed input ignored, bounded.
{
  assert.deepEqual(parseEvidence({}), NO_EVIDENCE);
  const late = parseEvidence({ late_flag: "true", late_success: { original_status: "failed", provenance: "toyyibpay_get_bill_transactions" } });
  assert.equal(late.lateSuccess, true);
  assert.equal(late.lateOriginalStatus, "failed");
  assert.equal(parseEvidence({ late_flag: "true" }).lateSuccess, true, "the flag alone is enough");
  assert.equal(parseEvidence({ late_success: { original_status: "cancelled" } }).lateOriginalStatus, "cancelled");
  assert.equal(parseEvidence({ late_flag: "false" }).lateSuccess, false);
  assert.equal(parseEvidence({ late_flag: true }).lateSuccess, false, "only the text 'true' from ->> counts");

  const mm = parseEvidence({ amount_mismatch: { "TXN-LOW": { provider_amount: 99.99, expected_amount: "100.00" }, "TXN-X": "garbage" } });
  assert.deepEqual(mm.mismatches, [
    { transactionId: "TXN-LOW", providerCents: 9999, expectedCents: 10000 },
    { transactionId: "TXN-X", providerCents: null, expectedCents: null },
  ]);
  const cf = parseEvidence({ transaction_conflicts: { "TXN-1": { other_attempt_id: "00000000-0000-0000-0000-000000000001" }, "TXN-2": {} } });
  assert.deepEqual(cf.conflicts, [
    { transactionId: "TXN-1", otherAttemptId: "00000000-0000-0000-0000-000000000001" },
    { transactionId: "TXN-2", otherAttemptId: null },
  ]);
  assert.equal(parseEvidence({ success_after_refund: { "TXN-9": { verified_amount: 100 } } }).successAfterRefund, true);
  assert.equal(parseEvidence({ success_after_refund: {} }).successAfterRefund, false);

  for (const malformed of [{ amount_mismatch: [1, 2] }, { amount_mismatch: "x" }, { transaction_conflicts: null }, { late_success: [] }, { success_after_refund: "yes" }]) {
    const e = parseEvidence(malformed as Record<string, unknown>);
    assert.equal(e.mismatches.length + e.conflicts.length, 0, JSON.stringify(malformed));
    assert.equal(e.lateSuccess || e.successAfterRefund, false, JSON.stringify(malformed));
  }
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`TXN-${i}`, { provider_amount: 1 }]));
  assert.equal(parseEvidence({ amount_mismatch: many }).mismatches.length, 20, "evidence lists are capped");
}

// 5. The evidence select names keys only and never the whole column.
{
  const parts = EVIDENCE_SELECT.split(",").map((s) => s.trim());
  for (const p of parts) {
    if (p === "id" || p === "registration_id") continue;
    assert.match(p, /^[a-z_]+:raw_response->>?(late_success_reconciliation_required|late_success|amount_mismatch|transaction_conflicts|success_after_refund)$/, p);
  }
  assert.ok(!/(^|[\s,])raw_response($|[\s,])/.test(EVIDENCE_SELECT), "raw_response is never selected whole");
}

// 6. Reasons from evidence: one per kind, actions before reviews, wording does not decide money.
{
  assert.deepEqual(evidenceReasons([]), []);
  assert.deepEqual(evidenceReasons([NO_EVIDENCE, NO_EVIDENCE]), []);
  const all = evidenceReasons([
    { ...NO_EVIDENCE, lateSuccess: true, lateOriginalStatus: "failed" },
    { ...NO_EVIDENCE, lateSuccess: true, lateOriginalStatus: "cancelled", mismatches: [{ transactionId: "T", providerCents: 1, expectedCents: 2 }] },
    { ...NO_EVIDENCE, conflicts: [{ transactionId: "T2", otherAttemptId: null }], successAfterRefund: true },
  ]);
  assert.deepEqual(all.map((r) => r.code), ["late_success", "transaction_conflict", "success_after_refund", "amount_mismatch_evidence"]);
  assert.deepEqual(all.map((r) => r.severity), ["action", "action", "action", "review"]);
  assert.match(all[0].detail, /failed \/ cancelled/);
  for (const r of all) assert.ok(!/will be refunded|automatically|seat (has been|was) allocated/i.test(r.detail), `${r.code} promises nothing automatic`);
}

// 7. Capacity display (same arithmetic as the guard; never negative).
{
  assert.deepEqual(capacityView({ capacity: null, seatsTaken: 3, activeEnrolments: 3, otherActiveHolds: 0 }), { state: "unlimited", remaining: null });
  assert.deepEqual(capacityView({ capacity: 10, seatsTaken: 3, activeEnrolments: null, otherActiveHolds: 0 }), { state: "unknown", remaining: null });
  assert.deepEqual(capacityView({ capacity: 10, seatsTaken: 3, activeEnrolments: 3, otherActiveHolds: null }), { state: "unknown", remaining: null });
  assert.deepEqual(capacityView({ capacity: 10, seatsTaken: 3, activeEnrolments: 3, otherActiveHolds: 2 }), { state: "available", remaining: 5 });
  assert.deepEqual(capacityView({ capacity: 5, seatsTaken: 5, activeEnrolments: 4, otherActiveHolds: 1 }), { state: "full", remaining: 0 });
  assert.deepEqual(capacityView({ capacity: 2, seatsTaken: 5, activeEnrolments: 5, otherActiveHolds: 3 }), { state: "full", remaining: 0 }, "over capacity is shown as full with 0 free");
}

// 8. Classification with evidence (the shared rules used by the list and the detail page).
{
  const NOW = new Date("2026-11-22T04:00:00.000Z");
  const reg = (o: Partial<RegistrationInput> = {}): RegistrationInput => ({
    id: "r1", registration_reference: "TU-REG-AAAA", created_at: "2026-11-21T04:00:00.000Z", schedule_id: "s1", course_id: "c1",
    attendee_count: 1, amount_due_cents: 10000, registration_status: "payment_pending", payment_status: "processing", hold_expires_at: "2026-11-22T05:00:00.000Z", ...o,
  });
  const paid: PaymentInput = { id: "p1", registration_id: "r1", payment_provider: "toyyibpay", status: "paid", amount_cents: 10000, verified_cents: 10000, bill_creation_state: "attached", has_transaction_id: true, callback_received: true };
  const att = [{ id: "a1", registration_id: "r1", full_name: "Synthetic", company: null, participant_id: null }];
  const none = { known: true, participantIds: new Set<string>() };
  const codes = (r: ReturnType<typeof classifyRegistration>) => r.exceptions.map((e) => e.code);

  // paid_unallocated (schedule full): open registration, paid.
  const unallocated = classifyRegistration(reg({ payment_status: "paid" }), att, [paid], none, NOW);
  const pnc = unallocated.exceptions.find((e) => e.code === "paid_not_confirmed");
  assert.equal(pnc?.label, "Paid, seat not allocated");
  assert.equal(pnc?.severity, "action");
  // reconciliation after the registration ended or failed.
  for (const status of ["expired", "cancelled", "failed"]) {
    const ended = classifyRegistration(reg({ registration_status: status, payment_status: "paid", hold_expires_at: null }), att, [paid], none, NOW);
    assert.equal(ended.exceptions.find((e) => e.code === "paid_not_confirmed")?.label, "Paid after the registration ended", status);
  }
  // Evidence reasons are merged, once each, and ordered by severity.
  const extra = evidenceReasons([{ ...NO_EVIDENCE, lateSuccess: true, lateOriginalStatus: "failed", mismatches: [{ transactionId: "T", providerCents: 1, expectedCents: 2 }] }]);
  const merged = classifyRegistration(reg({ registration_status: "failed", payment_status: "paid" }), att, [paid], none, NOW, [...extra, ...extra]);
  assert.ok(codes(merged).includes("late_success") && codes(merged).includes("amount_mismatch_evidence"));
  assert.equal(codes(merged).filter((c) => c === "late_success").length, 1, "no duplicate reasons");
  assert.equal(merged.exceptions.at(-1)?.severity, "review", "review reasons after actions");
  // Without evidence nothing extra appears; a confirmed, fully paid registration stays clean.
  const clean = classifyRegistration(
    reg({ registration_status: "confirmed", payment_status: "paid", hold_expires_at: null }),
    [{ ...att[0], participant_id: "pp1" }],
    [paid],
    { known: true, participantIds: new Set(["pp1"]) },
    NOW,
  );
  assert.deepEqual(codes(clean), []);
  // QA finding M-1: late-success evidence stays on the attempt after a later confirmation. It must not still say the
  // payment is "without a seat" as an open action: it becomes a review item that says the registration is confirmed.
  const lateThenConfirmed = classifyRegistration(
    reg({ registration_status: "confirmed", payment_status: "paid", hold_expires_at: null }),
    [{ ...att[0], participant_id: "pp1" }],
    [paid],
    { known: true, participantIds: new Set(["pp1"]) },
    NOW,
    evidenceReasons([{ ...NO_EVIDENCE, lateSuccess: true, lateOriginalStatus: "failed" }]),
  );
  const lateReason = lateThenConfirmed.exceptions.find((e) => e.code === "late_success");
  assert.equal(lateReason?.severity, "review");
  assert.equal(lateReason?.label, "Late payment recorded (registration now confirmed)");
  assert.match(lateReason?.detail ?? "", /has since been confirmed/);
  assert.ok(!/without a seat/.test(lateReason?.detail ?? ""), "no claim that the registration has no seat");
  // Still an action while the registration is not confirmed.
  const lateOpen = classifyRegistration(reg({ registration_status: "failed", payment_status: "paid" }), att, [paid], none, NOW, evidenceReasons([{ ...NO_EVIDENCE, lateSuccess: true, lateOriginalStatus: "failed" }]));
  assert.equal(lateOpen.exceptions.find((e) => e.code === "late_success")?.severity, "action");
}

console.log("PKG-1d-B reconciliation rule tests passed.");
