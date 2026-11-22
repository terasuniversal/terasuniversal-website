import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// R1 (A5) static contract. Proves, from the files alone, that the migration changes exactly the two approved payment
// functions; that each new body equals its PKG-1d-A body (A2 / A3) plus only the r1_schedule_guard block and its
// variable declarations; that the guard locks the schedule row and has no exception handler or error-message
// matching; and that nothing else (grants, other functions, the CRM finalization) is touched. The behaviour is proven
// by scripts/r1-schedule-finalization-db-contract.mts on a disposable database.

const read = async (p: string) => (await readFile(p, "utf8")).replace(/\r\n/g, "\n");
const A5_FILE = "supabase/migrations/20261122124000_public_registration_schedule_finalizable_guard.sql";
// The exact named R1 lines in the three existing contracts (s6-content, PKG-1c static, PKG-1d-A static), in that order.
const R1_GUARD_LINES = [
  "-    \" M app/api/payments/toyyibpay/registration-callback/route.ts\", \"?? lib/payments/registrationCallbackSelection.ts\"]);",
  "+    \" M app/api/payments/toyyibpay/registration-callback/route.ts\", \"?? lib/payments/registrationCallbackSelection.ts\",",
  "+    // R1 (owner-approved R1-G1, 22 Nov 2026): exactly this one migration (A5), which keeps a verified payment when the",
  "+    // schedule is cancelled/completed; scripts/r1-schedule-finalization-contract.mts proves its content.",
  "+    \"?? supabase/migrations/20261122124000_public_registration_schedule_finalizable_guard.sql\"]);",
  "+  // R1 (owner-approved R1-G1, 22 Nov 2026): A5, proven by scripts/r1-schedule-finalization-contract.mts.",
  "+  \"20261122124000_public_registration_schedule_finalizable_guard.sql\",",
  "-check(\"versi: selepas setiap versi migrasi yang diketahui (live dan cawangan lain), dan fail migrasi terakhir kecuali tepat empat migrasi PKG-1d-A yang dinamakan\", () => {",
  "+check(\"versi: selepas setiap versi migrasi yang diketahui (live dan cawangan lain), dan fail migrasi terakhir kecuali tepat empat migrasi PKG-1d-A dan R1 A5 yang dinamakan\", () => {",
  "-  { name: \"tepat empat migrasi PKG-1d-A, selepas PKG-1c dan merupakan fail terakhir\", run: (f) => {",
  "+  // R1 (owner-approved R1-G1, 22 Nov 2026): the R1 A5 migration is the one named file allowed after PKG-1d-A; its",
  "+  // content is proven by scripts/r1-schedule-finalization-contract.mts.",
  "+  { name: \"tepat empat migrasi PKG-1d-A, selepas PKG-1c, diikuti hanya oleh R1 A5 yang dinamakan\", run: (f) => {",
  "-    assert.deepEqual(all.slice(-4), names);",
  "-    assert.equal(all.at(-5), PKG1C.split(\"/\").pop());",
  "+    assert.equal(all.at(-1), \"20261122124000_public_registration_schedule_finalizable_guard.sql\");",
  "+    assert.deepEqual(all.slice(-5, -1), names);",
  "+    assert.equal(all.at(-6), PKG1C.split(\"/\").pop());",
];
const [a5, a2, a3] = await Promise.all([
  read(A5_FILE),
  read("supabase/migrations/20261122121000_public_registration_late_success_recording.sql"),
  read("supabase/migrations/20261122122000_public_registration_manual_payment_states.sql"),
]);
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, "");
// Outside the two function bodies (the bodies themselves are proven equal to A2 / A3 + guard in section 4).
const code = sqlCode(a5.replace(/\$function\$[\s\S]*?\$function\$/g, "$function$<body>$function$"));

// 1. Exactly two function definitions, the approved ones; nothing else is created, granted, revoked or dropped.
const defs = [...a5.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)\(/gi)].map((m) => m[1]);
assert.deepEqual(defs, ["public.finalize_public_registration_payment_from_callback", "public.verify_public_registration_manual_payment"], "only the two payment functions are redefined");
assert.ok(!/finalize_public_registration_crm\s*\(\s*p_registration_id/i.test(code), "finalize_public_registration_crm is not redefined");
assert.ok(!/\b(grant|revoke|drop|alter\s+(function|table|role)|create\s+(table|trigger|index|policy|role|schema)|truncate|insert\s+into|delete\s+from)\b/i.test(code), "no grants, drops, DDL or data changes");
assert.ok(!/security\s+invoker/i.test(code), "no SECURITY INVOKER");

// 2. Fail-closed: no exception handler and no error-message matching anywhere in the migration (bodies included).
assert.ok(!/exception\s+when|when\s+others|sqlerrm|sqlstate\s*=|get\s+stacked\s+diagnostics/i.test(sqlCode(a5)), "no exception handler and no error-text matching");

// 3. The guard: twice, identical shape, schedule row locked, placed immediately before the CRM finalization.
const RET = "  return public.finalize_public_registration_crm(v_registration.id);";
const bodyOf = (text: string, name: string) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`) >= 0 ? text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`) : text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} definition found`);
  const open = text.indexOf("$function$", start) + "$function$".length;
  const close = text.indexOf("$function$", open);
  return text.slice(open, close);
};
const cbNew = bodyOf(a5, "finalize_public_registration_payment_from_callback");
const vfNew = bodyOf(a5, "verify_public_registration_manual_payment");
for (const [name, body] of [["callback", cbNew], ["manual", vfNew]] as const) {
  const g = body.indexOf("  -- r1_schedule_guard:");
  const r = body.indexOf(RET);
  assert.ok(g > 0 && r > g, `${name}: the guard precedes the CRM finalization`);
  const block = body.slice(g, r);
  assert.equal(body.split(RET).length, 2, `${name}: exactly one CRM finalization call`);
  assert.match(block, /select cs\.status::text into v_schedule_status\n  from public\.course_schedules cs\n  where cs\.id = v_registration\.schedule_id\n  for update;/, `${name}: the schedule row is locked FOR UPDATE`);
  assert.match(block, /  if not found or v_schedule_status in \('cancelled', 'completed'\) then\n/, `${name}: missing, cancelled and completed are detected`);
  assert.match(block, /update public\.public_registrations set hold_expires_at = null where id = v_registration\.id;/, `${name}: the hold is released`);
  assert.match(block, /'schedule_not_finalizable', *\n? *jsonb_build_object\('schedule_status'/, `${name}: evidence is appended to raw_response`);
  assert.equal([...block.matchAll(/perform public\.log_event_as_service\(/g)].length, 1, `${name}: exactly one audit event`);
  assert.match(block, /'event', 'schedule_not_finalizable_recorded'/, `${name}: named audit event`);
  assert.match(block, /return jsonb_build_object\('outcome', 'reconciliation_required', 'reason', 'schedule_not_finalizable',/, `${name}: reconciliation outcome`);
  assert.ok(!/update public\.public_registration_payments\s+set status|status\s*=\s*'(paid|refunded|cancelled)'|insert|delete|registration_status\s*=|update public\.course_schedules|update public\.participants|schedule_participants/i.test(block),
    `${name}: the guard changes no payment status, registration status, schedule, participant or enrolment`);
  assert.equal([...body.matchAll(/r1_schedule_guard/g)].length, 1, `${name}: one marker`);
}

// 4. Each new body is its PKG-1d-A body plus ONLY the guard block and the added declarations (byte-for-byte otherwise).
const strip = (body: string, extraDecl: string) => {
  const g = body.indexOf("  -- r1_schedule_guard:");
  const r = body.indexOf(RET);
  return body.slice(0, g).replace(extraDecl, "") + body.slice(r);
};
assert.equal(strip(cbNew, "  v_schedule_status text;\n"), bodyOf(a2, "finalize_public_registration_payment_from_callback"),
  "callback = PKG-1d-A A2 body + guard only");
assert.equal(strip(vfNew, "  v_schedule_status text;\n  v_actor uuid;\n  v_actor_email text;\n"), bodyOf(a3, "verify_public_registration_manual_payment"),
  "manual = PKG-1d-A A3 body + guard only");

// 5. Signatures, SECURITY DEFINER and search_path as in A2 / A3.
assert.match(a5, /CREATE OR REPLACE FUNCTION public\.finalize_public_registration_payment_from_callback\(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb\)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public', 'app'\n/);
assert.match(a5, /CREATE OR REPLACE FUNCTION public\.verify_public_registration_manual_payment\(p_registration_reference text, p_registration_secret text, p_amount numeric, p_payment_reference text, p_notes text DEFAULT NULL::text, p_verifier_id uuid DEFAULT NULL::uuid\)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'\n/);

// 6. Pinned preconditions and asserted postconditions.
for (const pin of ["9e6a173e5e58c216dced5d32b2bd503a", "0cdbb4fe6fbf9e81f0dded545ca7c30e", "fe568112a7c9a2ae8ad765557dc5f8c6"]) assert.ok(a5.includes(`'${pin}'`), `md5 pin ${pin}`);
for (const msg of ["privileges of a payment function changed", "owner of a payment function changed", "a payment function is no longer SECURITY DEFINER",
  "search_path of a payment function changed", "new payment function bodies are not in place", "finalize_public_registration_crm changed"]) {
  assert.ok(a5.includes(`r1_a5_postcondition_failed: ${msg}`), `postcondition: ${msg}`);
}
assert.ok(!/\r/.test(await readFile(A5_FILE, "utf8")), "the migration is LF-only");

// 7. Scope: only the migration, the two R1 scripts and the named R1 lines in the two public-site scope guards.
const base = process.env.TERAS_R1_BASE ?? "771db3acadb5d7514dea6f436e2d1e1ca2cb3531";
let changed: string[] = [];
try {
  const tracked = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  changed = [...new Set([...tracked.split("\n"), ...untracked.split("\n")].map((s) => s.trim()).filter(Boolean))];
} catch {
  changed = [];
}
if (changed.length > 0) {
  const allowed = new Set([A5_FILE, "scripts/r1-schedule-finalization-contract.mts", "scripts/r1-schedule-finalization-db-contract.mts",
    "scripts/s6-content-contract.mts", "scripts/pkg1c-capacity-finalization-contract.mts", "scripts/pkg1d-a-payment-integrity-contract.mts"]);
  for (const f of changed) assert.ok(allowed.has(f), `changed file is in scope: ${f}`);
  // The three existing contracts: exactly the named R1 lines, nothing else (an exact list, so widening fails here).
  const diffLines = (path: string) => execFileSync("git", ["diff", "-U0", base, "--", path], { encoding: "utf8" }).replace(/\r/g, "")
    .split("\n").filter((l) => /^[+-](?![+-])/.test(l));
  assert.deepEqual([...diffLines("scripts/s6-content-contract.mts"), ...diffLines("scripts/pkg1c-capacity-finalization-contract.mts"),
    ...diffLines("scripts/pkg1d-a-payment-integrity-contract.mts")], R1_GUARD_LINES, "existing contracts changed only by the named R1 lines");
}

console.log("R1 static contract passed.");
