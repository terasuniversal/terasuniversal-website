import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Static contract for PKG-1c: 20261122110000_public_registration_capacity_safe_finalization.sql replaces exactly the
// bodies of public.finalize_public_registration_crm and public.finalize_public_registration_payment_from_callback, and
// each new body equals the Baseline V3 (= Staging/Production) body plus only the approved PKG-1c block.
// No database or network. Behaviour, concurrency, rollback and mutations run in pkg1c-capacity-finalization-db-contract.mts.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const file = "20261122110000_public_registration_capacity_safe_finalization.sql";
const sql = read(`supabase/migrations/${file}`);
const baseline = read("supabase/baseline/v3/bootstrap.sql");
const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((n) => n.endsWith(".sql")).sort();
const strip = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
const squash = (text: string) => text.replace(/\s+/g, "");

const CRM_HEAD = "create or replace function public.finalize_public_registration_crm(p_registration_id uuid)";
const CB_HEAD = "create or replace function public.finalize_public_registration_payment_from_callback(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb)";
const newBody = (head: string) => {
  const at = sql.indexOf(head);
  assert.ok(at >= 0, `missing ${head}`);
  const start = sql.indexOf("as $function$", at) + "as $function$".length;
  return sql.slice(start, sql.indexOf("$function$;", start));
};
const baseBody = (name: string) => {
  const at = baseline.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"(`);
  assert.ok(at >= 0, `baseline missing ${name}`);
  const start = baseline.indexOf("AS $$", at) + "AS $$".length;
  return baseline.slice(start, baseline.indexOf("\n$$;", start));
};
const crm = newBody(CRM_HEAD);
const cb = newBody(CB_HEAD);
const guardStart = crm.indexOf("  -- pkg1c_capacity_guard");
const guardEnd = crm.indexOf("  for v_attendee in");
const guard = crm.slice(guardStart, guardEnd);
const branchStart = cb.indexOf("    if v_attempt.status = 'processing' then");
const branchEnd = cb.indexOf("    else\n", branchStart);
const branch = cb.slice(branchStart, branchEnd);

// PKG-1d-A (owner-approved, 22 Nov 2026): exactly these four named migrations may follow PKG-1c, in this order. Any
// other migration sorted after PKG-1c -- before, between or after them -- still fails this check.
const PKG1D_A_MIGRATIONS = [
  "20261122120000_public_registration_payment_guard_late_success.sql",
  "20261122121000_public_registration_late_success_recording.sql",
  "20261122122000_public_registration_manual_payment_states.sql",
  "20261122123000_public_registration_begin_payment_paid_guard.sql",
  // R1 (owner-approved R1-G1, 22 Nov 2026): A5, proven by scripts/r1-schedule-finalization-contract.mts.
  "20261122124000_public_registration_schedule_finalizable_guard.sql",
];
check("versi: selepas setiap versi migrasi yang diketahui (live dan cawangan lain), dan fail migrasi terakhir kecuali tepat empat migrasi PKG-1d-A dan R1 A5 yang dinamakan", () => {
  // Known on 21 Nov 2026: Production latest live 20261121112628 (PKG-1), Staging latest live 20261122095000 (CRM), CRM
  // branch files up to 20261122095000, PKG-1 file 20261122100000.
  for (const known of ["20261108100400", "20261119032421", "20261121112628", "20261121130000", "20261122095000", "20261122100000"]) assert.ok(file > known, `${file} <= ${known}`);
  assert.ok(migrations.includes(file), `missing ${file}`);
  assert.deepEqual(migrations.slice(migrations.indexOf(file) + 1), PKG1D_A_MIGRATIONS);
});
check("skop: tepat dua CREATE OR REPLACE FUNCTION, tandatangan tepat", () => {
  const code = strip(sql);
  const creates = code.match(/create\s+or\s+replace\s+function\s+[^\n(]+\(/gi) ?? [];
  assert.equal(creates.length, 2);
  assert.ok(code.includes(CRM_HEAD) && code.includes(CB_HEAD));
});
check("skop: tiada DDL/DML lain di luar badan fungsi (tiada grant, revoke, alter, drop, jadual, trigger, polisi, data)", () => {
  // Remove both function bodies and the guard DO blocks; what is left must be only the two function headers.
  const outside = strip(sql).replace(/as \$function\$[\s\S]*?\$function\$;/g, "").replace(/do \$\$[\s\S]*?end \$\$;/g, "");
  assert.doesNotMatch(outside, /\b(grant|revoke|alter|drop|truncate|insert|update|delete|create\s+(table|index|trigger|policy|type|schema|view)|comment\s+on|security\s+invoker)\b/i);
  assert.equal(squash(outside.replace(CRM_HEAD, "").replace(CB_HEAD, "").replace(/returns jsonb|language plpgsql|security definer|set search_path to 'pg_catalog', 'public', 'app'(, 'extensions')?/g, "")), "");
});
check("skop: SECURITY DEFINER dan search_path sama dengan definisi live", () => {
  assert.match(sql, /p_registration_id uuid\)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'pg_catalog', 'public', 'app', 'extensions'\nas \$function\$/);
  assert.match(sql, /p_raw_response jsonb\)\n returns jsonb\n language plpgsql\n security definer\n set search_path to 'pg_catalog', 'public', 'app'\nas \$function\$/);
});
check("prasyarat: menolak fungsi hilang, overload, dan badan yang tidak diketahui (md5 live disemat)", () => {
  assert.match(sql, /to_regprocedure\('public\.finalize_public_registration_crm\(uuid\)'\)/);
  assert.match(sql, /to_regprocedure\('public\.finalize_public_registration_payment_from_callback\(uuid,text,numeric,text,timestamptz,jsonb\)'\)/);
  assert.match(sql, /v_md5 <> '2cc828a6b557f110062eebacc7a455b4' and position\('pkg1c_capacity_guard' in v_src\) = 0 then\s+raise exception 'pkg1c_precondition_failed/);
  assert.match(sql, /v_md5 <> 'b696be946aef6dcd821774a4d76f8a09' and position\('pkg1c_late_success_paid' in v_src\) = 0 then\s+raise exception 'pkg1c_precondition_failed/);
  assert.match(sql, /<> 2 then\s+raise exception 'pkg1c_precondition_failed: expected exactly one overload/);
});
check("pasca-syarat: hak EXECUTE tidak berubah, SECURITY DEFINER, search_path, badan baharu", () => {
  assert.match(sql, /set_config\('pkg1c\.acl_crm'/);
  assert.match(sql, /<> current_setting\('pkg1c\.acl_crm'\)\s+or [^\n]+<> current_setting\('pkg1c\.acl_cb'\) then\s+raise exception 'pkg1c_postcondition_failed: privileges/);
  assert.match(sql, /prosecdef[^\n]+prosecdef[^\n]+then\s+raise exception 'pkg1c_postcondition_failed: a finalization function is no longer SECURITY DEFINER/);
  assert.match(sql, /is distinct from array\['search_path=pg_catalog, public, app, extensions'\]\s+or [^\n]+is distinct from array\['search_path=pg_catalog, public, app'\] then\s+raise exception 'pkg1c_postcondition_failed: search_path/);
});
check("finalize_crm: sama dengan badan Baseline V3/live kecuali blok PKG-1c dan tiga pemboleh ubah baharu", () => {
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  const declarations = "  v_used integer;\n  v_held integer;\n  v_needed integer;\n";
  assert.ok(crm.includes(declarations));
  const reverted = crm.replace(declarations, "").replace(guard, "");
  assert.equal(squash(reverted), squash(baseBody("finalize_public_registration_crm")));
});
check("finalize_crm: keputusan kapasiti selepas kunci jadual dan sebelum sebarang peserta/enrolmen dicipta", () => {
  const lock = crm.indexOf("from public.course_schedules\n  where id = v_registration.schedule_id\n  for update;");
  assert.ok(lock > 0 && lock < guardStart);
  assert.ok(guardStart < crm.indexOf("insert into public.participants"));
  assert.ok(guardStart < crm.indexOf("insert into public.schedule_participants"));
  assert.ok(guardStart < crm.indexOf("set registration_status = 'confirmed'"));
});
check("finalize_crm: kiraan kapasiti = enrolmen aktif + pegangan aktif orang lain + peserta diperlukan", () => {
  assert.match(guard, /from public\.schedule_participants sp\s+where sp\.schedule_id = v_registration\.schedule_id\s+and sp\.deleted_at is null\s+and sp\.registration_status <> 'cancelled';/);
  assert.match(guard, /coalesce\(sum\(pr\.attendee_count\), 0\)::integer into v_held\s+from public\.public_registrations pr\s+where pr\.schedule_id = v_registration\.schedule_id\s+and pr\.id <> v_registration\.id\s+and pr\.registration_status in \('pending_payment', 'payment_pending'\)\s+and pr\.hold_expires_at > now\(\);/);
  assert.match(guard, /v_needed := v_registration\.attendee_count;/);
  assert.match(guard, /if v_schedule\.capacity is null or v_used \+ v_held \+ v_needed > v_schedule\.capacity then/);
});
check("finalize_crm: tidak muat = paid_unallocated tanpa raise, tanpa peruntukan, hold dikosongkan, beraudit", () => {
  const branchCrm = guard.slice(guard.indexOf("if v_schedule.capacity is null"));
  assert.doesNotMatch(strip(branchCrm), /\braise\b|insert into|registration_status\s*=|payment_status\s*=/);
  assert.match(branchCrm, /update public\.public_registrations\s+set hold_expires_at = null\s+where id = v_registration\.id;/);
  assert.match(branchCrm, /perform public\.log_event_as_service\([\s\S]*'paid_unallocated'[\s\S]*\);/);
  assert.match(branchCrm, /return jsonb_build_object\(\s+'outcome', 'paid_unallocated',/);
  assert.doesNotMatch(branchCrm, /log_public_registration_payment_event/, "service-only logger would refuse the admin path");
});
check("callback: sama dengan badan Baseline V3/live kecuali cabang PKG-1c untuk pendaftaran tamat", () => {
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const reverted = cb.replace(branch + "    else\n", "")
    .replace("    end if;\n    perform public.log_public_registration_payment_event(", "    perform public.log_public_registration_payment_event(")
    .replace(",\n        'attempt_recorded_paid', v_attempt.status = 'processing')", ")");
  assert.equal(squash(reverted), squash(baseBody("finalize_public_registration_payment_from_callback")));
});
check("callback: bayaran lewat (processing) ditanda paid tanpa peruntukan dan tanpa ubah status pendaftaran", () => {
  assert.ok(cb.indexOf("if v_registration.registration_status in ('cancelled', 'expired') then") < branchStart);
  assert.match(branch, /set status = 'paid',\s+verified_amount = round\(p_verified_amount, 2\),\s+provider_transaction_id = btrim\(p_provider_transaction_id\),\s+verified_at = now\(\),/);
  assert.match(branch, /if v_registration\.payment_status in \('pending', 'processing'\) then\s+update public\.public_registrations\s+set payment_status = 'paid'\s+where id = v_registration\.id;\s+end if;/);
  assert.doesNotMatch(branch, /finalize_public_registration_crm|registration_status\s*=|insert into|schedule_participants/);
  assert.match(cb, /'late_success_after_expiry'/, "reuses the existing whitelisted payment event");
});
check("tiada status, acara atau nilai baharu selain yang diluluskan", () => {
  // Comments are removed first: an apostrophe in a comment would otherwise pair with a real quote.
  const literals = (text: string) => new Set(strip(text).match(/'[^']*'/g) ?? []);
  const before = new Set([...literals(baseBody("finalize_public_registration_crm")), ...literals(baseBody("finalize_public_registration_payment_from_callback"))]);
  const added = [...literals(crm), ...literals(cb)].filter((l) => !before.has(l)).sort();
  // 'update' is the existing public.audit_action value (already used by log_public_registration_payment_event).
  assert.deepEqual(added, ["'Public registration paid but not allocated (capacity): '", "'attempt_recorded_paid'", "'capacity'", "'event'", "'held'", "'needed'", "'paid_unallocated'", "'update'", "'used'"]);
});
check("S6: tepat satu entri allowlist untuk migrasi ini", () => {
  const s6 = read("scripts/s6-content-contract.mts");
  assert.equal(s6.split(`"?? supabase/migrations/${file}"`).length - 1, 1);
});
check("kontrak DB: hanya Docker pakai buang, data sintetik, mutasi dan perlumbaan dua sesi", () => {
  const runner = read("scripts/pkg1c-capacity-finalization-db-contract.mts");
  assert.match(runner, /if \(process\.env\.DATABASE_URL \|\| process\.env\.SUPABASE_DB_URL \|\| process\.env\.SUPABASE_URL\) \{\s+throw new Error/);
  assert.match(runner, /const image = "public\.ecr\.aws\/supabase\/postgres:17\.6\.1\.166";/);
  assert.match(runner, /finally \{\s+try \{ docker\(\["rm", "-f", container\]\); \}/);
  assert.match(runner, /wait_event_type = 'Lock'/);
  assert.ok((runner.match(/\{ name: "M\d+ /g) ?? []).length >= 10);
  assert.doesNotMatch(runner + read("scripts/pkg1c-capacity-finalization-db-contract.sql"), /supabase\.co|iagzkrzeuawaxvacqprk|eokiaehnvzbggmacifcf|toyyibpay\.com/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak statik PKG-1c lulus");
process.exit(failures ? 1 : 0);
