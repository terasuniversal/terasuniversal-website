import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const action = read("app/admin/(protected)/certificates/actions.ts");
const form = read("components/admin/ReissueCertificateForm.tsx");
const detail = read("app/admin/(protected)/certificates/[id]/page.tsx");
const migration = read("supabase/migrations/20260927182751_certificate_reissue_request_idempotency.sql");
const runtime = read("supabase/tests/certificate_i3a_lifecycle_runtime_contract.sql");
const pdfRoute = read("app/admin/cert-pdf/[id]/page.tsx");

assert.match(form, /crypto\.randomUUID\(\)/, "each deliberate reissue operation needs a fresh client request key");
assert.match(form, /sessionStorage\.setItem\(storageKey/, "uncertain requests must keep their key and payload across a same-tab reload");
assert.match(form, /sessionStorage\.getItem\(storageKey/, "a reloaded form must restore the pending request");
assert.match(form, /sessionStorage\.removeItem\(storageKey\)/, "successful completion must clear the saved operation");
assert.match(form, /submitting\.current\) return/, "rapid repeated submit events must be stopped immediately");
assert.match(form, /setPending\(true\)/, "pending state must be set synchronously on submit");
assert.match(form, /const locked = pending \|\| success \|\| Boolean\(error\)/, "reissue controls must remain locked while pending or after an uncertain result");
assert.match(form, /disabled=\{locked\}/, "reissue controls must be disabled while the request is pending");
assert.match(form, /type="submit" disabled=\{pending \|\| success\}/, "an uncertain operation must remain retryable with its retained key");
assert.match(form, /pending \? "Recording…"/, "the submit button must show clear progress text");
assert.match(form, /Event recorded successfully\./, "successful completion must be visible");
assert.match(form, /requestKey\.current \?\?= crypto\.randomUUID/, "transport retries must retain the same operation key");
assert.match(form, /requestKey\.current = null/, "a deliberate later operation must receive a different key");
assert.match(detail, /<ReissueCertificateForm action=\{reissueCertificate\.bind\(null, id\)\}/);
assert.match(action, /p_notes:\s*\{\s*idempotency_key:\s*idempotencyKey\s*\}/);
assert.match(action, /if \(!\/\^\[0-9a-f\]/i, "server action must reject malformed request keys");

assert.match(migration, /add column if not exists idempotency_key uuid/i, "migration must be safe to rerun after partial application");
assert.match(migration, /create unique index if not exists/i, "idempotency index must be safe to rerun after partial application");
assert.match(migration, /create unique index[\s\S]+\(reissued_by, idempotency_key\)[\s\S]+where idempotency_key is not null/i);
assert.match(migration, /on conflict \(reissued_by, idempotency_key\)[\s\S]+do nothing/i);
assert.match(migration, /v_event\.notes is distinct from v_notes/i, "key reuse with a different payload must be rejected");
assert.match(migration, /request key was already used for a different operation/i);
assert.match(migration, /alter function app\.reissue_certificate\(uuid, text, text, jsonb\)\s+owner to certificate_lifecycle_executor/i);
assert.match(migration, /not app\.is_active\(\) or not app\.is_admin\(\).*has_module_access_level\('certificates', 'admin'\)/s);
assert.doesNotMatch(migration, /update public\.certificates|update public\.certificate_issuance_snapshots|delete from public\.certificate_reissue_events/i);
assert.match(runtime, /same reissue request key did not return its original event/i);
assert.match(runtime, /different reissue request keys did not create a separate event/i);
assert.match(runtime, /user without certificate module permission/i);
assert.match(runtime, /reprint\/reissue mutated original issuance data/i);

assert.match(pdfRoute, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;/i);
assert.match(pdfRoute, /\.cert-pdf-shell\s*\{[^}]*padding:\s*0 !important/s);
assert.match(pdfRoute, /\.cert-pdf-wrap\s*\{[^}]*display:\s*block !important;\s*gap:\s*0 !important/s);
assert.match(pdfRoute, /<CertificateFront[\s\S]*<CertificateBack/);
assert.match(pdfRoute, /\.cert-pdf-page:last-child\s*\{\s*page-break-after:\s*auto;\s*break-after:\s*auto;/);

console.log("I3D reissue idempotency and certificate PDF route source contract: PASS");
