import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

// Interim safeguard for createRevision (P0 quotation integrity). The real revision
// code runs here against a fake database client that records every statement, so the
// test can say exactly what was and was not written when a step fails.
// It is NOT proof of atomicity: the helper is deliberately not atomic.

const { runQuotationRevision, isMissingColumnError } = await import("../lib/sales/quotation-revision.ts");

type FakeError = { code?: string; message: string };
type Op = { table: string; kind: "select" | "insert" | "update"; payload?: unknown; filters: [string, unknown][]; terminal: string | null };
type Reply = { data?: unknown; error?: FakeError | null };

function makeClient(respond: (op: Op) => Reply | undefined) {
  const log: Op[] = [];
  const client = {
    from(table: string) {
      const op: Op = { table, kind: "select", filters: [], terminal: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select() { return builder; },
        insert(payload: unknown) { op.kind = "insert"; op.payload = payload; return builder; },
        update(payload: unknown) { op.kind = "update"; op.payload = payload; return builder; },
        eq(column: string, value: unknown) { op.filters.push([column, value]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return finish("maybeSingle"); },
        single() { return finish("single"); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return finish(null).then(resolve, reject); },
      };
      function finish(terminal: string | null) {
        op.terminal = terminal;
        log.push(op);
        let reply: Reply;
        try {
          reply = respond(op) ?? {};
        } catch (thrown) {
          return Promise.reject(thrown); // a rejected request, like a dropped connection
        }
        return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

const SOURCE = {
  id: "src-1", status: "sent", revision_no: 2, quotation_no: "QT-2026-0057", opportunity_id: "opp-1",
  valid_until: "2026-12-31", currency: "MYR", subtotal: 1000, discount: 100, sst_applicable: true, sst_rate: 8, sst_amount: 72,
  tax_label_snapshot: "SST", tax_basis_snapshot: "service", sst_registration_number_snapshot: "W10-1234-56789012", sst_effective_date_snapshot: "2026-09-01",
  tax: 72, total: 972, terms: "Net 30", notes: "n", customer_company_name: "ACME Safety Sdn Bhd", customer_contact_name: "Ali", customer_registration_no: "123456-A",
  customer_email: "ali@example.com", customer_phone: "+60 19-519 3834", billing_address: "1 Jalan Satu", training_service_address: "2 Jalan Dua",
};
const ITEMS = [
  { description: "Basic Scaffolder", quantity: 8, unit: "pax", unit_price: 125, discount: 0, sort_order: 0, course_id: "c-1", course_name_snapshot: "Basic Scaffolder", hrdf_claim: false, package_includes_snapshot: [{ key: "meal", label: "Meal" }] },
  { description: "Certificate fee", quantity: 1, unit: "lot", unit_price: 0, discount: 0, sort_order: 1, course_id: null, course_name_snapshot: null, hrdf_claim: false, package_includes_snapshot: [] },
];

type Overrides = {
  throwOn?: (op: Op) => boolean;
  source?: Record<string, unknown> | null; sourceError?: FakeError; items?: unknown[]; itemsError?: FakeError; maxRevision?: { revision_no: number } | null; maxRevisionError?: FakeError;
  revisionInsert?: Reply; itemsInsert?: Reply; supersede?: Reply; opportunity?: Reply; audit?: Reply;
};
function scenario(o: Overrides = {}) {
  return makeClient((op) => {
    if (o.throwOn?.(op)) throw new Error("ECONNRESET internal_secret_host:5432");
    if (op.table === "sales_quotations" && op.kind === "select" && op.filters[0]?.[0] === "id") {
      if (o.sourceError) return { error: o.sourceError };
      return { data: o.source === undefined ? SOURCE : o.source };
    }
    if (op.table === "sales_quotation_items" && op.kind === "select") return o.itemsError ? { error: o.itemsError } : { data: o.items ?? ITEMS };
    if (op.table === "sales_quotations" && op.kind === "select" && op.filters[0]?.[0] === "quotation_no") {
      if (o.maxRevisionError) return { error: o.maxRevisionError };
      return { data: o.maxRevision === undefined ? { revision_no: 2 } : o.maxRevision };
    }
    if (op.table === "sales_quotations" && op.kind === "insert") return o.revisionInsert ?? { data: { id: "rev-1", quotation_no: "QT-2026-0057" } };
    if (op.table === "sales_quotation_items" && op.kind === "insert") return o.itemsInsert ?? {};
    if (op.table === "sales_quotations" && op.kind === "update") return o.supersede ?? { data: { id: "src-1" } };
    if (op.table === "sales_opportunities") return o.opportunity ?? { data: { lead_metadata_id: "lead-1" } };
    if (op.table === "sales_activity") return o.audit ?? {};
    return {};
  });
}
const writes = (log: Op[]) => log.filter((op) => op.kind !== "select");
const describe = (log: Op[]) => writes(log).map((op) => `${op.kind}:${op.table}`);

// Failures are logged on purpose; capture them so the test can check what is (not) logged.
const logged: unknown[][] = [];
const realConsoleError = console.error;
console.error = (...args: unknown[]) => { logged.push(args); };
const run = (client: SupabaseClient) => runQuotationRevision(client, { quotationId: "src-1", actorId: "admin-1" });

// 1. Success: replacement first, items second, original superseded last, audit after.
{
  const { client, log } = scenario();
  const result = await run(client);
  assert.deepEqual(result, { ok: true, revisionId: "rev-1", opportunityId: "opp-1", auditSaved: true });
  assert.deepEqual(describe(log), ["insert:sales_quotations", "insert:sales_quotation_items", "update:sales_quotations", "insert:sales_activity"], "the original is superseded only after the replacement and its items exist");
  const [revisionInsert, itemsInsert, supersede, audit] = writes(log);
  const revision = revisionInsert.payload as Record<string, unknown>;
  for (const field of ["valid_until", "currency", "subtotal", "discount", "sst_applicable", "sst_rate", "sst_amount", "tax_label_snapshot", "tax_basis_snapshot",
    "sst_registration_number_snapshot", "sst_effective_date_snapshot", "tax", "total", "terms", "notes", "customer_company_name", "customer_contact_name",
    "customer_registration_no", "customer_email", "customer_phone", "billing_address", "training_service_address", "opportunity_id", "quotation_no"]) {
    assert.deepEqual(revision[field], (SOURCE as Record<string, unknown>)[field], `${field} is copied unchanged`);
  }
  assert.equal(revision.revision_no, 3, "next revision is the highest existing revision + 1");
  assert.equal(revision.parent_quotation_id, "src-1");
  assert.equal(revision.created_by, "admin-1");
  assert.ok(!("status" in revision), "the new row keeps the database default status (draft)");
  assert.deepEqual(itemsInsert.payload, ITEMS.map((item) => ({ ...item, quotation_id: "rev-1" })), "every line item is copied onto the new revision");
  const update = supersede.payload as Record<string, unknown>;
  assert.equal(update.status, "superseded");
  assert.ok(typeof update.superseded_at === "string" && typeof update.updated_at === "string");
  assert.deepEqual(supersede.filters, [["id", "src-1"], ["status", "sent"]], "superseding is conditional on the state that was read");
  assert.deepEqual(audit.payload, { lead_metadata_id: "lead-1", opportunity_id: "opp-1", quotation_id: "rev-1", type: "quotation_revised", note: "QT-2026-0057 revised", actor_id: "admin-1" });
}

// 2. Revision numbering.
{
  const a = scenario({ maxRevision: { revision_no: 5 } });
  await run(a.client);
  assert.equal((writes(a.log)[0].payload as Record<string, unknown>).revision_no, 6);
  const b = scenario({ maxRevision: null });
  await run(b.client);
  assert.equal((writes(b.log)[0].payload as Record<string, unknown>).revision_no, 3, "falls back to the source revision + 1");
}

// 3. THE REGRESSION: the SST columns are missing from the database. PostgREST wording, then Postgres wording.
for (const error of [
  { code: "PGRST204", message: "Could not find the 'sst_amount' column of 'sales_quotations' in the schema cache" },
  { code: "42703", message: 'column "tax_label_snapshot" of relation "sales_quotations" does not exist' },
  { message: "Could not find the 'sst_effective_date_snapshot' column of 'sales_quotations' in the schema cache" },
]) {
  logged.length = 0;
  const { client, log } = scenario({ revisionInsert: { error } });
  const result = await run(client);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.stage, "revision");
  assert.equal(result.revisionCreated, false);
  assert.match(result.message, /database is missing quotation columns/);
  assert.match(result.message, /original quotation was not changed/);
  assert.ok(!/sst_amount|tax_label_snapshot|sst_effective_date_snapshot|schema cache|sales_quotations/.test(result.message), "the raw database text is not shown to the user");
  // Only the failed insert was attempted: the original was never superseded, no items copied, no audit row.
  assert.deepEqual(describe(log), ["insert:sales_quotations"], `nothing but the failed insert was attempted for ${error.message.slice(0, 30)}`);
  assert.ok(!log.some((op) => op.kind === "update"), "the original quotation was never updated");
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], { stage: "insert-revision", code: error.code ?? null }, "only the step and code are logged");
}

// 4. The classifier.
for (const yes of [{ code: "PGRST204", message: "x" }, { code: "42703", message: "x" }, { message: "Could not find the 'x' column of 't' in the schema cache" }, { message: 'column "a" of relation "b" does not exist' }, { message: 'column sales_quotations.sst_amount does not exist' }]) {
  assert.equal(isMissingColumnError(yes), true, JSON.stringify(yes));
}
for (const no of [null, undefined, {}, { code: "23505", message: 'duplicate key value violates unique constraint "sales_quotations_quotation_no_revision_no_key"' }, { code: "42501", message: "permission denied" }, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, { message: 'relation "x" does not exist' }, { message: "timeout" }]) {
  assert.equal(isMissingColumnError(no as never), false, JSON.stringify(no));
}

// 5. Any other insert failure: generic message, nothing else written, raw text not echoed or logged.
{
  logged.length = 0;
  const { client, log } = scenario({ revisionInsert: { error: { code: "23505", message: "duplicate key value violates unique constraint secret_detail_xyz" } } });
  const result = await run(client);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.message, "Unable to create the revision. The original quotation was not changed.");
  assert.deepEqual(describe(log), ["insert:sales_quotations"]);
  assert.ok(!JSON.stringify(logged).includes("secret_detail_xyz") && !JSON.stringify(logged).includes("ACME"), "no raw message and no row data in the log");
}

// 6. Copying the items fails: the original is still untouched, the draft is reported.
{
  const { client, log } = scenario({ itemsInsert: { error: { code: "23514", message: "check violation" } } });
  const result = await run(client);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.stage, "items");
  assert.equal(result.revisionCreated, true);
  assert.match(result.message, /original quotation was not changed/);
  assert.deepEqual(describe(log), ["insert:sales_quotations", "insert:sales_quotation_items"], "no supersede and no audit after a failed item copy");
}

// 7. Superseding fails, or loses a race: the draft exists, the original is reported, no audit row.
for (const [name, supersede, pattern] of [
  ["database error", { error: { code: "42501", message: "denied" } }, /could not be marked as superseded/],
  ["no row updated (state changed)", { data: null }, /changed while it was being revised/],
] as const) {
  const { client, log } = scenario({ supersede });
  const result = await run(client);
  assert.equal(result.ok, false, name);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.stage, "supersede");
  assert.equal(result.revisionCreated, true);
  assert.match(result.message, pattern, name);
  assert.deepEqual(describe(log), ["insert:sales_quotations", "insert:sales_quotation_items", "update:sales_quotations"], `${name}: no audit row is written for an incomplete revision`);
}

// 8. A quotation that cannot be revised changes nothing, with the existing wording.
for (const status of ["draft", "accepted", "superseded", "cancelled"]) {
  const { client, log } = scenario({ source: { ...SOURCE, status } });
  const result = await run(client);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.message, `A ${status} quotation cannot be revised. Only sent, rejected or expired quotations can be revised.`);
  assert.deepEqual(writes(log), [], `${status}: zero writes`);
}
for (const status of ["sent", "rejected", "expired"]) {
  const { client, log } = scenario({ source: { ...SOURCE, status } });
  assert.equal((await run(client)).ok, true, status);
  assert.deepEqual(writes(log).find((op) => op.kind === "update")?.filters, [["id", "src-1"], ["status", status]]);
}

// 9. Any failed read stops everything before the first write.
for (const [name, overrides, message] of [
  ["quotation read error", { sourceError: { code: "XX000", message: "boom" } }, "Unable to load the quotation. Try again."],
  ["quotation not found", { source: null }, "Quotation not found."],
  ["items read error", { itemsError: { code: "XX000", message: "boom" } }, "Unable to load the quotation line items. Try again."],
  ["revision number read error", { maxRevisionError: { code: "XX000", message: "boom" } }, "Unable to work out the next revision number. Try again."],
] as const) {
  const { client, log } = scenario(overrides as Overrides);
  const result = await run(client);
  assert.equal(result.ok, false, name);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.message, message, name);
  assert.equal(result.stage, "load");
  assert.deepEqual(writes(log), [], `${name}: nothing was written`);
}

// 10. A quotation with no line items still revises; the audit entry failing never turns a finished revision into an error.
{
  const { client, log } = scenario({ items: [] });
  assert.equal((await run(client)).ok, true);
  assert.deepEqual(describe(log), ["insert:sales_quotations", "update:sales_quotations", "insert:sales_activity"], "no item insert when there are no items");
}
for (const [name, overrides] of [["opportunity read fails", { opportunity: { error: { code: "XX000", message: "x" } } }], ["audit insert fails", { audit: { error: { code: "23503", message: "x" } } }]] as const) {
  const { client } = scenario(overrides as Overrides);
  const result = await run(client);
  assert.deepEqual(result.ok && result.auditSaved, false, name);
  assert.equal(result.ok, true, `${name}: the revision itself still succeeded`);
}

// 10b. A rejected request or a throwing client never escapes the helper: it becomes a controlled result that says how far
//      the revision got, and nothing from the exception (host, message) reaches the user or the log.
const isOriginalRead = (op: Op) => op.table === "sales_quotations" && op.kind === "select" && op.filters[0]?.[0] === "id";
for (const [name, throwOn, stage, revisionCreated, expectedWrites, pattern] of [
  ["the quotation read throws", isOriginalRead, "load", false, [], /Unable to load the quotation/],
  ["the items read throws", (op: Op) => op.table === "sales_quotation_items" && op.kind === "select", "load", false, [], /Unable to load the quotation/],
  ["the revision insert throws", (op: Op) => op.table === "sales_quotations" && op.kind === "insert", "revision", false, ["insert:sales_quotations"], /Could not confirm that the revision was created.*original quotation was not changed/],
  ["the item copy throws", (op: Op) => op.table === "sales_quotation_items" && op.kind === "insert", "items", true, ["insert:sales_quotations", "insert:sales_quotation_items"], /line items could not be confirmed as copied.*original quotation was not changed/],
  ["the supersede update throws", (op: Op) => op.table === "sales_quotations" && op.kind === "update", "supersede", true, ["insert:sales_quotations", "insert:sales_quotation_items", "update:sales_quotations"], /could not be confirmed that the original quotation was marked as superseded/],
] as const) {
  logged.length = 0;
  const { client, log } = scenario({ throwOn });
  let result: Awaited<ReturnType<typeof run>> | undefined;
  await assert.doesNotReject(async () => { result = await run(client); }, `${name}: the helper must not reject`);
  assert.ok(result && !result.ok, name);
  if (!result || result.ok) throw new Error("unreachable");
  assert.equal(result.stage, stage, name);
  assert.equal(result.revisionCreated, revisionCreated, name);
  assert.match(result.message, pattern, name);
  assert.deepEqual(describe(log), expectedWrites, `${name}: only the writes up to the failing step were attempted`);
  assert.ok(!log.some((op) => op.kind === "update") || stage === "supersede", `${name}: the original is never updated before the revision and items exist`);
  assert.ok(![result.message, JSON.stringify(logged)].join("|").match(/ECONNRESET|internal_secret_host|5432/), `${name}: no exception text is shown or logged`);
  assert.deepEqual(logged.at(-1)?.[1], { stage: `${stage}-exception`, code: null }, `${name}: only the step is logged`);
}
// The audit lookups are non-fatal even when they throw: the revision is already complete.
for (const [name, throwOn] of [
  ["the audit lookup throws", (op: Op) => op.table === "sales_opportunities"],
  ["the audit insert throws", (op: Op) => op.table === "sales_activity"],
] as const) {
  logged.length = 0;
  const { client } = scenario({ throwOn });
  const result = await run(client);
  assert.equal(result.ok, true, `${name}: the revision itself succeeded`);
  assert.equal(result.ok && result.auditSaved, false, name);
  assert.ok(!JSON.stringify(logged).includes("ECONNRESET"), `${name}: nothing from the exception is logged`);
}

// 10c. A logger that throws must not change any outcome: failures still come back as results, and a finished revision still succeeds.
console.error = () => { throw new Error("logger is down"); };
{
  const failing = scenario({ revisionInsert: { error: { code: "23505", message: "dup" } } });
  let result: Awaited<ReturnType<typeof run>> | undefined;
  await assert.doesNotReject(async () => { result = await run(failing.client); }, "a throwing logger must not make a failed step reject");
  assert.ok(result && !result.ok && result.stage === "revision", "the failure is still returned as a result");

  const thrown = scenario({ throwOn: (op: Op) => op.table === "sales_quotations" && op.kind === "insert" });
  await assert.doesNotReject(async () => { result = await run(thrown.client); }, "a throwing logger must not make an exception path reject");
  assert.ok(result && !result.ok && result.stage === "revision" && /Could not confirm/.test(result.message));

  for (const throwOn of [(op: Op) => op.table === "sales_opportunities", (op: Op) => op.table === "sales_activity"]) {
    const audit = scenario({ throwOn });
    await assert.doesNotReject(async () => { result = await run(audit.client); }, "a throwing logger must not make a finished revision reject");
    assert.ok(result && result.ok && result.auditSaved === false, "the finished revision still succeeds when its audit step and its logger both fail");
  }
  const auditError = scenario({ audit: { error: { code: "23503", message: "fk" } } });
  await assert.doesNotReject(async () => { result = await run(auditError.client); });
  assert.ok(result && result.ok && result.auditSaved === false);
}

console.error = realConsoleError;

// 11. Source wiring and the documentation requirement.
const [actions, helper] = (await Promise.all([
  readFile("app/admin/(protected)/sales/quotations/actions.ts", "utf8"),
  readFile("lib/sales/quotation-revision.ts", "utf8"),
])).map((text) => text.replace(/\r\n/g, "\n")); // the checkout may use CRLF
assert.match(actions, /runQuotationRevision\(supabase, \{ quotationId, actorId: profile\.id \}\)/, "createRevision delegates to the helper");
assert.ok(!actions.includes('status: "superseded"'), "the action no longer supersedes anything itself");
for (const name of ["createQuotation", "updateQuotationDraft", "markQuotationSent", "acceptQuotationAction", "rejectQuotationAction", "createRevision"]) {
  assert.match(actions, new RegExp(`export async function ${name}\\b`), `${name} is still exported and unchanged in purpose`);
}
const revisionInsertAt = helper.indexOf(".insert({\n      opportunity_id: source.opportunity_id");
const itemCopyAt = helper.indexOf(".insert(sourceItems.map(");
const supersedeAt = helper.indexOf('status: "superseded"');
assert.ok(revisionInsertAt > 0 && itemCopyAt > 0 && supersedeAt > 0, "all three steps are present in the helper source");
assert.ok(revisionInsertAt < itemCopyAt && itemCopyAt < supersedeAt, "in the source: replacement insert, then item copy, then the supersede update");
assert.match(helper, /NOT ATOMIC/, "the file documents that it is not atomic");
assert.match(helper, /create_quotation_revision\(\)/, "the file names the atomic replacement");
assert.match(helper, /const REVISABLE_STATUSES = \["sent", "rejected", "expired"\];/, "which quotations can be revised is unchanged");
assert.match(helper, /\.eq\("status", source\.status\)/, "superseding is conditional on the state that was read");

// 12. Once a draft exists a retry would create a second one, so no message after that point may suggest retrying.
{
  const draftMessages = [
    ...(await Promise.all([
      scenario({ itemsInsert: { error: { code: "23503", message: "x" } } }),
      scenario({ throwOn: (op: Op) => op.table === "sales_quotation_items" && op.kind === "insert" }),
      scenario({ supersede: { error: { code: "XX000", message: "x" } } }),
      scenario({ supersede: { data: null } }),
      scenario({ throwOn: (op: Op) => op.table === "sales_quotations" && op.kind === "update" }),
    ].map(async ({ client }) => run(client)))),
  ];
  for (const result of draftMessages) {
    assert.ok(!result.ok && result.revisionCreated, "the draft exists in every one of these cases");
    assert.doesNotMatch(result.message, /try again|retry/i, "no retry advice once a draft exists: " + result.message);
  }
  assert.ok(draftMessages.some((r) => !r.ok && /do not create another revision/.test(r.message)), "item-copy failures tell the user to complete the existing draft");
}

console.log("Quotation revision order contract passed.");
