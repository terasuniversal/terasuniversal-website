import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// PKG-1d-A static contract: the four migrations, the callback route's named selection edits and the pure selection
// module are exactly the owner-approved change. Every check is a function of the file texts, so the negative mutations
// at the end (M16: privilege postcondition removed, M17: a GRANT to anon added, plus scope mutations) run the same
// checks against mutated texts and must fail. Never touches a database or the network.
const root = new URL("..", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const squash = (s: string) => s.replace(/\s+/g, "");

const M = {
  a1: "supabase/migrations/20261122120000_public_registration_payment_guard_late_success.sql",
  a2: "supabase/migrations/20261122121000_public_registration_late_success_recording.sql",
  a3: "supabase/migrations/20261122122000_public_registration_manual_payment_states.sql",
  a4: "supabase/migrations/20261122123000_public_registration_begin_payment_paid_guard.sql",
} as const;
const PKG1C = "supabase/migrations/20261122110000_public_registration_capacity_safe_finalization.sql";
const ROUTE = "app/api/payments/toyyibpay/registration-callback/route.ts";
const SELECT = "lib/payments/registrationCallbackSelection.ts";
const S6 = "scripts/s6-content-contract.mts";

type Files = Record<string, string>;
const load = (): Files => {
  const files: Files = {};
  for (const p of [...Object.values(M), PKG1C, ROUTE, SELECT, S6, "supabase/baseline/v3/bootstrap.sql"]) files[p] = read(p);
  files["@migrations"] = readdirSync(new URL("supabase/migrations/", root)).filter((f) => f.endsWith(".sql")).sort().join("\n");
  return files;
};

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
// Everything outside function bodies and DO blocks (the "statement layer" of a migration).
const statementLayer = (sql: string) => stripComments(sql).replace(/create or replace function[\s\S]*?\$function\$;/g, "").replace(/do \$\$[\s\S]*?end \$\$;/g, "");
const fnBody = (sql: string) => {
  const m = /as \$function\$\n([\s\S]*?)\$function\$;/.exec(sql);
  if (!m) throw new Error("function body not found");
  return m[1];
};
const between = (text: string, start: string, end: string) => {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start.slice(0, 60)}`);
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`end marker not found: ${end.slice(0, 60)}`);
  return text.slice(i, j);
};
// The body of a function as Baseline V3 defines it (quoted-identifier pg_dump style, "AS $$ ... $$;").
const baselineBody = (bootstrap: string, header: string) => {
  const i = bootstrap.indexOf(header);
  if (i < 0) throw new Error(`baseline function not found: ${header}`);
  const start = bootstrap.indexOf("AS $$\n", i) + "AS $$\n".length;
  return bootstrap.slice(start, bootstrap.indexOf("\n$$;", start) + 1);
};

const SIGS = {
  a1: "create or replace function app.public_registration_payment_state_guard()\n returns trigger\n language plpgsql\nas $function$",
  a2: "create or replace function public.finalize_public_registration_payment_from_callback(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'pg_catalog', 'public', 'app'\nas $function$",
  a3: "create or replace function public.verify_public_registration_manual_payment(p_registration_reference text, p_registration_secret text, p_amount numeric, p_payment_reference text, p_notes text default null::text, p_verifier_id uuid default null::uuid)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'pg_catalog', 'public', 'app', 'extensions'\nas $function$",
  a4: "create or replace function public.begin_public_registration_payment(p_registration_reference text, p_registration_secret text, p_provider text default 'toyyibpay'::text)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'pg_catalog', 'public', 'extensions'\nas $function$",
} as const;
const PINS = { a1: "72758ed85418fdfdaadd414fb4dad917", a2: "6193a289cf03f8fc9cb3fa5b4e4c52b8", a3: "b8ad44d4ad70f1412fbfe184e03fdc96", a4: "f39fbc4261fbc8043a4d6e45ef86059d" } as const;
const MARKERS = { a1: "pkg1d_late_success_guard", a2: "pkg1d_late_success_recording", a3: "pkg1d_manual_payment_states", a4: "pkg1d_begin_paid_guard" } as const;
const ACL = { a1: "guard", a2: "cb", a3: "manual", a4: "begin" } as const;
const TAG = { a1: "a1", a2: "a2", a3: "a3", a4: "a4" } as const;

const CHECKS: { name: string; run: (f: Files) => void }[] = [
  // R1 (owner-approved R1-G1, 22 Nov 2026): the R1 A5 migration is the one named file allowed after PKG-1d-A; its
  // content is proven by scripts/r1-schedule-finalization-contract.mts.
  { name: "tepat empat migrasi PKG-1d-A, selepas PKG-1c, diikuti hanya oleh R1 A5 yang dinamakan", run: (f) => {
    const all = f["@migrations"].split("\n");
    const names = Object.values(M).map((p) => p.split("/").pop()!);
    // PKG-1d-B-DB-G1 (owner-approved, 22 Nov 2026): exactly these six named files follow A5 (removed here, then the R1
    // checks below run unchanged); scripts/pkg1d-b-db-staff-bank-transfer-contract.mts proves their content.
    assert.deepEqual(all.splice(-6), ["20261124100000_public_registration_manual_payment_already_paid_guard.sql",
      "20261124101000_payment_receiving_accounts.sql", "20261124102000_public_registration_staff_request_id.sql",
      "20261124103000_public_registration_additional_funds.sql", "20261124104000_public_registration_additional_funds_rpcs.sql",
      "20261124105000_public_registration_staff_bank_transfer_rpc.sql"]);
    assert.equal(all.at(-1), "20261122124000_public_registration_schedule_finalizable_guard.sql");
    assert.deepEqual(all.slice(-5, -1), names);
    assert.equal(all.at(-6), PKG1C.split("/").pop());
    for (const n of names) assert.equal(all.filter((x) => x.slice(0, 14) === n.slice(0, 14)).length, 1, `unique version ${n}`);
  } },
  ...(Object.keys(M) as (keyof typeof M)[]).flatMap((k) => [
    { name: `${k.toUpperCase()}: satu CREATE OR REPLACE FUNCTION dengan tandatangan, SECURITY DEFINER dan search_path tepat`, run: (f: Files) => {
      const sql = f[M[k]];
      assert.equal((stripComments(sql).match(/create\s+or\s+replace\s+function/gi) ?? []).length, 1);
      assert.ok(sql.includes(SIGS[k]), "exact function header");
    } },
    { name: `${k.toUpperCase()}: tiada DDL/DML lain di luar badan fungsi dan blok DO (tiada GRANT, REVOKE, ALTER, DROP, jadual, polisi, trigger)`, run: (f: Files) => {
      const layer = statementLayer(f[M[k]]);
      assert.doesNotMatch(layer, /\b(grant|revoke|alter|drop|truncate|insert|update|delete|comment|security|create)\b/i, layer.trim().slice(0, 200));
    } },
    { name: `${k.toUpperCase()}: prasyarat md5 dipin (${PINS[k].slice(0, 8)}...), bilangan overload dan penanda idempoten`, run: (f: Files) => {
      const pre = f[M[k]].slice(0, f[M[k]].indexOf("create or replace function"));
      assert.ok(pre.includes(`v_md5 <> '${PINS[k]}' and position('${MARKERS[k]}' in v_src) = 0 then`), "md5 pin or marker");
      assert.match(pre, new RegExp(`raise exception 'pkg1d_${TAG[k]}_precondition_failed: [^']*differs from`));
      assert.match(pre, /<> 1 then\n\s+raise exception 'pkg1d_\w+_precondition_failed: expected exactly one/);
      assert.ok(pre.includes(`perform set_config('pkg1d.acl_${ACL[k]}', coalesce((select proacl::text from pg_proc where oid = `), "ACL captured");
    } },
    { name: `${k.toUpperCase()}: pasca-syarat menolak sebarang perubahan hak (ACL), SECURITY DEFINER dan penanda`, run: (f: Files) => {
      const post = f[M[k]].slice(f[M[k]].lastIndexOf("$function$;"));
      assert.match(post, new RegExp(`'null'\\) <> current_setting\\('pkg1d\\.acl_${ACL[k]}'\\) then\\n\\s+raise exception 'pkg1d_${TAG[k]}_postcondition_failed: privileges`));
      assert.ok(post.includes(`position('${MARKERS[k]}' in (select prosrc from pg_proc where oid = `), "marker postcondition");
      assert.match(post, k === "a1" ? /if \(select prosecdef from pg_proc where oid = v_guard\) then/ : /if not \(select prosecdef from pg_proc where oid = v_fn|if not \(select prosecdef from pg_proc where oid = v_cb/);
    } },
  ]),
  { name: "A1: provenance -- hanya fungsi callback (pemilik SECURITY DEFINER + penanda transaksi) boleh failed|cancelled -> paid", run: (f) => {
    const body = fnBody(f[M.a1]);
    const block = between(body, "if tg_op = 'UPDATE' and old.status in ('failed', 'cancelled') and new.status = 'paid' then", "    return new;\n  end if;");
    for (const needle of [
      "to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)')",
      "(select r.oid from pg_roles r where r.rolname = current_user) is distinct from v_callback_owner",
      "coalesce(current_setting('app.pkg1d_late_success_attempt', true), '') <> new.id::text",
      "new.payment_provider <> 'toyyibpay'", "new.provider_bill_code is null",
      "nullif(btrim(coalesce(new.provider_transaction_id, '')), '') is null",
      "(old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id)",
      "new.verified_amount is null", "round(new.verified_amount, 2) <> round(new.amount, 2)", "new.verified_at is null",
      "new.amount is distinct from old.amount", "new.registration_id is distinct from old.registration_id",
      "new.provider_bill_code is distinct from old.provider_bill_code", "not (coalesce(new.raw_response, '{}'::jsonb) ? 'late_success')",
      "raise exception 'invalid_late_success_transition'",
    ]) assert.ok(block.includes(needle), needle);
  } },
  { name: "A1: selepas blok baharu, badan pengawal asal (Baseline V3) kekal tepat", run: (f) => {
    const original = baselineBody(f["supabase/baseline/v3/bootstrap.sql"], 'CREATE OR REPLACE FUNCTION "app"."public_registration_payment_state_guard"()');
    const body = fnBody(f[M.a1]);
    const rest = body.slice(body.indexOf("    return new;\n  end if;\n") + "    return new;\n  end if;\n".length);
    assert.equal(squash(rest), squash(original.replace(/^begin\n/, "")));
  } },
  { name: "A2: amaun berbeza disimpan sebagai bukti (dikunci txn), tidak paid, txn tidak disimpan, tiada raise", run: (f) => {
    const body = fnBody(f[M.a2]);
    assert.doesNotMatch(body, /raise exception 'payment_amount_mismatch'/);
    const block = between(body, "if v_amount <> round(v_attempt.amount, 2)", "return jsonb_build_object('outcome', 'amount_mismatch'");
    assert.ok(block.includes("v_amount <> round(v_registration.amount_snapshot, 2)"));
    assert.ok(block.includes("if not coalesce(v_attempt.raw_response -> 'amount_mismatch' ? v_txn, false) then"), "once per transaction id");
    assert.ok(block.includes("raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch'"), "merged evidence");
    assert.doesNotMatch(block, /status\s*=|provider_transaction_id\s*=|verified_amount\s*=|finalize_public_registration_crm/);
    assert.ok(block.includes("'event', 'amount_mismatch_recorded'"));
  } },
  { name: "A2: satu txn satu rekod wang -- konflik dikesan sebelum sebarang tulisan status, tiada tulis ganti txn", run: (f) => {
    const body = fnBody(f[M.a2]);
    const block = between(body, "select id into v_other from public.public_registration_payments", "return jsonb_build_object('outcome', 'transaction_conflict'");
    assert.ok(block.includes("where payment_provider = 'toyyibpay' and provider_transaction_id = v_txn and id <> v_attempt.id"));
    assert.ok(block.includes("(v_attempt.provider_transaction_id is not null and v_attempt.provider_transaction_id <> v_txn)"));
    assert.doesNotMatch(block, /set status|provider_transaction_id = v_txn,/);
    assert.ok(body.indexOf("transaction_conflict") < body.indexOf("if v_attempt.status in ('failed', 'cancelled') then"));
    assert.ok(body.includes("if v_attempt.status = 'paid' then\n    if v_attempt.provider_transaction_id = btrim(p_provider_transaction_id)\n       and v_attempt.verified_amount = p_verified_amount then\n      return jsonb_build_object('outcome', 'duplicate_ignored');\n    end if;\n    raise exception 'paid_attempt_conflict'"), "replay rules unchanged");
  } },
  { name: "A2: kejayaan lewat pada failed/cancelled direkod paid dengan bukti digabung, tanpa peruntukan kerusi", run: (f) => {
    const body = fnBody(f[M.a2]);
    const block = between(body, "if v_attempt.status in ('failed', 'cancelled') then", "  if v_registration.registration_status in ('cancelled', 'expired') then");
    for (const needle of [
      "perform set_config('app.pkg1d_late_success_attempt', v_attempt.id::text, true);",
      "set status = 'paid',", "verified_amount = v_amount,", "provider_transaction_id = v_txn,", "verified_at = now(),",
      "raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object(", "'late_success', jsonb_build_object(",
      "'provenance', 'toyyibpay_get_bill_transactions'", "perform set_config('app.pkg1d_late_success_attempt', '', true);",
      "if v_registration.payment_status = 'failed' then\n      update public.public_registrations set payment_status = 'processing'",
      "and payment_provider = 'toyyibpay' and status in ('pending', 'processing')", "'event', 'late_success_recorded'", "'seat_allocated', false",
      "return jsonb_build_object('outcome', 'reconciliation_required'",
    ]) assert.ok(block.includes(needle), needle);
    assert.doesNotMatch(block, /finalize_public_registration_crm|course_schedules|schedule_participants/, "no allocation");
  } },
  { name: "A2: cabang biasa dan cabang PKG-1c pendaftaran tamat sama dengan PKG-1c (pengawal kapasiti kekal)", run: (f) => {
    const tail = (sql: string) => { const b = fnBody(sql.slice(sql.indexOf("create or replace function public.finalize_public_registration_payment_from_callback"))); return b.slice(b.indexOf("  if v_registration.registration_status in ('cancelled', 'expired') then")); };
    assert.equal(tail(f[M.a2]), tail(f[PKG1C]));
    const head = (sql: string) => { const b = fnBody(sql.slice(sql.indexOf("create or replace function public.finalize_public_registration_payment_from_callback"))); return b.slice(b.indexOf("  if auth.role() <> 'service_role' then"), b.indexOf("  if v_attempt.status = 'paid' then")); };
    assert.ok(head(f[M.a2]).includes("raise exception 'not_authorized' using errcode = '42501';"));
    assert.ok(head(f[M.a2]).includes("from public.public_registrations pr\n  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)\n  for update;"), "registration locked first");
  } },
  { name: "A3: pindahan bank -- kebenaran dan semakan amaun kekal; failed melangkah melalui processing; tamat direkod tanpa kerusi", run: (f) => {
    const body = fnBody(f[M.a3]);
    for (const needle of [
      "if auth.role() <> 'service_role' and not app.is_admin() then",
      "where id = v_verifier_id and is_active = true and role in ('admin', 'super_admin')",
      "raise exception 'manual_payment_amount_mismatch'",
      "if v_registration.payment_status in ('pending', 'failed') then\n    update public.public_registrations set payment_status = 'processing'",
      "if v_ended or v_payment_status <> 'paid' then\n    return jsonb_build_object('outcome', 'reconciliation_required'",
      "'event', 'manual_payment_recorded'",
    ]) assert.ok(body.includes(needle), needle);
    assert.doesNotMatch(body, /registration_not_verifiable/);
    assert.ok(body.indexOf("'reconciliation_required'") < body.indexOf("return public.finalize_public_registration_crm(v_registration.id);"));
  } },
  { name: "A4: begin menolak payment_status 'paid'; selebihnya badan Baseline V3 yang tepat", run: (f) => {
    const body = fnBody(f[M.a4]);
    const guard = "  -- pkg1d_begin_paid_guard: a registration that is already paid must never be offered another bill.\n  if v_registration.payment_status = 'paid' then\n    raise exception 'registration_already_paid' using errcode = 'P0001';\n  end if;\n";
    assert.equal(body.split(guard).length, 2);
    const original = baselineBody(f["supabase/baseline/v3/bootstrap.sql"], 'CREATE OR REPLACE FUNCTION "public"."begin_public_registration_payment"(');
    assert.equal(body.replace(guard, ""), original);
    assert.ok(body.indexOf("registration_already_paid") < body.indexOf("from public.public_registration_payments"), "before any attempt is read");
  } },
  { name: "B2: laluan callback menggunakan pemilih tulen; tiada baris pertama; status callback hanya untuk hash", run: (f) => {
    const route = f[ROUTE];
    assert.ok(route.includes('import { selectProviderOutcome } from "../../../../../lib/payments/registrationCallbackSelection";'));
    assert.ok(route.includes("const outcome = selectProviderOutcome(transactions, value.billcode, value.refno);"));
    assert.doesNotMatch(route, /transactions\.find\(|transactions\[0\]/);
    assert.equal((route.match(/value\.status/g) ?? []).length, 2, "callback status only in the required-field and hash checks");
    assert.ok(route.includes("verifyCallbackHash({ status: value.status, orderId: value.orderId, refno: value.refno, hash: value.hash })"));
    assert.ok(route.includes('if (outcome.kind === "failed") {'));
    assert.doesNotMatch(route.slice(route.indexOf("const outcome")), /logEvent\([^)]*raw/, "raw provider rows are never logged");
  } },
  { name: "B2: modul pemilih tulen (tiada import, rangkaian, env atau I/O)", run: (f) => {
    const src = f[SELECT];
    assert.doesNotMatch(src, /^\s*import\s/m);
    assert.doesNotMatch(src, /\b(fetch|process\.env|require\(|readFile|writeFile|console\.)/);
    assert.match(src, /export function selectProviderOutcome</);
  } },
  { name: "S6: entri tepat untuk empat migrasi, laluan callback dan modul pemilih", run: (f) => {
    for (const p of [...Object.values(M).map((x) => `?? ${x}`), ` M ${ROUTE}`, `?? ${SELECT}`]) assert.equal(f[S6].split(`"${p}"`).length, 2, p);
  } },
];

const failuresOf = (files: Files): string[] => {
  const out: string[] = [];
  for (const c of CHECKS) {
    try { c.run(files); } catch (error) { out.push(`${c.name}: ${(error as Error).message.split("\n")[0]}`); }
  }
  return out;
};

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};

const files = load();
for (const c of CHECKS) {
  try { c.run(files); report(true, c.name); } catch (error) { report(false, c.name, (error as Error).message.split("\n")[0]); }
}

// Negative mutations of the static layer. M16/M17 are PKG1D-SPLIT-DESIGN.md's; S1-S4 guard the scope.
const MUTATIONS: { id: string; name: string; file: string; from: string; to: string }[] = [
  { id: "M16", name: "pasca-syarat ACL dibuang (A2)", file: M.a2, from: "    raise exception 'pkg1d_a2_postcondition_failed: privileges of the callback finalization function changed' using errcode = 'P0001';", to: "    null;" },
  { id: "M17", name: "GRANT EXECUTE kepada anon ditambah (A3)", file: M.a3, from: "\ndo $$\ndeclare\n  v_fn constant regprocedure := 'public.verify_public_registration_manual_payment", to: "\ngrant execute on function public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid) to anon;\n\ndo $$\ndeclare\n  v_fn constant regprocedure := 'public.verify_public_registration_manual_payment" },
  { id: "S1", name: "prasyarat md5 dibuang (A1)", file: M.a1, from: "v_md5 <> '72758ed85418fdfdaadd414fb4dad917' and ", to: "" },
  { id: "S2", name: "syarat provenance dibuang (A1)", file: M.a1, from: "       or coalesce(current_setting('app.pkg1d_late_success_attempt', true), '') <> new.id::text\n", to: "" },
  { id: "S3", name: "peruntukan kerusi automatik dalam cabang lewat (A2)", file: M.a2, from: "    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference,\n      'late_success', true);", to: "    return public.finalize_public_registration_crm(v_registration.id);" },
  { id: "S4", name: "laluan kembali memilih baris pertama (B2)", file: ROUTE, from: "const outcome = selectProviderOutcome(transactions, value.billcode, value.refno);", to: "const outcome = selectProviderOutcome(transactions.slice(0, 1), value.billcode, value.refno);" },
];
let caught = 0;
for (const m of MUTATIONS) {
  if (!files[m.file].includes(m.from)) { report(false, `${m.id} ${m.name}: teks sasaran mutasi tidak ditemui (tidak dikira)`); continue; }
  const broken = failuresOf({ ...files, [m.file]: files[m.file].replace(m.from, m.to) });
  if (broken.length) caught += 1;
  report(broken.length > 0, `${m.id} ${m.name}: ditolak oleh kontrak statik`, "tiada semakan gagal");
  if (broken.length) console.log(`      dikesan oleh: ${broken[0].slice(0, 140)}`);
}
report(caught === MUTATIONS.length, `${caught}/${MUTATIONS.length} mutasi statik ditolak`);

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak statik PKG-1d-A lulus");
process.exit(failures ? 1 : 0);
