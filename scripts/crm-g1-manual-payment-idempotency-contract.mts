import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

// G1 static contract. No database is contacted.
// 1. Migration shape: one fail-closed DO block, lock_timeout, pinned pre-state, no destructive or unrelated change.
// 2. The new unguarded body keeps every existing safety control and adds the idempotency and reference rules in the
//    right order (lock -> replay check -> payable/balance -> duplicate reference -> insert with index backstop).
// 3. ACL: only the new wrapper is executable by authenticated; the old wrapper is revoked; no anon/service_role grant.
// 4. Rollback restores the old surface without DROP COLUMN.
// 5. The application always sends the form's idempotency key and requires a reference for bank transfer / cheque.
// 6. Self-test: every mutation of the real files must break at least one check (run with --mutations).
// Usage: node --experimental-strip-types <this> [<app-repo-root>] [--mutations]

const args = process.argv.slice(2);
const repoRoot = resolvePath(args.find((a) => !a.startsWith("--")) ?? ".");
const withMutations = args.includes("--mutations");
const VERSION = "20261129120000";
const rel = {
  mig: `supabase/migrations/${VERSION}_manual_payment_idempotency_reference.sql`,
  rb: `docs/security/crm-g1/${VERSION}_manual_payment_idempotency_reference.rollback.sql`,
  action: "app/admin/(protected)/invoices/actions.ts",
  schema: "lib/validation/schemas.ts",
  panel: "app/admin/(protected)/invoices/[id]/InvoiceActionsPanel.tsx",
  page: "app/admin/(protected)/invoices/[id]/page.tsx",
};
type Files = Record<keyof typeof rel, string>;
const real = Object.fromEntries(Object.entries(rel).map(([k, p]) => [k, readFileSync(join(repoRoot, p), "utf8")])) as Files;

const NORM = "regexp_replace(upper(payment_reference), '[^A-Z0-9]', '', 'g')";
const codeOf = (sql: string) => sql.replace(/--[^\n]*/g, "");
const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, `missing end marker after: ${from}`);
  return s.slice(a, b);
};

function checks(f: Files): Array<[string, () => void]> {
  const mig = codeOf(f.mig), rb = codeOf(f.rb);
  const unguarded = () => between(mig, "create function public.record_manual_payment_unguarded(", "$body$\n$fn$");
  const wrapper = () => between(mig, "create function public.record_manual_payment(", "$body$\n$fn$");
  return [
    ["migration is LF-only and its version is the highest in supabase/migrations and > 20261128120000", () => {
      assert.ok(!f.mig.includes("\r"));
      const versions = readdirSync(join(repoRoot, "supabase/migrations")).filter((n) => /^\d{14}_/.test(n)).map((n) => n.slice(0, 14)).sort();
      assert.equal(versions[versions.length - 1], VERSION);
      assert.ok(VERSION > "20261128120000");
    }],
    ["one DO block with transaction-local lock_timeout 5s", () => {
      assert.equal((mig.match(/^do \$g1\$/gm) ?? []).length, 1);
      assert.ok(mig.trimEnd().endsWith("$g1$;"));
      assert.ok(mig.includes("perform set_config('lock_timeout', '5s', true);"));
    }],
    ["preflight pins the reviewed bodies and ACLs and refuses existing duplicates, all before any change", () => {
      const pre = mig.slice(0, mig.indexOf("alter table public.invoice_payments"));
      for (const s of ["'db3e3d34fce21530c92e3ae8ab43a82d'", "'95b4afc264c3b4579e49b29b8024fcfc'", "'{postgres=X/postgres,authenticated=X/postgres}'", "existing duplicate reference group", "G1 objects already exist"]) assert.ok(pre.includes(s), s);
    }],
    ["no destructive or unrelated statement (drop, truncate, data update/delete, policy, other tables)", () => {
      assert.doesNotMatch(mig, /\b(drop|truncate)\b/i);
      assert.doesNotMatch(mig, /\bupdate\s+public\.(?!invoices\b)/i);
      assert.doesNotMatch(mig, /\bupdate\s+public\.invoices\b/i);
      assert.doesNotMatch(mig, /\bdelete\s+from\b/i);
      assert.doesNotMatch(mig, /\b(create|alter)\s+policy\b/i);
      const altered = [...mig.matchAll(/alter table\s+([a-z_.]+)/gi)].map((m) => m[1]);
      assert.deepEqual(altered, ["public.invoice_payments"]);
      assert.match(mig, /alter table public\.invoice_payments add column if not exists idempotency_key uuid;/);
    }],
    ["both indexes: idempotency key unique; normalised reference unique per invoice and provider, customer bank/cheque, successful only", () => {
      assert.match(mig, /create unique index if not exists invoice_payments_idempotency_key_key\s+on public\.invoice_payments \(idempotency_key\) where idempotency_key is not null;/);
      const idx = between(mig, "create unique index if not exists invoice_payments_manual_reference_key", ";");
      assert.ok(idx.includes(`(invoice_id, payment_provider, (${NORM}))`), "index key must be invoice + provider + normalised reference");
      for (const s of ["payment_provider in ('bank_transfer', 'cheque')", "status = 'successful'", "payment_source is distinct from 'hrdf'", `${NORM} <> ''`]) assert.ok(idx.includes(s), s);
    }],
    ["unguarded body keeps admin check, provider list, amount check, FOR UPDATE lock, payable and balance checks, audit and activity", () => {
      const b = unguarded();
      for (const s of ["if not app.is_admin() then", "p_payment_provider not in ('cash', 'bank_transfer', 'cheque', 'other')", "p_amount is null or p_amount <= 0",
        "from public.invoices where id = p_invoice_id for update", "v_invoice.status not in ('issued', 'partially_paid')", "p_amount > v_invoice.balance_due",
        "'payment_exceeds_balance'", "log_event_as_service", "'payment_recorded'", "'invoice_paid'", "'invoice_partially_paid'"]) assert.ok(b.includes(s), s);
      assert.match(b, /security definer set search_path = public, app/);
    }],
    ["order: key required -> reference required -> lock -> replay -> payable -> balance -> duplicate reference -> insert", () => {
      const b = unguarded();
      const at = (s: string) => { const i = b.indexOf(s); assert.ok(i >= 0, s); return i; };
      assert.ok(b.includes("\n  if p_idempotency_key is null then\n    raise exception 'idempotency_key_required'"), "key must be mandatory");
      const seq = [at("'idempotency_key_required'"), at("'payment_reference_required'"), at("for update;"), at("where idempotency_key = p_idempotency_key"),
        at("'invoice_not_payable'"), at("'payment_exceeds_balance'"), at("'duplicate_payment_reference'"), at("insert into public.invoice_payments")];
      assert.deepEqual([...seq].sort((x, y) => x - y), seq);
    }],
    ["replay returns the original payment only for the same invoice, provider, amount and reference; otherwise conflict", () => {
      const b = between(unguarded(), "where idempotency_key = p_idempotency_key", "'invoice_not_payable'");
      assert.ok(b.includes(";\n  if v_existing.id is not null then\n    if v_existing.invoice_id = p_invoice_id"), "replay branch must run whenever the key exists");
      for (const s of ["v_existing.invoice_id = p_invoice_id", "v_existing.payment_provider = p_payment_provider", "v_existing.amount = p_amount",
        "coalesce(v_existing.payment_reference, '') = coalesce(v_reference, '')", "'outcome', 'duplicate_ignored'", "raise exception 'idempotency_key_conflict'"]) assert.ok(b.includes(s), s);
      assert.doesNotMatch(b, /insert into|update public/);
    }],
    ["reference rule: bank_transfer and cheque only, same normalisation as the index, scoped to invoice + provider, HRDF excluded", () => {
      const b = unguarded();
      assert.ok(b.includes("p_payment_provider in ('bank_transfer', 'cheque') and v_reference_norm = ''"));
      assert.ok(b.includes("v_reference_norm text := regexp_replace(upper(coalesce(p_payment_reference, '')), '[^A-Z0-9]', '', 'g');"));
      const dup = between(b, "if p_payment_provider in ('bank_transfer', 'cheque') and exists (", "'duplicate_payment_reference'");
      for (const s of ["invoice_id = p_invoice_id", "payment_provider = p_payment_provider", "status = 'successful'", "payment_source is distinct from 'hrdf'",
        "regexp_replace(upper(coalesce(payment_reference, '')), '[^A-Z0-9]', '', 'g') = v_reference_norm"]) assert.ok(dup.includes(s), s);
    }],
    ["insert stores the key and the trimmed reference; unique_violation maps to the same codes by constraint name", () => {
      const b = unguarded();
      assert.match(b, /payment_reference, notes, paid_at, created_by, idempotency_key\s*\) values \(/);
      assert.match(b, /v_reference, p_notes, coalesce\(p_payment_date, current_date\)::timestamptz, v_actor, p_idempotency_key/);
      const h = between(b, "exception when unique_violation then", "raise;\n  end;");
      assert.ok(h.includes("get stacked diagnostics v_constraint = constraint_name;"));
      assert.ok(h.includes("v_constraint = 'invoice_payments_idempotency_key_key'") && h.includes("'idempotency_key_conflict'"));
      assert.ok(h.includes("v_constraint = 'invoice_payments_manual_reference_key'") && h.includes("'duplicate_payment_reference'"));
    }],
    ["new wrapper: SECURITY DEFINER, empty search_path, invoices:edit guard before the forward of all 8 arguments", () => {
      const w = wrapper();
      assert.match(w, /returns jsonb language plpgsql security definer set search_path = ''/);
      const g = w.indexOf("if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized'");
      const c = w.indexOf("return public.record_manual_payment_unguarded(p_invoice_id, p_payment_provider, p_payment_method, p_amount, p_payment_date,\n    p_payment_reference, p_notes, p_idempotency_key);");
      assert.ok(g > 0 && c > g);
    }],
    ["ACL: owner postgres; unguarded closed to every client role; wrapper authenticated only; old wrapper revoked; no grant to anon/service_role/public", () => {
      const sig8 = "(uuid, text, text, numeric, date, text, text, uuid)";
      assert.ok(mig.includes(`alter function public.record_manual_payment_unguarded${sig8} owner to postgres;`));
      assert.ok(mig.includes(`alter function public.record_manual_payment${sig8} owner to postgres;`));
      assert.match(mig, /revoke all on function public\.record_manual_payment_unguarded\(uuid, text, text, numeric, date, text, text, uuid\)\s+from public, anon, authenticated, service_role;/);
      assert.match(mig, /revoke all on function public\.record_manual_payment\(uuid, text, text, numeric, date, text, text, uuid\)\s+from public, anon, service_role;/);
      const grants = [...mig.matchAll(/grant ([^;]+);/g)].map((m) => m[1].replace(/\s+/g, " "));
      assert.deepEqual(grants, [`execute on function public.record_manual_payment${sig8} to authenticated`]);
      assert.ok(mig.includes("revoke execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from authenticated;"));
    }],
    ["postconditions re-check ACLs, unchanged old bodies, search_path and both indexes", () => {
      const post = mig.slice(mig.indexOf("-- ---- Postconditions") >= 0 ? mig.indexOf("if (select proacl::text from pg_proc where oid = v_new_wrapper)") : 0);
      for (const s of ["v_new_wrapper", "v_new_unguarded", "v_old_wrapper", "v_old_unguarded", "'db3e3d34fce21530c92e3ae8ab43a82d'", "'95b4afc264c3b4579e49b29b8024fcfc'",
        "has_function_privilege('authenticated', v_old_wrapper, 'EXECUTE')", "has_function_privilege('anon', v_new_wrapper, 'EXECUTE')",
        "to_regclass('public.invoice_payments_idempotency_key_key') is null", "to_regclass('public.invoice_payments_manual_reference_key') is null", "'g1_postcondition_failed"]) assert.ok(post.includes(s), s);
    }],
    ["rollback: guarded, re-grants the old wrapper first, removes only G1 functions and indexes, keeps the column", () => {
      assert.ok(rb.includes("g1_rollback_precondition_failed"));
      const g = rb.indexOf("grant execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) to authenticated;");
      const d = rb.indexOf("drop function");
      assert.ok(g > 0 && d > g, "re-grant before any drop");
      const drops = [...rb.matchAll(/drop (function|index)( if exists)? ([^;]+);/g)].map((m) => `${m[1]} ${m[3]}`);
      assert.deepEqual(drops, [
        "function public.record_manual_payment(uuid, text, text, numeric, date, text, text, uuid)",
        "function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text, uuid)",
        "index public.invoice_payments_manual_reference_key",
        "index public.invoice_payments_idempotency_key_key",
      ]);
      assert.doesNotMatch(rb, /drop column|alter table|truncate|delete from|update public/i);
    }],
    ["app: action parses the key and sends it as p_idempotency_key; replay shows a notice, not an error", () => {
      const a = f.action.slice(f.action.indexOf("export async function recordManualPaymentAction"), f.action.indexOf("export async function generateReceiptAction"));
      assert.ok(a.includes('idempotency_key: formData.get("idempotency_key") ?? ""'));
      assert.ok(a.includes("p_idempotency_key: d.idempotency_key,"));
      assert.match(a, /outcome === "duplicate_ignored"[\s\S]{0,80}return \{ notice:/);
      assert.ok(a.indexOf('rpc("mark_toyyibpay_attempt_superseded"') < a.indexOf('rpc("record_manual_payment"'), "ToyyibPay supersede still runs before the payment");
    }],
    ["app: every new database code has a staff message", () => {
      for (const code of ["idempotency_key_required", "idempotency_key_conflict", "payment_reference_required", "duplicate_payment_reference"]) {
        assert.ok(real.mig.includes(`'${code}'`), `db raises ${code}`);
        assert.match(f.action, new RegExp(`\\n  ${code}: "`), `message for ${code}`);
      }
    }],
    ["schema: key must be a uuid; bank transfer and cheque need a reference with a letter or digit", () => {
      const s = f.schema.slice(f.schema.indexOf("export const recordManualPaymentSchema"), f.schema.indexOf("export type RecordManualPaymentInput"));
      assert.ok(s.includes('idempotency_key: z.string().uuid('));
      assert.ok(s.includes('(d.payment_provider === "bank_transfer" || d.payment_provider === "cheque") && !/[A-Za-z0-9]/.test(d.payment_reference ?? "")'));
      assert.ok(s.includes('path: ["payment_reference"]'));
    }],
    ["form: hidden key input bound to state, server-provided first key, rotation only after success, reference required for bank/cheque", () => {
      assert.ok(f.panel.includes('<input type="hidden" name="idempotency_key" value={paymentKey} />'));
      assert.ok(f.panel.includes("useState(initialPaymentKey)"));
      // G3: the key rotates only after a confirmed outcome (recorded or replay), never after an error or an unconfirmed result.
      // R-1: the outcome handler is applyOutcome(state, …); a confirmed outcome is still the first branch to rotate.
      assert.match(f.panel, /    if \(state\.payment\) \{[\s\S]{0,700}setPaymentKey\(crypto\.randomUUID\(\)\);/);
      assert.ok(f.panel.includes('const referenceRequired = paymentProvider === "bank_transfer" || paymentProvider === "cheque";'));
      assert.ok(f.panel.includes('onChange={setValue("payment_reference")} required={referenceRequired} readOnly={detailsLocked}'));
      assert.ok(f.page.includes("initialPaymentKey={crypto.randomUUID()}"));
    }],
  ];
}

function run(f: Files) {
  const failed: string[] = [];
  let passed = 0;
  for (const [name, fn] of checks(f)) {
    try { fn(); passed++; } catch (e) { failed.push(`${name}: ${(e as Error).message.split("\n")[0]}`); }
  }
  return { passed, failed };
}

const base = run(real);
for (const msg of base.failed) console.error(`FAIL ${msg}`);
let failures = base.failed.length;

if (withMutations) {
  if (failures) { console.error("mutations skipped: the real files must pass first"); process.exit(1); }
  const mutations: Array<[string, keyof Files, string, string]> = [
    ["drop the replay check", "mig", "  if v_existing.id is not null then", "  if false then"],
    ["make the key optional", "mig", "  if p_idempotency_key is null then", "  if false then"],
    ["drop the reference requirement", "mig", "p_payment_provider in ('bank_transfer', 'cheque') and v_reference_norm = ''", "false"],
    ["make reference uniqueness global (blocks split allocation)", "mig", "    where invoice_id = p_invoice_id and payment_provider = p_payment_provider and status = 'successful'", "    where payment_provider = p_payment_provider and status = 'successful'"],
    ["remove the invoice lock", "mig", "where id = p_invoice_id for update;", "where id = p_invoice_id;"],
    ["remove the overpayment check", "mig", "  if p_amount > v_invoice.balance_due then", "  if false then"],
    ["grant the unguarded body to authenticated", "mig", "  revoke execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from authenticated;", "  grant execute on function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text, uuid) to authenticated;"],
    ["keep the old wrapper executable", "mig", "  revoke execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from authenticated;", ""],
    ["drop the backstop index", "mig", "  create unique index if not exists invoice_payments_manual_reference_key", "  create index if not exists invoice_payments_manual_reference_key"],
    ["include HRDF rows in the duplicate rule", "mig", "      and payment_source is distinct from 'hrdf'\n      and regexp_replace", "      and regexp_replace"],
    ["rollback drops the column", "rb", "  drop index if exists public.invoice_payments_idempotency_key_key;", "  alter table public.invoice_payments drop column idempotency_key;"],
    ["app forgets the key", "action", "    p_idempotency_key: d.idempotency_key,\n", ""],
    ["schema stops requiring a cheque number", "schema", '(d.payment_provider === "bank_transfer" || d.payment_provider === "cheque")', '(d.payment_provider === "bank_transfer")'],
    ["form rotates the key on every state change (breaks retry)", "panel", "    if (state.payment) {", "    if (state.payment || state.errors || state.message) {"],
    ["form generates the first key on the client (hydration mismatch)", "page", "initialPaymentKey={crypto.randomUUID()}", 'initialPaymentKey=""'],
  ];
  let killed = 0;
  for (const [label, file, from, to] of mutations) {
    assert.equal(real[file].split(from).length - 1, 1, `mutation anchor not unique: ${label}`);
    const r = run({ ...real, [file]: real[file].replace(from, to) });
    if (r.failed.length) killed++; else { failures++; console.error(`FAIL mutation survived: ${label}`); }
  }
  console.log(`mutations: ${killed}/${mutations.length} killed`);
}

console.log(failures ? `${failures} check(s) FAILED, ${base.passed} passed.` : `${base.passed} check(s) passed.`);
process.exit(failures ? 1 : 0);
