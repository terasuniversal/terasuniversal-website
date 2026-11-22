import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// PKG-1d-B-DB-G1 static contract. Proves, from the files alone, that the six migrations (M0, M1a, M2, AF1a, AF1b, M3)
// contain exactly the approved objects and safeguards; that M0 and M3 keep the R1 A5 r1_schedule_guard block
// byte-for-byte; that no exception handler, error-text matching, destructive statement, real account data or extra grant
// exists; and that nothing else in the repository changed except the named DB-G1 lines in four existing contracts.
// Behaviour is proven by scripts/pkg1d-b-db-staff-bank-transfer-db-contract.mts on a disposable database.

const raw = (p: string) => readFile(p, "utf8");
const read = async (p: string) => (await raw(p)).replace(/\r\n/g, "\n");
const MIG = {
  m0: "supabase/migrations/20261124100000_public_registration_manual_payment_already_paid_guard.sql",
  m1a: "supabase/migrations/20261124101000_payment_receiving_accounts.sql",
  m2: "supabase/migrations/20261124102000_public_registration_staff_request_id.sql",
  af1a: "supabase/migrations/20261124103000_public_registration_additional_funds.sql",
  af1b: "supabase/migrations/20261124104000_public_registration_additional_funds_rpcs.sql",
  m3: "supabase/migrations/20261124105000_public_registration_staff_bank_transfer_rpc.sql",
} as const;
const A5 = "supabase/migrations/20261122124000_public_registration_schedule_finalizable_guard.sql";
const DB_CONTRACT = ["scripts/pkg1d-b-db-staff-bank-transfer-db-contract.mts", "scripts/pkg1d-b-db-staff-bank-transfer-db-contract.sql"];
const SELF = "scripts/pkg1d-b-db-staff-bank-transfer-contract.mts";
// The exact named DB-G1 lines in the four existing contracts (vs the R1 commit), in this order.
const DBG1_LINES = [
  "+  // PKG-1d-B-DB-G1 (owner-approved, 22 Nov 2026): exactly these six migrations (M0, M1a, M2, AF1a, AF1b, M3);",
  "+  // scripts/pkg1d-b-db-staff-bank-transfer-contract.mts proves their content.",
  "+  for (const extra of [\"?? supabase/migrations/20261124100000_public_registration_manual_payment_already_paid_guard.sql\",",
  "+    \"?? supabase/migrations/20261124101000_payment_receiving_accounts.sql\", \"?? supabase/migrations/20261124102000_public_registration_staff_request_id.sql\",",
  "+    \"?? supabase/migrations/20261124103000_public_registration_additional_funds.sql\", \"?? supabase/migrations/20261124104000_public_registration_additional_funds_rpcs.sql\",",
  "+    \"?? supabase/migrations/20261124105000_public_registration_staff_bank_transfer_rpc.sql\"]) allowed.add(extra);",
  "+  // PKG-1d-B-DB-G1 (owner-approved, 22 Nov 2026): M0, M1a, M2, AF1a, AF1b, M3, proven by scripts/pkg1d-b-db-staff-bank-transfer-contract.mts.",
  "+  \"20261124100000_public_registration_manual_payment_already_paid_guard.sql\",",
  "+  \"20261124101000_payment_receiving_accounts.sql\",",
  "+  \"20261124102000_public_registration_staff_request_id.sql\",",
  "+  \"20261124103000_public_registration_additional_funds.sql\",",
  "+  \"20261124104000_public_registration_additional_funds_rpcs.sql\",",
  "+  \"20261124105000_public_registration_staff_bank_transfer_rpc.sql\",",
  "+    // PKG-1d-B-DB-G1 (owner-approved, 22 Nov 2026): exactly these six named files follow A5 (removed here, then the R1",
  "+    // checks below run unchanged); scripts/pkg1d-b-db-staff-bank-transfer-contract.mts proves their content.",
  "+    assert.deepEqual(all.splice(-6), [\"20261124100000_public_registration_manual_payment_already_paid_guard.sql\",",
  "+      \"20261124101000_payment_receiving_accounts.sql\", \"20261124102000_public_registration_staff_request_id.sql\",",
  "+      \"20261124103000_public_registration_additional_funds.sql\", \"20261124104000_public_registration_additional_funds_rpcs.sql\",",
  "+      \"20261124105000_public_registration_staff_bank_transfer_rpc.sql\"]);",
  "+  // PKG-1d-B-DB-G1 (owner-approved, 22 Nov 2026): its six migrations and three contract files; their content and the",
  "+  // exact named lines it adds to the existing contracts are proven by scripts/pkg1d-b-db-staff-bank-transfer-contract.mts.",
  "+  for (const f of [\"supabase/migrations/20261124100000_public_registration_manual_payment_already_paid_guard.sql\",",
  "+    \"supabase/migrations/20261124101000_payment_receiving_accounts.sql\", \"supabase/migrations/20261124102000_public_registration_staff_request_id.sql\",",
  "+    \"supabase/migrations/20261124103000_public_registration_additional_funds.sql\", \"supabase/migrations/20261124104000_public_registration_additional_funds_rpcs.sql\",",
  "+    \"supabase/migrations/20261124105000_public_registration_staff_bank_transfer_rpc.sql\", \"scripts/pkg1d-b-db-staff-bank-transfer-contract.mts\",",
  "+    \"scripts/pkg1d-b-db-staff-bank-transfer-db-contract.mts\", \"scripts/pkg1d-b-db-staff-bank-transfer-db-contract.sql\"]) allowed.add(f);",
  "-  const diffLines = (path: string) => execFileSync(\"git\", [\"diff\", \"-U0\", base, \"--\", path], { encoding: \"utf8\" }).replace(/\\r/g, \"\")",
  "+  // PKG-1d-B-DB-G1: compared within the R1 commit itself (base -> R1), so later packages' named lines are checked by their own contracts.",
  "+  const r1Commit = process.env.TERAS_R1_COMMIT ?? \"da93c70b500f502c682cf6e1c1676572030cfb1d\";",
  "+  const diffLines = (path: string) => execFileSync(\"git\", [\"diff\", \"-U0\", base, r1Commit, \"--\", path], { encoding: \"utf8\" }).replace(/\\r/g, \"\")"
];
const EXISTING = ["scripts/s6-content-contract.mts", "scripts/pkg1c-capacity-finalization-contract.mts",
  "scripts/pkg1d-a-payment-integrity-contract.mts", "scripts/r1-schedule-finalization-contract.mts"];

const sql = Object.fromEntries(await Promise.all(Object.entries(MIG).map(async ([k, p]) => [k, await read(p)]))) as Record<keyof typeof MIG, string>;
const a5 = await read(A5);
const comments = (s: string) => s.replace(/^\s*--.*$/gm, "");
const bodyOf = (text: string, name: string) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} definition found`);
  const open = text.indexOf("$function$", start) + "$function$".length;
  return text.slice(open, text.indexOf("$function$", open));
};
const RET = "  return public.finalize_public_registration_crm(v_registration.id);";
const r1Block = (body: string) => body.slice(body.indexOf("  -- r1_schedule_guard:"), body.indexOf(RET));
const a5Manual = bodyOf(a5, "verify_public_registration_manual_payment");

// 1. Files: LF only, and no destructive statement, exception handler or error-text matching anywhere.
for (const [k, p] of Object.entries(MIG)) {
  assert.ok(!/\r/.test(await raw(p)), `${k}: LF only`);
  const code = comments(sql[k as keyof typeof MIG]);
  assert.ok(!/\bdrop\s+(table|column|schema|type|function|view|policy)\b|\btruncate\b|\bdelete\s+from\b/i.test(code), `${k}: no destructive statement`);
  assert.ok(!/exception\s+when|when\s+others|sqlerrm|sqlstate\s*=|get\s+stacked\s+diagnostics/i.test(code), `${k}: no exception handler or error-text matching`);
  assert.ok(!/grant\s+[^;]*\bto\s+[^;]*\b(anon|public|service_role)\b(?![^;]*select)/i.test(code.replace(/grant select on table [^;]+;/gi, "")), `${k}: no EXECUTE/write grant to anon, public or service_role`);
  assert.ok(!/\b[0-9]{8,}\b/.test(code.replace(/\b2026112[0-9]{7}\b/g, "").replace(/\b10000000000\b/g, "").replace(/\b[0-9a-f]{32}\b/g, "")), `${k}: no account-number-like digit strings`);
}

// 2. M0: the A5 manual-payment body plus exactly the two named blocks (and their declarations), nothing else.
{
  const m0 = bodyOf(sql.m0, "verify_public_registration_manual_payment");
  assert.equal((comments(sql.m0).match(/create\s+or\s+replace\s+function/gi) ?? []).length, 1, "M0 redefines exactly one function");
  const guardStart = m0.indexOf("\n  -- r2_already_paid_guard:");
  const guardEnd = m0.indexOf("  end if;\n", m0.indexOf("raise exception 'registration_already_paid'", guardStart)) + "  end if;\n".length;
  const supStart = m0.indexOf("\n  -- r2_supersede_open_toyyibpay:");
  const supEnd = m0.indexOf("    end loop;\n  end if;\n", supStart) + "    end loop;\n  end if;\n".length;
  assert.ok(guardStart > 0 && guardEnd > guardStart && supStart > guardEnd && supEnd > supStart, "M0 blocks found in order");
  const stripped = (m0.slice(0, guardStart) + m0.slice(guardEnd, supStart) + m0.slice(supEnd)).replace("  v_superseded uuid[];\n  v_superseded_id uuid;\n", "");
  assert.equal(stripped, a5Manual, "M0 = A5 manual body + the two named blocks only (byte-for-byte otherwise)");
  assert.equal(r1Block(m0), r1Block(a5Manual), "M0 keeps the A5 r1_schedule_guard block");
  assert.match(m0.slice(supStart, supEnd), /'provider_cancellation_confirmed', false/);
  for (const pin of ["b13e9b7ff5d3c8ebf1be8443aa21fa0a", "4bfacda586181a3aacd7c8e02b4c7362", "fe568112a7c9a2ae8ad765557dc5f8c6", "b2a2c84993b50291b443bff288d8217d"]) {
    assert.ok(sql.m0.includes(`'${pin}'`), `M0 pins ${pin}`);
  }
  assert.ok(!/\b(grant|revoke)\b/i.test(comments(sql.m0)), "M0 changes no privilege");
}

// 3. M1a / M2: minimal account metadata, no account rows, guarded access, immutable evidence.
{
  const t = comments(sql.m1a);
  assert.match(t, /account_last4\s+text not null/);
  const table = t.slice(t.indexOf("create table if not exists public.payment_receiving_accounts"), t.indexOf(");", t.indexOf("create table if not exists public.payment_receiving_accounts")));
  assert.ok(table.length > 100 && !/account_(no|number)|iban|swift|holder|full_account/i.test(table), "M1a stores no full account number or holder identity");
  assert.ok(!/insert\s+into\s+public\.payment_receiving_accounts/i.test(t), "M1a inserts no account rows");
  assert.match(t, /enable row level security/);
  assert.match(t, /using \(app\.is_admin\(\)\)/);
  assert.match(t, /revoke all on table public\.payment_receiving_accounts from public, anon, authenticated, service_role;/);
  assert.match(t, /receiving_account_identity_immutable/);
  assert.match(t, /payment_receiving_account_immutable/);
  assert.match(t, /on delete restrict/);
  const u = comments(sql.m2);
  assert.match(u, /create unique index if not exists public_registration_payments_staff_request_key\s+on public\.public_registration_payments \(staff_request_id\) where staff_request_id is not null;/);
  assert.match(u, /payment_staff_request_id_immutable/);
}

// 4. AF1a: separate ledger, three states only, durable keys, four-eyes and immutability in the database.
{
  const t = comments(sql.af1a);
  assert.match(t, /check \(status in \('claimed', 'verified', 'rejected'\)\)/);
  assert.ok(!/'settled'/.test(t.replace(/^.*--.*$/gm, "")), "AF1a does not activate 'settled'");
  assert.match(t, /unique \(claim_request_id\)/);
  assert.match(t, /unique \(decision_request_id\)/);
  assert.match(t, /check \(decided_by is null or decided_by <> claimed_by\)/);
  assert.match(t, /transferred_on\s+date not null/);
  assert.match(t, /additional_funds_claim_immutable/);
  assert.match(t, /additional_funds_delete_forbidden/);
  assert.match(t, /additional_funds_decision_final/);
  assert.match(t, /revoke all on table public\.public_registration_additional_funds from public, anon, authenticated, service_role;/);
  assert.ok(!/public_registration_payments|course_schedules|schedule_participants/.test(t.replace(/references public\.public_registrations\(id\)/g, "")),
    "AF1a touches no payment, schedule or enrolment table");
}

// 5. AF1b: two RPCs, Admin-only, mandatory notes, four-eyes, durable idempotency, one event each, no other table written.
{
  const claim = bodyOf(sql.af1b, "record_public_registration_additional_funds_claim");
  const decide = bodyOf(sql.af1b, "decide_public_registration_additional_funds");
  for (const b of [claim, decide]) {
    assert.ok(b.indexOf("if v_actor is null or not app.is_admin() then") > 0 && b.indexOf("if v_actor is null or not app.is_admin() then") < b.indexOf("select"), "guard is first");
    assert.equal((b.match(/perform public\.log_event_as_service\(/g) ?? []).length, 1, "exactly one semantic event");
    assert.ok(!/update public\.public_registration_payments|update public\.public_registrations|insert into public\.public_registration_payments|course_schedules|finalize_public_registration_crm/.test(b),
      "no payment, registration, schedule or seat write");
  }
  assert.match(claim, /where claim_request_id = p_request_id for update;/);
  assert.match(claim, /raise exception 'registration_not_paid'/);
  assert.match(decide, /if v_row\.claimed_by = v_actor then\n    raise exception 'four_eyes_required'/);
  assert.ok(decide.indexOf("for update;") < decide.indexOf("where decision_request_id = p_request_id"), "decision: lock the claim before the idempotency check");
  assert.match(sql.af1b, /grant execute on function public\.record_public_registration_additional_funds_claim\(uuid, uuid, numeric, date, text, uuid, text\) to authenticated;/);
  assert.match(sql.af1b, /grant execute on function public\.decide_public_registration_additional_funds\(uuid, text, uuid, text\) to authenticated;/);
}

// 6. M3: exact header, guard first, idempotency before the already-paid review, review writes nothing, R1 block identical.
{
  assert.match(sql.m3, /CREATE OR REPLACE FUNCTION public\.verify_public_registration_bank_transfer_by_staff\(p_registration_id uuid, p_receiving_bank_account_id uuid, p_amount numeric, p_payment_reference text, p_request_id uuid, p_notes text\)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'\n/);
  const b = bodyOf(sql.m3, "verify_public_registration_bank_transfer_by_staff");
  const at = (s: string) => { const i = b.indexOf(s); assert.ok(i > 0, `M3 contains: ${s}`); return i; };
  const guard = at("if v_verifier_id is null or not app.is_admin() then");
  const lockReg = at("select * into v_registration from public.public_registrations where id = p_registration_id for update;");
  const idem = at("where staff_request_id = p_request_id for update;");
  const review = at("'outcome', 'additional_funds_review'");
  const insert = at("insert into public.public_registration_payments (");
  assert.ok(guard < lockReg && lockReg < idem && idem < review && review < insert, "M3 order: guard -> registration lock -> idempotency -> already-paid review -> insert");
  const reviewBranch = b.slice(b.lastIndexOf("if v_registration.payment_status = 'paid' or cardinality(v_paid) > 0 then", review), b.indexOf("end if;", review));
  assert.ok(!/insert|update|log_event_as_service/.test(reviewBranch), "the additional-funds review writes nothing");
  assert.match(reviewBranch, /'recorded', false/);
  assert.equal(r1Block(b), r1Block(a5Manual), "M3 r1_schedule_guard block is byte-identical to A5 (manual)");
  assert.equal(b.split(RET).length, 2, "exactly one CRM finalization call");
  assert.match(b, /'provider_cancellation_confirmed', false/);
  assert.ok(!/'provider_cancellation_confirmed', true/.test(b), "never claims provider cancellation");
  assert.match(sql.m3, /<> '89f34994a0e83a9b12e87e07a456b1cb' then\n    raise exception 'm3_precondition_failed: the legacy manual payment RPC is not the M0/);
  assert.match(sql.m3, /grant execute on function public\.verify_public_registration_bank_transfer_by_staff\(uuid, uuid, numeric, text, uuid, text\) to authenticated;/);
  assert.equal((sql.m3.match(/grant execute/g) ?? []).length, 1, "M3 grants EXECUTE once, to authenticated");
}

// 7. Scope: only the six migrations, the three DB-G1 contract files and the named lines in four existing contracts.
const base = process.env.TERAS_DBG1_BASE ?? "da93c70b500f502c682cf6e1c1676572030cfb1d";
let changed: string[] = [];
try {
  const tracked = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  changed = [...new Set([...tracked.split("\n"), ...untracked.split("\n")].map((s) => s.trim()).filter(Boolean))];
} catch {
  changed = [];
}
if (changed.length > 0) {
  const allowed = new Set([...Object.values(MIG), ...DB_CONTRACT, SELF, ...EXISTING]);
  for (const f of changed) assert.ok(allowed.has(f), `changed file is in scope: ${f}`);
  const diffLines = (path: string) => execFileSync("git", ["diff", "-U0", base, "--", path], { encoding: "utf8" }).replace(/\r/g, "")
    .split("\n").filter((l) => /^[+-](?![+-])/.test(l));
  assert.deepEqual(EXISTING.flatMap(diffLines), DBG1_LINES, "existing contracts changed only by the named DB-G1 lines");
}

console.log("PKG-1d-B-DB-G1 static contract passed.");
