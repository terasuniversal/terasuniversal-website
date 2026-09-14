import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail = readFileSync(new URL("../app/admin/(protected)/certificates/[id]/page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/admin/(protected)/certificates/actions.ts", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../components/admin/CertificateActionDialog.tsx", import.meta.url), "utf8");
const verifyRpc = readFileSync(new URL("../supabase/migrations/0017_certificate_verification.sql", import.meta.url), "utf8");

assert.match(detail, /CertificateActionDialog/);
assert.match(detail, /Revoke certificate\?/);
assert.match(detail, /Duplicate certificate\?/);
assert.match(detail, /Delete certificate\?/);
assert.doesNotMatch(detail, /Regenerate token/);
assert.match(actions, /certificateRevokeSchema/);
assert.match(actions, /p_remarks: parsed\.data\.reason/);
assert.match(actions, /Certificate duplicate failed/);
assert.match(actions, /throw new Error\("Unable to duplicate certificate\."\)/);
assert.doesNotMatch(actions, /regenerateVerificationToken/);
assert.match(detail, /This certificate will become invalid in public verification/);
assert.match(detail, /new certificate identity and verification token/);
assert.match(dialog, /No change was applied/);
assert.match(verifyRpc, /training_date/);
assert.match(verifyRpc, /Returns only publicly-safe fields/);

console.log("C7 operational contract passed: confirmations, revoke reason, duplicate errors, token action removal, public verification boundary.");