import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicRegistrationCreateSchema,
  publicRegistrationStatusSchema,
} from "../lib/public-registration.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = (name: string) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");

const core = migration("20260907100000_public_registration_core.sql");
const rpc = migration("20260907100200_public_registration_rpc.sql");
const guards = migration("20260907100300_public_registration_state_guards.sql");
const payment = migration("20260907100400_public_registration_toyyibpay.sql");
const crm = migration("20260907100350_public_registration_crm_finalize.sql");
const context = migration("20260907100100_public_registration_schedule_context.sql");
const capacityGuard = migration("20260907135110_public_registration_capacity_guard_fix.sql");
const capacityContext = migration("20260907135351_public_registration_schedule_capacity_consistency.sql");
const toyyibpay = fs.readFileSync(path.join(root, "lib", "payments", "toyyibpay.ts"), "utf8");

const valid = publicRegistrationCreateSchema.safeParse({
  schedule_id: "00000000-0000-4000-8000-000000000001",
  idempotency_key: "client-retry-key-0001",
  registration_secret: "a".repeat(64),
  attendees: [{ full_name: "Example Participant", ic_passport_no: "900101-01-1234", email: "person@example.com" }],
});
assert.equal(valid.success, true, "valid registration input should pass");
assert.equal(publicRegistrationCreateSchema.safeParse({ ...valid.data, attendees: [] }).success, false);
assert.equal(publicRegistrationCreateSchema.safeParse({ ...valid.data, idempotency_key: "short" }).success, false);
assert.equal(publicRegistrationStatusSchema.safeParse({ registration_reference: "TU-REG-1", registration_secret: "bad" }).success, false);

for (const source of [context, rpc, guards, payment, crm]) {
  assert.match(source, /security definer/i, "public foundation functions must be SECURITY DEFINER");
  assert.match(source, /set search_path\s*=/i, "SECURITY DEFINER functions must pin search_path");
}
assert.match(core, /enable row level security/i);
assert.match(core, /revoke all on table public\.public_registrations from anon, authenticated/i);
assert.match(core, /public_registrations_schedule_idempotency_key unique/i);
assert.match(core, /public_registration_payments_one_active_toyyibpay/i);
assert.match(rpc, /for update of cs/i, "schedule row must be locked in the registration transaction");
assert.match(rpc, /capacity_exceeded/i);
assert.match(rpc, /digest\(lower\(btrim\(p_registration_secret\)\), 'sha256'\)/i);
assert.match(rpc, /participants p\s+join public\.schedule_participants/i);
assert.match(guards, /public_registration_state_guard/i);
assert.match(guards, /public_registration_payment_state_guard/i);
assert.match(guards, /old\.payment_status = 'failed' and new\.payment_status = 'processing'/i);
assert.match(payment, /provider_transaction_id/i);
assert.match(payment, /finalize_public_registration_crm/i);
assert.match(core, /bill_creation_state in \('not_claimed', 'claimed', 'attached', 'failed', 'orphaned'\)/i);
assert.doesNotMatch(rpc, /bill_creation_claimed_at <= now\(\) - interval '10 minutes'/i);
assert.match(guards, /order by hold_expires_at, id/i);
assert.match(guards, /recover_public_registration_payment_claim/i);
assert.match(guards, /from public\.public_registrations r[\s\S]*for update/i);
assert.match(guards, /bill_creation_state = 'not_claimed'/i);
assert.doesNotMatch(guards, /bill_creation_claimed_at <= now\(\) - interval '10 minutes'/i);
assert.match(toyyibpay, /strictProviderBillCode/i);
assert.match(toyyibpay, /options\.strictProviderBillCode \? null/i);
assert.match(fs.readFileSync(path.join(root, "app/api/payments/toyyibpay/registration-callback/route.ts"), "utf8"), /strictProviderBillCode: true/i);
assert.match(context, /fee is not null/i);
assert.match(capacityGuard, /v_schedule\.capacity is null/i, "capacity guard must reject NULL capacity before capacity math");
assert.match(capacityContext, /cs\.capacity is not null/i, "public context must explicitly reject NULL capacity");
assert.match(capacityContext, /coalesce\(\([\s\S]*\), false\)/i, "public context must return false rather than SQL NULL for eligibility");
assert.match(payment, /toyyibpay_system_actor/i, "automated payment audit must use the existing system actor convention");
assert.doesNotMatch(fs.readFileSync(path.join(root, "app/api/payments/toyyibpay/registration-callback/route.ts"), "utf8"), /\?\?\s*transactions\[0\]/i);
assert.match(guards, /bill_creation_owner/i);
assert.match(guards, /record_public_registration_payment_orphan/i);
assert.match(guards, /registration -> payment attempt -> schedule/i);
assert.match(payment, /late_success_after_expiry/i);
assert.match(crm, /p_verifier_id uuid/i);
assert.match(crm, /schedule_participants/i);
assert.match(crm, /app\.is_admin\(\)/i);
assert.match(crm, /toyyibpay_system_actor/i, "automated CRM finalization audit must use the existing system actor convention");
assert.doesNotMatch(guards, /'attempt_id'\s*,/i, "public payment RPC must not return an internal attempt id");
const limiter = fs.readFileSync(path.join(root, "lib/rate-limit.js"), "utf8");
assert.match(limiter, /failClosed && process\.env\.NODE_ENV === "production"/i);

console.log("Public registration foundation checks passed: validation, RLS, search_path, token hashing, locking, state guards, payment uniqueness, and CRM finalization assertions.");
