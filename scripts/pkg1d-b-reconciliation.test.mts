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
import { readFileSync } from "node:fs";
import {
  MAX_PAGE,
  PAGE_SIZE,
  RANGE_NOT_SATISFIABLE,
  classifyRegistration,
  fetchPageWithRecovery,
  pageCount,
  parseQueueParams,
  type PageQueryResult,
  type PaymentInput,
  type RegistrationInput,
} from "../lib/registrations/reviewQueue.ts";

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

// P-1 (local, pending owner review, 22 Nov 2026): a page beyond the end of the list (HTTP 416 / PGRST103).
// A fake PostgREST with the real rule: with count=exact, a range that starts past the last row is refused with 416,
// except offset 0 of an empty list, which is an empty 200.
{
  type Row = { id: number; view: string };
  const makeDb = (data: Row[]) => {
    const calls = { list: [] as number[], count: 0 };
    let filter: (r: Row) => boolean = () => true;
    let fail: { code: string } | null = null;
    let countFail: { code: string } | null = null;
    const matching = () => data.filter(filter);
    return {
      calls,
      setFilter: (f: (r: Row) => boolean) => { filter = f; },
      failWith: (e: { code: string } | null) => { fail = e; },
      failCountWith: (e: { code: string } | null) => { countFail = e; },
      fetchPage: async (page: number): Promise<PageQueryResult<Row>> => {
        calls.list.push(page);
        if (fail) return { data: null, count: null, error: fail };
        const all = matching();
        const from = (page - 1) * PAGE_SIZE;
        if (from > 0 && from >= all.length) return { data: null, count: null, error: { code: RANGE_NOT_SATISFIABLE } };
        return { data: all.slice(from, from + PAGE_SIZE), count: all.length, error: null };
      },
      countRows: async () => {
        calls.count += 1;
        return countFail ? { count: null, error: countFail } : { count: matching().length, error: null };
      },
    };
  };
  const rows = (n: number, view = "paid_confirmed"): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, view }));

  // T1: page 1, no records: empty page 1, no extra query.
  {
    const db = makeDb([]);
    assert.deepEqual(await fetchPageWithRecovery(1, db.fetchPage, db.countRows), { ok: true, page: 1, rows: [], count: 0 });
    assert.deepEqual(db.calls, { list: [1], count: 0 });
  }
  // T2: page 2, no records: 416 -> one exact count (0) -> page 1, empty; no re-fetch needed.
  {
    const db = makeDb([]);
    assert.deepEqual(await fetchPageWithRecovery(2, db.fetchPage, db.countRows), { ok: true, page: 1, rows: [], count: 0 });
    assert.deepEqual(db.calls, { list: [2], count: 1 });
  }
  // T3: page beyond the last valid page (60 rows = 3 pages; page 7): last page 3 with its 10 rows, one retry.
  {
    const db = makeDb(rows(60));
    const r = await fetchPageWithRecovery(7, db.fetchPage, db.countRows);
    assert.ok(r.ok && r.page === 3 && r.rows.length === 10 && r.count === 60 && r.rows[0].id === 51, JSON.stringify(r));
    assert.deepEqual(db.calls, { list: [7, 3], count: 1 });
    const db2 = makeDb(rows(60));
    const r2 = await fetchPageWithRecovery(MAX_PAGE, db2.fetchPage, db2.countRows);
    assert.ok(r2.ok && r2.page === 3, JSON.stringify(r2));
  }
  // T4: the valid last page (exactly full, and partial) is returned as asked, one query only.
  for (const [n, page, len] of [[50, 2, 25], [51, 3, 1], [25, 1, 25]] as const) {
    const db = makeDb(rows(n));
    const r = await fetchPageWithRecovery(page, db.fetchPage, db.countRows);
    assert.ok(r.ok && r.page === page && r.rows.length === len && r.count === n, `${n}/${page}: ${JSON.stringify(r)}`);
    assert.deepEqual(db.calls, { list: [page], count: 0 }, `${n}/${page}`);
  }
  // T5: a search that shrinks the result (page 4 link, search now matches 3 rows): page 1 with the 3 rows.
  {
    const db = makeDb(rows(100));
    db.setFilter((r) => r.id % 33 === 0);
    const r = await fetchPageWithRecovery(4, db.fetchPage, db.countRows);
    assert.ok(r.ok && r.page === 1 && r.count === 3 && r.rows.map((x) => x.id).join() === "33,66,99", JSON.stringify(r));
    const none = makeDb(rows(100));
    none.setFilter(() => false);
    assert.deepEqual(await fetchPageWithRecovery(4, none.fetchPage, none.countRows), { ok: true, page: 1, rows: [], count: 0 });
  }
  // T6: a filter that lowers the count (page 5 of 120 rows, filter leaves 30 = 2 pages): last valid page 2.
  {
    const db = makeDb(rows(120).map((r) => ({ ...r, view: r.id <= 30 ? "late_success" : "paid_confirmed" })));
    db.setFilter((r) => r.view === "late_success");
    const r = await fetchPageWithRecovery(5, db.fetchPage, db.countRows);
    assert.ok(r.ok && r.page === 2 && r.rows.length === 5 && r.count === 30, JSON.stringify(r));
  }
  // T7: invalid page values never reach the database as anything but 1..MAX_PAGE.
  const pageCases: [string | string[] | undefined, number][] = [
    [undefined, 1], ["", 1], ["0", 1], ["-3", 1], ["abc", 1], ["2.5", 1], ["1e3", 1], ["999999", 1], [" 2", 1],
    ["2", 2], ["00002", 2], ["10000", MAX_PAGE], ["99999", MAX_PAGE], [["3", "9"], 3],
  ];
  for (const [raw, want] of pageCases) assert.equal(parseQueueParams({ page: raw }).page, want, `page=${JSON.stringify(raw)}`);
  // T8: every other PostgREST error is returned unchanged, with no count and no retry.
  for (const code of ["PGRST301", "42501", "PGRST116", "57014"]) {
    const db = makeDb(rows(10));
    db.failWith({ code });
    assert.deepEqual(await fetchPageWithRecovery(3, db.fetchPage, db.countRows), { ok: false, code, query: "list" }, code);
    assert.deepEqual(db.calls, { list: [3], count: 0 }, code);
  }
  {
    // PGRST103 on page 1 is not "past the end": reported, never retried.
    const db = makeDb(rows(10));
    db.failWith({ code: RANGE_NOT_SATISFIABLE });
    assert.deepEqual(await fetchPageWithRecovery(1, db.fetchPage, db.countRows), { ok: false, code: RANGE_NOT_SATISFIABLE, query: "list" });
    assert.deepEqual(db.calls, { list: [1], count: 0 });
    // A failing count is reported as a count failure, with no re-fetch.
    const dbc = makeDb(rows(10));
    dbc.failCountWith({ code: "57014" });
    assert.deepEqual(await fetchPageWithRecovery(4, dbc.fetchPage, dbc.countRows), { ok: false, code: "57014", query: "count" });
    assert.deepEqual(dbc.calls, { list: [4], count: 1 });
    // A count that comes back without a number is a failure, never shown as an empty list.
    let refetched = false;
    const noCount = await fetchPageWithRecovery(
      4,
      async (page: number): Promise<PageQueryResult<Row>> => {
        if (page !== 4) refetched = true;
        return { data: null, count: null, error: { code: RANGE_NOT_SATISFIABLE } };
      },
      async () => ({ count: null, error: null }),
    );
    assert.deepEqual(noCount, { ok: false, code: undefined, query: "count" });
    assert.equal(refetched, false);
  }
  // T9: no infinite retry. A database that refuses every page: one count and one re-fetch at most, then an error.
  {
    const db = makeDb(rows(60));
    db.failWith({ code: RANGE_NOT_SATISFIABLE });
    assert.deepEqual(await fetchPageWithRecovery(9, db.fetchPage, db.countRows), { ok: false, code: RANGE_NOT_SATISFIABLE, query: "list retry" });
    assert.deepEqual(db.calls, { list: [9, 3], count: 1 });
    // A count that still covers the requested page (inconsistent 416): reported, no re-fetch.
    const odd = makeDb(rows(300));
    odd.failWith({ code: RANGE_NOT_SATISFIABLE });
    assert.deepEqual(await fetchPageWithRecovery(4, odd.fetchPage, odd.countRows), { ok: false, code: RANGE_NOT_SATISFIABLE, query: "list" });
    assert.deepEqual(odd.calls, { list: [4], count: 1 });
    // An empty 200 past the end (a server without the 416) also resolves in one re-fetch and no count.
    let n = 0;
    const lenient = async (page: number): Promise<PageQueryResult<Row>> => {
      n += 1;
      const all = rows(30);
      return { data: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), count: all.length, error: null };
    };
    const r3 = await fetchPageWithRecovery(6, lenient, async () => { throw new Error("count must not be called"); });
    assert.ok(r3.ok && r3.page === 2 && r3.rows.length === 5 && n === 2, JSON.stringify(r3));
  }
  // T10: all seven reconciliation views keep their scope: the recovered page and count are for that view only.
  {
    const all = RECONCILIATION_VIEWS.flatMap((v, i) => Array.from({ length: (i + 1) * 7 }, (_, j) => ({ id: i * 1000 + j + 1, view: v as string })));
    for (const [i, v] of RECONCILIATION_VIEWS.entries()) {
      const db = makeDb(all);
      db.setFilter((r) => r.view === v);
      const want = (i + 1) * 7;
      const r = await fetchPageWithRecovery(50, db.fetchPage, db.countRows);
      assert.ok(r.ok && r.count === want && r.page === pageCount(want) && r.rows.length > 0 && r.rows.every((x) => x.view === v), `${v}: ${JSON.stringify(r)}`);
      assert.ok(db.calls.list.length <= 2 && db.calls.count <= 1, v);
    }
  }
  // The loader: the page and its exact count come from ONE filter definition (status, payment, attention, the seven
  // views, search ids); only the recovered page reaches the screen; it stays read-only.
  {
    const loader = readFileSync("lib/registrations/reviewQueueLoader.ts", "utf8").replace(/\r\n/g, "\n");
    assert.match(loader, /const buildList = \(page: number\) => \{\n    const from = \(page - 1\) \* PAGE_SIZE;\n    return filteredQuery\(false\)\.order/);
    assert.match(loader, /const countList = \(\) => filteredQuery\(true\);/);
    assert.match(loader, /fetchPageWithRecovery<Json>\(params\.page, buildList, countList\)/);
    assert.equal((loader.match(/select\(head \? "id" : listColumns, \{ count: "exact", head \}\)/g) ?? []).length, 1);
    for (const f of ['params.status', 'params.payment', 'params.attention === "expired_hold"', 'params.attention === "paid_unconfirmed"',
      'scope.view === "paid_confirmed"', 'scope.view === "paid_unconfirmed"', 'scope.view === "payment_pending"', 'scope.ids !== null']) {
      const at = loader.indexOf(`if (${f}`);
      assert.ok(at > loader.indexOf("const filteredQuery") && at < loader.indexOf("const buildList"), `filter inside the shared definition: ${f}`);
    }
    assert.ok(!/buildList\(params\.page\)/.test(loader), "the unrecovered list call is gone");
    assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(loader), "the loader stays read-only");
  }
}

console.log("PKG-1d-B reconciliation rule tests passed.");
