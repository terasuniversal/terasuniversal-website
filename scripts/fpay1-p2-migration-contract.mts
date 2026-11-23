// F-PAY-1 P2 static contract: the migration may change exactly two function bodies by exactly the two reviewed edits,
// keeps every signature, SECURITY DEFINER and search_path, touches no grant/owner/table, and its rollback restores the
// reviewed originals. Run: node --experimental-strip-types scripts/fpay1-p2-migration-contract.mts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const md5 = (text: string) => createHash("md5").update(text).digest("hex");
const MIGRATION = "supabase/migrations/20261123100000_fpay1_p2_cancel_finalize_guards.sql";
const ROLLBACK = "docs/security/fpay1-p2/20261123100000_fpay1_p2_cancel_finalize_guards.rollback.sql";
const ORIGINAL = {
  cancel_invoice_unguarded: "d08eaad240c614f658e1cb68c2e73e8f",
  finalize_toyyibpay_payment_from_callback: "78c36cd603dfa7c4f3d8d45a2d6d07a7",
} as const;

const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };

type Fn = { name: string; header: string; body: string };
const functions = (sql: string): Fn[] =>
  [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$/g)]
    .map((m) => ({ name: m[1], header: `${m[2]}${m[3]}`, body: m[4] }));

const changed = functions(migration);
const originals = functions(rollback);
const byName = (list: Fn[], name: string) => { const f = list.find((x) => x.name === name); assert.ok(f, name); return f!; };

check("migration and rollback each redefine exactly cancel_invoice_unguarded and finalize_toyyibpay_payment_from_callback", () => {
  assert.deepEqual(changed.map((f) => f.name).sort(), Object.keys(ORIGINAL).sort());
  assert.deepEqual(originals.map((f) => f.name).sort(), Object.keys(ORIGINAL).sort());
});

check("rollback bodies are the reviewed Production/Staging originals (md5)", () => {
  for (const [name, hash] of Object.entries(ORIGINAL)) assert.equal(md5(byName(originals, name).body), hash, name);
});

check("fail-closed precondition pins both original md5 values before any change", () => {
  const pre = migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION"));
  for (const [name, hash] of Object.entries(ORIGINAL)) {
    assert.match(pre, new RegExp(`'${hash}'`), name);
    assert.match(pre, new RegExp(`fpay1_p2_precondition: ${name}`), name);
  }
  assert.match(pre, /set local lock_timeout = '5s';/);
});

check("signatures, SECURITY DEFINER and search_path are unchanged", () => {
  for (const name of Object.keys(ORIGINAL)) {
    assert.equal(byName(changed, name).header, byName(originals, name).header, name);
    assert.match(byName(changed, name).header, /SECURITY DEFINER\n SET search_path TO 'public', 'app'/);
  }
});

check("no grants, revokes, owner changes, drops or table DDL anywhere in the migration", () => {
  const outsideBodies = migration.replace(/AS \$function\$[\s\S]*?\$function\$/g, "");
  assert.doesNotMatch(outsideBodies, /\b(grant|revoke|drop|alter|owner\s+to|create\s+table|insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(rollback.replace(/AS \$function\$[\s\S]*?\$function\$/g, ""), /\b(grant|revoke|drop|alter|owner\s+to)\b/i);
});

const P2A = /  -- F-PAY-1 P2a:[\s\S]*?raise exception 'active_toyyibpay_attempt' using errcode = 'P0001';\n  end if;\n\n/;
const P2B = /  -- F-PAY-1 P2b:[\s\S]*?return jsonb_build_object\('outcome', 'reconciliation_required', 'attempt_id', p_attempt_id\);\n  end if;\n/;

check("each body differs from its original only by its named P2 block", () => {
  const cancel = byName(changed, "cancel_invoice_unguarded").body;
  const finalize = byName(changed, "finalize_toyyibpay_payment_from_callback").body;
  assert.match(cancel, P2A);
  assert.match(finalize, P2B);
  assert.equal(md5(cancel.replace(P2A, "")), ORIGINAL.cancel_invoice_unguarded);
  assert.equal(md5(finalize.replace(P2B, "")), ORIGINAL.finalize_toyyibpay_payment_from_callback);
});

check("P2a locks pending ToyyibPay attempts after the admin check and before the invoice row (finalize's lock order)", () => {
  const cancel = byName(changed, "cancel_invoice_unguarded").body;
  const admin = cancel.indexOf("if not app.is_admin() then");
  const attempts = cancel.search(/payment_provider = 'toyyibpay' and status = 'pending'\n   for update;/);
  const invoice = cancel.indexOf("from public.invoices where id = p_invoice_id for update;");
  assert.ok(admin >= 0 && attempts > admin && invoice > attempts, `${admin} < ${attempts} < ${invoice}`);
});

check("P2b runs after the invoice lock and before any money check or write, and never marks the attempt", () => {
  const finalize = byName(changed, "finalize_toyyibpay_payment_from_callback").body;
  const lock = finalize.indexOf("select * into v_invoice from public.invoices where id = v_attempt.invoice_id for update;");
  const block = finalize.search(P2B);
  const balance = finalize.indexOf("if p_verified_amount > v_invoice.balance_due then");
  const write = finalize.indexOf("update public.invoice_payments");
  assert.ok(lock >= 0 && block > lock && balance > block && write > balance, `${lock} < ${block} < ${balance} < ${write}`);
  const p2b = finalize.match(P2B)![0];
  assert.match(p2b, /if v_invoice\.status = 'cancelled' then/);
  assert.match(p2b, /'raw_response', p_raw_response/);
  assert.doesNotMatch(p2b, /\b(update\s+public\.|insert\s+into|delete\s+from)/i);
  assert.match(p2b, /perform public\.log_event_as_service\(/);
});

check("the app maps active_toyyibpay_attempt to a readable message", () => {
  assert.match(read("app/admin/(protected)/invoices/actions.ts"), /\n  active_toyyibpay_attempt: "A ToyyibPay payment link is still active for this invoice\. Deactivate it before cancelling\.",\n/);
});

check("Docker test applies this migration and this rollback", () => {
  const run = read("supabase/tests/fpay1_p2/run.sh");
  assert.match(run, /--network none/);
  assert.match(run, /\.\.\/\.\.\/migrations\/20261123100000_fpay1_p2_cancel_finalize_guards\.sql/);
  assert.match(run, /docs\/security\/fpay1-p2\/20261123100000_fpay1_p2_cancel_finalize_guards\.rollback\.sql/);
});

console.log(`\n${passed} check(s) passed.`);
