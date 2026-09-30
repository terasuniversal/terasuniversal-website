import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const migrationDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const issueMigrations = migrationFiles
  .map((name) => ({ name, source: readFileSync(join(migrationDir, name), "utf8") }))
  .filter(({ source }) => /create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i.test(source));
assert.ok(issueMigrations.length, "an issuance RPC migration must exist");
const migration = issueMigrations.at(-1).source;
const issueStart = migration.search(/create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i);
const issueEnd = migration.indexOf("$$;", issueStart);
assert.ok(issueStart >= 0 && issueEnd > issueStart, "latest issuance RPC migration must contain a complete function definition");
const issueFunction = migration.slice(issueStart, issueEnd + 3);
const certificateInsert = issueFunction.match(/insert\s+into\s+public\.certificates\s*\(([^]*?)\)\s*values\s*\(([^]*?)\)\s*returning/i);
assert.ok(certificateInsert, "issuance RPC must insert a certificate");
const certificateColumns = certificateInsert[1].replace(/\s+/g, " ").toLowerCase();
const certificateValues = certificateInsert[2].replace(/\s+/g, " ").toLowerCase();

// TEST 1: issuance maps the participant's source identity into the certificate.
assert.match(certificateColumns, /\bidentity_no\s*,\s*identity_last4\b/);
assert.match(certificateValues, /nullif\(btrim\(v_participant\.ic_passport_no\),\s*''\)/);
console.log("TEST 1 — participant identity copied at issuance: PASS");

// TEST 2: last4 is derived from the same participant source, using the established normalization.
assert.match(certificateValues, /length\(regexp_replace\(v_participant\.ic_passport_no,\s*'\[\^0-9a-za-z\]',\s*'',\s*'g'\)\)\s*>=\s*4/);
assert.match(certificateValues, /upper\(right\(regexp_replace\(v_participant\.ic_passport_no,\s*'\[\^0-9a-za-z\]',\s*'',\s*'g'\),\s*4\)\)/i);
console.log("TEST 2 — identity_last4 derives from issuance identity: PASS");

// TEST 3: the snapshot copies both immutable columns from the inserted certificate row.
const snapshotInsert = issueFunction.match(/insert\s+into\s+public\.certificate_issuance_snapshots\s*\(([^]*?)\)\s*select\s+([^]*?)\s+from\s+public\.certificates\s+c/i);
assert.ok(snapshotInsert, "issuance RPC must create the snapshot from the inserted certificate");
assert.match(snapshotInsert[1].replace(/\s+/g, " ").toLowerCase(), /\bidentity_no\s*,\s*identity_last4\b/);
assert.match(snapshotInsert[2].replace(/\s+/g, " ").toLowerCase(), /c\.identity_no\s*,\s*c\.identity_last4/);
console.log("TEST 3 — issuance snapshot stores identity and last4: PASS");

// Preserve the current function's execution boundary and branch/ACL invariants.
assert.match(issueFunction, /security\s+definer/i);
assert.match(issueFunction, /set\s+search_path\s*=\s*public\s*,\s*app\s*,\s*extensions/i);
assert.match(issueFunction, /Certificate issuing branch is not configured\./);
assert.match(issueFunction, /Certificate issuing branch is inactive or missing\./);
assert.match(migration, /certificate_lifecycle_executor/i);
assert.match(migration, /has_function_privilege/i);
assert.match(migration, /has_schema_privilege/i);
assert.match(migration, /proowner|owner_name/i);
assert.match(migration, /grant\s+create\s+on\s+schema\s+app\s+to\s+certificate_lifecycle_executor/i);
assert.match(migration, /grant\s+certificate_lifecycle_executor\s+to\s+current_user\s+with\s+set\s+true/i);
assert.match(migration, /set\s+local\s+role\s+certificate_lifecycle_executor[\s\S]*reset\s+role[\s\S]*revoke\s+create\s+on\s+schema\s+app\s+from\s+certificate_lifecycle_executor[\s\S]*grant\s+certificate_lifecycle_executor\s+to\s+current_user\s+with\s+set\s+false/i);
assert.doesNotMatch(migration, /\b(?:alter\s+function|grant\s+execute|revoke\s+all)\b/i, "identity migration must not change function ownership or ACLs");
assert.match(issueFunction, /app\.request_actor_id\(\)/i);
assert.doesNotMatch(issueFunction, /\bauth\.uid\s*\(/i, "I3E actor isolation must remain intact");

// TEST 4: this is forward-only; no existing certificate or snapshot is backfilled/rewritten.
const migrationOutsideFunction = migration.slice(0, issueStart) + migration.slice(issueEnd + 3);
assert.doesNotMatch(migrationOutsideFunction, /\b(update|insert\s+into|delete\s+from)\s+public\.(?:certificates|certificate_issuance_snapshots)\b/i);
assert.doesNotMatch(issueFunction, /update\s+public\.certificate_issuance_snapshots/i);
console.log("TEST 4 — issuance is forward-only; no historical snapshot rewrite: PASS");

const cacheRoot = join(repoRoot, "node_modules/.cache");
mkdirSync(cacheRoot, { recursive: true });
const outputDir = mkdtempSync(join(cacheRoot, "certificate-identity-snapshot-"));
try {
  const tsc = join(repoRoot, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [
    tsc,
    "--jsx", "react-jsx",
    "--module", "commonjs",
    "--target", "es2021",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--rootDir", repoRoot,
    "--outDir", outputDir,
    join(repoRoot, "app/admin/(protected)/certificates/certData.ts"),
    join(repoRoot, "components/admin/CertificateDocument.tsx"),
    join(repoRoot, "app/verify/VerificationResult.tsx"),
  ], { cwd: repoRoot, stdio: "inherit" });

  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const originalLoad = Module._load;
  const siteOrigin = "https://identity-snapshot-test.example.invalid";
  Module._load = function (request, parent, isMain) {
    const normalizedRequest = request.replaceAll("\\\\", "/");
    if (normalizedRequest.endsWith("lib/supabase/server")) return { createSupabaseServerClient: async () => fixtureSupabase };
    if (normalizedRequest.endsWith("lib/site-origin")) return { siteOrigin: () => siteOrigin };
    if (request.startsWith("@/")) {
      const compiledPath = join(outputDir, `${request.slice(2)}.js`);
      if (existsSync(compiledPath)) return originalLoad.call(this, compiledPath, parent, isMain);
    }
    if (request === "next/headers") return { cookies: async () => ({ get: () => undefined }) };
    if (request === "next/cache") return { revalidatePath: () => undefined };
    return originalLoad.call(this, request, parent, isMain);
  };

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const outputCertData = join(outputDir, "app/admin/(protected)/certificates/certData.js");
  const outputCertDocument = join(outputDir, "components/admin/CertificateDocument.js");
  const outputVerify = join(outputDir, "app/verify/VerificationResult.js");
  assert.ok(existsSync(outputCertData), "TypeScript must compile the production certificate loader");
  const { loadCertificateRender } = require(outputCertData);
  const { CertificateDocument } = require(outputCertDocument);
  const { VerificationResult } = require(outputVerify);
  Module._load = originalLoad;

  const issueIdentity = "SYNTH-ISSUE-ID-AB1234";
  const changedLiveIdentity = "SYNTH-LIVE-CHANGED-ZZ9999";
  const baseCertificate = {
    id: "synthetic-identity-certificate",
    certificate_number: "SYNTH-IDENTITY-0001",
    participant_id: "synthetic-participant",
    course_id: "synthetic-course",
    holder_name: "Synthetic Identity Snapshot Test",
    identity_no: issueIdentity,
    identity_last4: "1234",
    issue_date: "2026-09-30",
    status: "valid",
    participants: { id: "synthetic-participant", ic_passport_no: changedLiveIdentity },
    courses: { id: "synthetic-course", name: "Synthetic Test Course", duration_days: 1 },
    training_schedules: { id: "synthetic-schedule", start_date: "2026-09-29", end_date: "2026-09-29", venue: "Synthetic Test Venue" },
    certificate_templates: { id: "synthetic-template", config: { show_back_page: true, show_qr: false } },
  };
  const issuedSnapshot = {
    identity_no: issueIdentity,
    identity_last4: "1234",
    holder_name: baseCertificate.holder_name,
    certificate_number: baseCertificate.certificate_number,
    course_name: "Synthetic Test Course",
    issue_date: "2026-09-30",
    template_config: { show_back_page: true, show_qr: false },
    render_payload: {},
  };

  let identityParticipantQueries = 0;
  let mainCertificateSelect = "";
  function makeSupabase({ certificate, snapshot, skills = [] }) {
    const builder = (table) => {
      const query = {
        select(columns) {
          if (table === "certificates") mainCertificateSelect = String(columns);
          return this;
        },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => {
          if (table === "certificate_issuance_snapshots") return { data: snapshot, error: null };
          if (table === "participants") {
            identityParticipantQueries += 1;
            return { data: { ic_passport_no: certificate.participants?.ic_passport_no ?? null }, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => ({ data: certificate, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: table === "certificate_skill_results" ? skills : [], error: null }).then(resolve, reject);
        },
      };
      return query;
    };
    return { from: builder };
  }

  let fixtureSupabase = makeSupabase({ certificate: baseCertificate, snapshot: issuedSnapshot });
  const load = async ({ certificate = baseCertificate, snapshot = issuedSnapshot } = {}) => {
    identityParticipantQueries = 0;
    mainCertificateSelect = "";
    fixtureSupabase = makeSupabase({ certificate, snapshot });
    return loadCertificateRender(certificate.id);
  };

  // TEST 4 runtime: mutate only the participant's live identity after issuance.
  const beforeCertificateIdentity = baseCertificate.identity_no;
  const beforeSnapshotIdentity = issuedSnapshot.identity_no;
  baseCertificate.participants.ic_passport_no = changedLiveIdentity;
  const postMutationRender = await load();
  assert.equal(baseCertificate.identity_no, beforeCertificateIdentity);
  assert.equal(baseCertificate.identity_last4, "1234");
  assert.equal(issuedSnapshot.identity_no, beforeSnapshotIdentity);
  assert.equal(issuedSnapshot.identity_last4, "1234");
  assert.equal(postMutationRender.data.ic_passport, issueIdentity);
  assert.equal(identityParticipantQueries, 0, "snapshotted issuance must not query the live participant identity");
  assert.doesNotMatch(mainCertificateSelect, /ic_passport_no/, "snapshotted issuance query must not select live participant identity");

  // TEST 5: the rendered certificate uses the issuance snapshot, not changed live/certificate fields.
  const divergentCertificate = { ...baseCertificate, identity_no: "SYNTH-CERTIFICATE-DIFFERENT-8888" };
  const snapshotRender = await load({ certificate: divergentCertificate, snapshot: issuedSnapshot });
  assert.equal(snapshotRender.data.ic_passport, issueIdentity);
  assert.equal(identityParticipantQueries, 0);
  const snapshotHtml = renderToStaticMarkup(React.createElement(CertificateDocument, { data: snapshotRender.data, config: snapshotRender.config }));
  assert.match(snapshotHtml, /SYNTH-ISSUE-ID-AB1234/);
  assert.doesNotMatch(snapshotHtml, /SYNTH-LIVE-CHANGED-ZZ9999|SYNTH-CERTIFICATE-DIFFERENT-8888/);
  console.log("TEST 5 — snapshotted renderer ignores changed live identity: PASS");

  // TEST 6: an existing but empty snapshot is authoritative and must not fall back.
  const emptySnapshotRender = await load({
    certificate: { ...baseCertificate, identity_no: "SYNTH-CERTIFICATE-EMPTY-SNAPSHOT-1111" },
    snapshot: { ...issuedSnapshot, identity_no: "   ", identity_last4: null },
  });
  assert.equal(emptySnapshotRender.data.ic_passport, null);
  assert.equal(identityParticipantQueries, 0, "empty snapshot must not trigger a live identity lookup");
  const emptySnapshotHtml = renderToStaticMarkup(React.createElement(CertificateDocument, { data: emptySnapshotRender.data, config: emptySnapshotRender.config }));
  assert.doesNotMatch(emptySnapshotHtml, /SYNTH-LIVE-CHANGED-ZZ9999|SYNTH-CERTIFICATE-EMPTY-SNAPSHOT-1111|IC \/ Passport No:/);
  console.log("TEST 6 — empty snapshot renders no live identity fallback: PASS");

  // TEST 7: legacy certificates without a snapshot retain the existing certificate-then-participant fallback.
  const legacyCertificateIdentity = "SYNTH-LEGACY-CERTIFICATE-3333";
  const legacyRender = await load({
    certificate: { ...baseCertificate, identity_no: legacyCertificateIdentity },
    snapshot: null,
  });
  assert.equal(legacyRender.data.ic_passport, legacyCertificateIdentity);
  assert.equal(identityParticipantQueries, 0, "legacy certificate identity remains first in its existing fallback chain");
  const legacyLiveFallbackRender = await load({
    certificate: { ...baseCertificate, identity_no: null },
    snapshot: null,
  });
  assert.equal(legacyLiveFallbackRender.data.ic_passport, changedLiveIdentity);
  assert.equal(identityParticipantQueries, 1, "only legacy certificates with an empty certificate identity may query the participant");
  console.log("TEST 7 — no-snapshot legacy fallback is preserved: PASS");

  // TEST 8: public verification UI does not render raw identity fields, even if an unexpected payload includes them.
  const verificationMarkup = renderToStaticMarkup(React.createElement(VerificationResult, {
    result: {
      found: true,
      certificate_number: "SYNTH-PUBLIC-0001",
      holder_name: "Synthetic Public Privacy Test",
      participant_code_masked: "TU-0•••34",
      identity_no: "SYNTH-PUBLIC-IDENTITY-RAW-AB1234",
      identity_last4: "1234",
      ic_passport_no: "SYNTH-PUBLIC-IDENTITY-RAW-AB1234",
    },
  }));
  assert.match(verificationMarkup, /TU-0•••34/);
  assert.doesNotMatch(verificationMarkup, /SYNTH-PUBLIC-IDENTITY-RAW-AB1234|identity_last4/);
  const publicResultSource = read("app/verify/VerificationResult.tsx");
  const verifyRow = publicResultSource.match(/export\s+interface\s+VerifyRow\s*\{([^]*?)\n\}/);
  assert.ok(verifyRow, "public verification row contract must remain explicit");
  assert.doesNotMatch(verifyRow[1], /identity_no|identity_last4|ic_passport_no/i);
  console.log("TEST 8 — public verification does not expose full identity: PASS");
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}

console.log("IDENTITY_SNAPSHOT_CONTRACT: PASS");
