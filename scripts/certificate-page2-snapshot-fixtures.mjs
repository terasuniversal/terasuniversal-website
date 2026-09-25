import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Module, { createRequire } from "node:module";
import QRCode from "qrcode";
import { resolveSnapshotProgrammePage2, applyLegacyProgrammePage2 } from "../lib/certificate-page2-snapshot.ts";
import { resolveCertificateSkills } from "../lib/certificate-skills.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const certData = read("app/admin/(protected)/certificates/certData.ts");
const snapshotHydration = certData.slice(
  certData.indexOf("if (snapshot) {"),
  certData.indexOf("// This family marker is runtime routing metadata"),
);
assert.match(snapshotHydration, /resolveSnapshotProgrammePage2/);
assert.doesNotMatch(snapshotHydration, /findStandardScaffoldProgrammeByCourseId|findWorkingAtHeightProgrammeByCourseId/);
const standardLegacyHydration = certData.slice(
  certData.indexOf('if (!snapshot && config.design_variant === "standard_scaffold_certificate")'),
  certData.indexOf("// Golden Reference family/title"),
);
assert.match(standardLegacyHydration, /applyLegacyProgrammePage2/);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "node_modules/.cache/i1-certificate-page2");
const compiledDir = resolve(fixtureDir, "compiled");
const publicRoot = pathToFileURL(resolve(repoRoot, "public")).href;
const rewriteAssets = (html) => html
  .replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`)
  .replaceAll('src="/certificates/template-a/', `src="${publicRoot}/certificates/template-a/`)
  .replaceAll('src="/signatures/director-signature.png', `src="${publicRoot}/signatures/director-signature.png`)
  .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${publicRoot}/certificates/seals/teras-common-seal.png`);
mkdirSync(fixtureDir, { recursive: true });
execFileSync(process.execPath, [
  resolve(repoRoot, "node_modules/typescript/bin/tsc"),
  "--jsx", "react-jsx",
  "--module", "commonjs",
  "--target", "es2021",
  "--moduleResolution", "node",
  "--esModuleInterop",
  "--skipLibCheck",
  "--rootDir", repoRoot,
  "--outDir", compiledDir,
  resolve(repoRoot, "components/admin/CertificateRenderer.tsx"),
  resolve(repoRoot, "lib/certificate-html.ts"),
  resolve(repoRoot, "lib/certificate-skills.ts"),
  resolve(repoRoot, "app/admin/(protected)/certificates/certData.ts"),
], { cwd: repoRoot, stdio: "inherit" });
process.env.NODE_PATH = [resolve(repoRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { CertificateFront, CertificateBack } = require(resolve(compiledDir, "components/admin/CertificateRenderer.js"));
const { renderCertificateFront, renderCertificateBack, renderCertificateDocument } = require(resolve(compiledDir, "lib/certificate-html.js"));

// Exercise the production loader with only its Supabase data-access module
// replaced. The public loadCertificateRender(id) entry point and every line
// of loader logic remain the same as the application path.
const originalLoad = Module._load;
let loaderFixture;
Module._load = function (request, parent, isMain) {
  if (request.endsWith("lib/supabase/server")) {
    return { createSupabaseServerClient: async () => createFixtureSupabase(loaderFixture) };
  }
  if (request.endsWith("lib/site-origin")) return { siteOrigin: async () => "https://example.invalid" };
  return originalLoad.call(this, request, parent, isMain);
};

function createFixtureSupabase(fixture) {
  return {
    from(table) {
      const query = {
        filters: [],
        select() { return this; },
        eq(key, value) { this.filters.push([key, value]); return this; },
        is() { return this; },
        filter() { return this; },
        limit() { return this; },
        single() { return Promise.resolve({ data: fixture.certificate, error: null }); },
        maybeSingle() {
          if (table === "certificate_issuance_snapshots") return Promise.resolve({ data: fixture.snapshot, error: null });
          return Promise.resolve({ data: fixture.defaultTemplate ?? null, error: null });
        },
        then(resolve, reject) {
          if (table === "certificate_skill_results") return Promise.resolve({ data: fixture.skills, error: null }).then(resolve, reject);
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const { loadCertificateRender } = require(resolve(compiledDir, "app/admin/(protected)/certificates/certData.js"));
const { standardScaffoldProgrammes } = require(resolve(compiledDir, "lib/standard-scaffold-programmes.js"));
const mappedProgramme = standardScaffoldProgrammes.basic_erection;
const originalContentStatus = mappedProgramme.content_status;
const savedMapping = {
  objectives_text: mappedProgramme.objectives_text,
  coverage_items: mappedProgramme.coverage_items,
  learning_outcomes: mappedProgramme.learning_outcomes,
  assessment_methods: mappedProgramme.assessment_methods,
};
const changedMapping = {
  objectives_text: "CURRENT MAPPING — MUST NOT LEAK",
  coverage_items: ["CURRENT MAPPING COVERAGE"],
  learning_outcomes: ["CURRENT MAPPING OUTCOME"],
  assessment_methods: ["CURRENT MAPPING METHOD"],
};
Object.assign(mappedProgramme, changedMapping);
const loaderResults = {};

const syntheticCertificate = {
  id: "synthetic-certificate-id",
  course_id: mappedProgramme.course_id,
  participant_id: "synthetic-participant-uuid",
  holder_name: "Mutable Current Holder",
  participant_name: "Legacy Current Holder",
  course_name: "Mutable Current Course",
  certificate_number: "CURRENT-CERT-NUMBER",
  certificate_no: "CURRENT-CERT-NO",
  identity_no: "CURRENT-IDENTITY",
  verification_url: "https://example.invalid/legacy-current-url",
  issue_date: "2026-01-01",
  training_start_date: "2026-01-02",
  certificate_templates: { config: { design_variant: "standard_scaffold_certificate", show_back_page: true, show_qr: true } },
  participants: { participant_id: "SYNTHETIC-PARTICIPANT-CODE", ic_passport_no: "CURRENT-PARTICIPANT-IDENTITY" },
  courses: { title: "Current mapped course", duration: "99 days" },
};
const baseSnapshot = {
  renderer_version: "synthetic-renderer-v1",
  holder_name: "Synthetic Historical Holder",
  identity_no: "SYNTHETIC-IDENTITY-001",
  course_name: "Synthetic Historical Course",
  training_start_date: "2026-09-20",
  training_end_date: "2026-09-22",
  venue: "Synthetic Historical Venue",
  trainer_name: "Synthetic Historical Trainer",
  signature_reference: null,
  verification_metadata: { certificate_number: "SYNTHETIC-I1-000001", verification_path: "/verify/synthetic-i1-000001" },
};
const capturedPage2 = {
  objectives_text: "Captured issuance objective",
  coverage_items: ["Captured coverage"],
  learning_outcomes: ["Captured outcome"],
  assessment_methods: ["Captured method"],
};
const syntheticSkills = [
  { area: "theory_session", status: "completed" },
  { area: "practical_training", status: "completed" },
  { area: "safety_awareness", status: "not_recorded" },
  { area: "practical_assessment", status: "passed" },
  { area: "attendance_requirement", status: "met" },
];
async function loadFixture({ snapshot = null, templateConfig = null, renderPayload = null, currentMappingVerified = true } = {}) {
  mappedProgramme.content_status = currentMappingVerified ? "verified" : "draft";
  loaderFixture = {
    certificate: structuredClone(syntheticCertificate),
    snapshot: snapshot ? { ...structuredClone(baseSnapshot), template_config: templateConfig, render_payload: renderPayload } : null,
    skills: structuredClone(syntheticSkills),
  };
  return loadCertificateRender("synthetic-certificate-id");
}

try {
  const modernTemplate = { design_variant: "standard_scaffold_certificate", show_back_page: true, show_qr: true };
  const completeLoaded = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2 }, renderPayload: capturedPage2 });
  loaderResults.complete = completeLoaded;
  assert.deepEqual(Object.fromEntries(Object.keys(capturedPage2).map((key) => [key, completeLoaded.config[key]])), capturedPage2);
  assert.ok(Object.values(completeLoaded.config).flat().join(" ").includes("Captured"));
  assert.ok(!JSON.stringify(completeLoaded.config).includes("CURRENT MAPPING"));
  console.log("production loader complete snapshot / conflicting map: PASS");

  const partialLoaded = await loadFixture({
    snapshot: true,
    templateConfig: { ...modernTemplate, objectives_text: "Template config wins", coverage_items: ["Template coverage"] },
    renderPayload: { ...capturedPage2, objectives_text: "Payload loses", coverage_items: ["Payload loses coverage"] },
  });
  loaderResults.partial = partialLoaded;
  assert.equal(partialLoaded.config.objectives_text, "Template config wins");
  assert.deepEqual(partialLoaded.config.coverage_items, ["Template coverage"]);
  assert.deepEqual(partialLoaded.config.learning_outcomes, capturedPage2.learning_outcomes);
  assert.deepEqual(partialLoaded.config.assessment_methods, capturedPage2.assessment_methods);
  assert.ok(!JSON.stringify(partialLoaded.config).includes("CURRENT MAPPING"));
  console.log("production loader partial snapshot precedence/fill: PASS");

  const incompleteLoaded = await loadFixture({ snapshot: true, templateConfig: modernTemplate, renderPayload: { certificate_number: "SYNTHETIC-I1-000001" } });
  loaderResults.incomplete = incompleteLoaded;
  for (const field of Object.keys(capturedPage2)) assert.ok(incompleteLoaded.config[field] == null || incompleteLoaded.config[field] === "" || Array.isArray(incompleteLoaded.config[field]) && incompleteLoaded.config[field].length === 0, `incomplete snapshot ${field} should be neutral`);
  assert.ok(!JSON.stringify(incompleteLoaded.config).includes("CURRENT MAPPING"));
  console.log("production loader incomplete historical snapshot neutral: PASS");

  const legacyLoaded = await loadFixture();
  loaderResults.legacy = legacyLoaded;
  assert.equal(legacyLoaded.data.render_mode, "LEGACY_FALLBACK");
  assert.equal(legacyLoaded.config.objectives_text, changedMapping.objectives_text);
  assert.deepEqual(legacyLoaded.config.coverage_items, changedMapping.coverage_items);
  console.log("production loader legacy no-snapshot mapping fallback: PASS");

  const changedAfterIssue = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2 }, renderPayload: capturedPage2 });
  assert.deepEqual(changedAfterIssue.config, completeLoaded.config);
  console.log("production loader snapshot unchanged after current-map change: PASS");

  const capturedBackOn = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2, show_back_page: true }, currentMappingVerified: false });
  loaderResults.visibilityBackOn = capturedBackOn;
  assert.equal(capturedBackOn.config.show_back_page, true);
  const capturedBackOff = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2, show_back_page: false }, currentMappingVerified: true });
  loaderResults.visibilityBackOff = capturedBackOff;
  assert.equal(capturedBackOff.config.show_back_page, false, "captured Page 2 hidden must not be overwritten by verified current mapping");
  const capturedQrOn = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2, show_qr: true }, currentMappingVerified: false });
  loaderResults.visibilityQrOn = capturedQrOn;
  assert.equal(capturedQrOn.config.show_qr, true);
  const capturedQrOff = await loadFixture({ snapshot: true, templateConfig: { ...modernTemplate, ...capturedPage2, show_qr: false }, currentMappingVerified: true });
  loaderResults.visibilityQrOff = capturedQrOff;
  assert.equal(capturedQrOff.config.show_qr, false, "captured QR hidden must not be overwritten by verified current mapping");
  const partialVisibility = await loadFixture({ snapshot: true, templateConfig: { design_variant: "standard_scaffold_certificate", ...capturedPage2, show_back_page: false }, currentMappingVerified: true });
  loaderResults.visibilityPartial = partialVisibility;
  assert.equal(partialVisibility.config.show_back_page, false);
  assert.equal(partialVisibility.config.show_qr, undefined, "uncaptured legacy QR visibility remains unspecified, not inferred from current mapping");
  const oldSnapshotVisibility = await loadFixture({ snapshot: true, templateConfig: { design_variant: "standard_scaffold_certificate", ...capturedPage2 }, currentMappingVerified: true });
  loaderResults.visibilityOld = oldSnapshotVisibility;
  assert.equal(oldSnapshotVisibility.config.show_back_page, undefined, "old snapshot missing Page 2 visibility remains unspecified");
  assert.equal(oldSnapshotVisibility.config.show_qr, undefined, "old snapshot missing QR visibility remains unspecified");
  assert.equal(legacyLoaded.config.show_back_page, true);
  assert.equal(legacyLoaded.config.show_qr, true);
  loaderResults.visibilityLegacy = legacyLoaded;
  console.log("production loader captured visibility true/false, partial/old snapshots, legacy: PASS");

  assert.deepEqual(completeLoaded.data.certificate_skills_record, syntheticSkills);
  assert.equal(completeLoaded.data.skills.find((row) => row.area === "Practical Assessment")?.status, "Passed");
  assert.equal(completeLoaded.data.skills.find((row) => row.area === "Attendance Requirement")?.status, "Met");
  console.log("production loader certificate_skill_results values: PASS");

  assert.equal(completeLoaded.data.holder_name, "Synthetic Historical Holder");
  assert.equal(completeLoaded.data.ic_passport, "SYNTHETIC-IDENTITY-001");
  assert.equal(completeLoaded.data.participant_id, "SYNTHETIC-PARTICIPANT-CODE");
  assert.equal(completeLoaded.data.certificate_number, "SYNTHETIC-I1-000001");
  assert.equal(completeLoaded.data.verification_url, "https://example.invalid/verify/synthetic-i1-000001");
  assert.ok(completeLoaded.data.qr_svg?.includes("<svg"));
  console.log("production loader identity / certificate number / QR metadata: PASS");
} finally {
  mappedProgramme.content_status = originalContentStatus;
  Object.assign(mappedProgramme, savedMapping);
  Module._load = originalLoad;
}

for (const [label, loaded, expected] of [
  ["complete", loaderResults.complete, capturedPage2],
  ["partial", loaderResults.partial, { objectives_text: "Template config wins", coverage_items: ["Template coverage"], learning_outcomes: capturedPage2.learning_outcomes, assessment_methods: capturedPage2.assessment_methods }],
  ["incomplete", loaderResults.incomplete, null],
  ["legacy", loaderResults.legacy, changedMapping],
]) {
  const reactPage2 = renderToStaticMarkup(React.createElement(CertificateBack, { data: loaded.data, config: loaded.config }));
  const htmlPage2 = renderCertificateBack(loaded.data, loaded.config);
  const expectedContent = expected
    ? [expected.objectives_text, ...expected.coverage_items, ...expected.learning_outcomes, ...expected.assessment_methods]
    : [];
  for (const content of expectedContent) {
    assert.ok(reactPage2.includes(content), `${label} actual loader object React Page 2 must contain ${content}`);
    assert.ok(htmlPage2.includes(content), `${label} actual loader object HTML Page 2 must contain ${content}`);
  }
  if (!expected) {
    for (const field of Object.keys(capturedPage2)) {
      const value = loaded.config[field];
      for (const content of Array.isArray(value) ? value : [value]) {
        if (content) assert.ok(!reactPage2.includes(content) && !htmlPage2.includes(content), `incomplete Page 2 must not render ${content}`);
      }
    }
  }
  if (label !== "legacy") assert.ok(!reactPage2.includes("CURRENT MAPPING") && !htmlPage2.includes("CURRENT MAPPING"));
  const renderedCertificateNumber = label === "legacy" ? "CURRENT-CERT-NUMBER" : "SYNTHETIC-I1-000001";
  assert.ok(reactPage2.includes(renderedCertificateNumber) && htmlPage2.includes(renderedCertificateNumber));
  assert.equal((reactPage2.match(/QR VERIFICATION/g) ?? []).length, 1);
  assert.equal((htmlPage2.match(/QR VERIFICATION/g) ?? []).length, 1);
  console.log(`actual loader object ${label} React/HTML Page 2: PASS`);
}
for (const [label, loaded, expectPage2, expectQr] of [
  ["captured-back-on", loaderResults.visibilityBackOn, true, true],
  ["captured-back-off", loaderResults.visibilityBackOff, false, true],
  ["captured-qr-on", loaderResults.visibilityQrOn, true, true],
  ["captured-qr-off", loaderResults.visibilityQrOff, true, false],
  ["partial-captured-back-off", loaderResults.visibilityPartial, false, true],
  ["old-snapshot-defaults", loaderResults.visibilityOld, true, true],
  ["legacy-fallback", loaderResults.visibilityLegacy, true, true],
]) {
  const reactFront = renderToStaticMarkup(React.createElement(CertificateFront, { data: loaded.data, config: loaded.config }));
  const reactBack = renderToStaticMarkup(React.createElement(CertificateBack, { data: loaded.data, config: loaded.config }));
  const htmlFront = renderCertificateFront(loaded.data, loaded.config);
  const htmlBack = renderCertificateBack(loaded.data, loaded.config);
  const hasReactPage2 = reactBack.includes("PARTICIPANT SKILLS RECORD");
  const hasHtmlPage2 = htmlBack.includes("PARTICIPANT SKILLS RECORD");
  assert.equal(hasReactPage2, expectPage2, `${label} React Page 2 presence`);
  assert.equal(hasHtmlPage2, expectPage2, `${label} HTML Page 2 presence`);
  assert.equal(reactBack.includes("QR VERIFICATION"), expectPage2 && expectQr, `${label} React QR visibility`);
  assert.equal(htmlBack.includes("QR VERIFICATION"), expectPage2 && expectQr, `${label} HTML QR visibility`);
  assert.ok(!reactFront.includes("QR VERIFICATION") && !htmlFront.includes("QR VERIFICATION"), `${label} must not place QR on Page 1`);
  assert.equal(Boolean(loaded.data.qr_svg), expectQr, `${label} loader QR data agrees with its resolved QR policy`);
  assert.ok(!expectPage2 || reactBack.includes(loaded.data.certificate_number), `${label} visible Page 2 keeps certificate identity`);
  writeFileSync(resolve(fixtureDir, `i1c-${label}.html`), rewriteAssets(renderCertificateDocument(loaded.data, loaded.config)), "utf8");
  console.log(`actual loader ${label} React/HTML Page 2 and QR stability: PASS`);
}
assert.ok(loaderResults.complete.data.skills.find((row) => row.area === "Practical Assessment")?.status === "Passed");
const actualCompleteBack = renderCertificateBack(loaderResults.complete.data, loaderResults.complete.config);
assert.ok(actualCompleteBack.includes("Passed") && actualCompleteBack.includes("Met"));
console.log("actual loader skill values in React/HTML rendered output: PASS");

// 1. Complete modern snapshot: the captured template_config is authoritative;
// render_payload fills only fields absent from that captured configuration.
const completeConfig = resolveSnapshotProgrammePage2(
  {
    design_variant: "standard_scaffold_certificate",
    certificate_number_prefix: "SYNTHETIC-ONLY",
    coverage_items: ["Captured coverage"],
    learning_outcomes: ["Captured outcome"],
    assessment_methods: ["Captured method"],
    show_qr: true,
  },
  {
    objectives_text: "Captured issuance objective",
    coverage_items: ["Payload alternate coverage"],
    learning_outcomes: ["Payload alternate outcome"],
    assessment_methods: ["Payload alternate method"],
  },
);
assert.deepEqual({
  objectives_text: completeConfig.objectives_text,
  coverage_items: completeConfig.coverage_items,
  learning_outcomes: completeConfig.learning_outcomes,
  assessment_methods: completeConfig.assessment_methods,
}, {
  objectives_text: "Captured issuance objective",
  coverage_items: ["Captured coverage"],
  learning_outcomes: ["Captured outcome"],
  assessment_methods: ["Captured method"],
});
assert.equal(completeConfig.show_qr, true);
assert.equal(completeConfig.certificate_number_prefix, "SYNTHETIC-ONLY");
console.log("modern complete snapshot Page 2: PASS");

// 2. Missing optional historical content remains neutral; no programme map is
// accepted by this snapshot-only resolver and no strings are invented.
const incompleteConfig = resolveSnapshotProgrammePage2(
  { design_variant: "standard_scaffold_certificate", show_back_page: true },
  { certificate_number: "SYNTHETIC-ONLY" },
);
assert.equal(incompleteConfig.objectives_text, undefined);
assert.deepEqual(incompleteConfig.coverage_items ?? [], []);
assert.deepEqual(incompleteConfig.learning_outcomes ?? [], []);
assert.deepEqual(incompleteConfig.assessment_methods ?? [], []);
console.log("modern incomplete snapshot Page 2: PASS (neutral empty content)");

// 3. Legacy certificates keep the existing current programme mapping fallback.
const legacyConfig = applyLegacyProgrammePage2(
  { design_variant: "standard_scaffold_certificate" },
  {
    objectives_text: "Legacy mapped objective",
    coverage_items: ["Legacy coverage"],
    learning_outcomes: ["Legacy outcome"],
    assessment_methods: ["Legacy method"],
  },
);
assert.equal(legacyConfig.objectives_text, "Legacy mapped objective");
assert.deepEqual(legacyConfig.coverage_items, ["Legacy coverage"]);
assert.deepEqual(legacyConfig.learning_outcomes, ["Legacy outcome"]);
assert.deepEqual(legacyConfig.assessment_methods, ["Legacy method"]);
console.log("legacy certificate without snapshot fallback: PASS");

// 4. A post-issuance programme-map change cannot affect the modern snapshot
// projection: only the captured config/payload are inputs to the resolver.
const capturedConfig = { design_variant: "standard_scaffold_certificate" };
const capturedPayload = {};
const renderedBefore = resolveSnapshotProgrammePage2(capturedConfig, capturedPayload);
const changedLiveMapping = {
  objectives_text: "Changed current objective",
  coverage_items: ["Changed current coverage"],
  learning_outcomes: ["Changed current outcome"],
  assessment_methods: ["Changed current method"],
};
assert.notDeepEqual(
  applyLegacyProgrammePage2({ ...renderedBefore }, changedLiveMapping),
  renderedBefore,
  "a live-map merge would alter this intentionally incomplete snapshot",
);
assert.deepEqual(resolveSnapshotProgrammePage2(capturedConfig, capturedPayload), renderedBefore);
assert.equal(renderedBefore.objectives_text, undefined);
console.log("historical mapping-change regression: PASS");

// 5. Assessment outcomes continue to come from certificate-level skill rows,
// not programme defaults or participant-level mutable results.
const certificateResults = [
  { area: "theory_session", status: "completed" },
  { area: "practical_training", status: "completed" },
  { area: "safety_awareness", status: "not_recorded" },
  { area: "practical_assessment", status: "passed" },
  { area: "attendance_requirement", status: "met" },
];
const resolvedResults = resolveCertificateSkills(true, certificateResults);
assert.equal(resolvedResults.provenance, "MODERN_SNAPSHOT");
assert.equal(resolvedResults.skills.find((row) => row.area === "Practical Assessment")?.status, "Passed");
assert.match(certData, /from\("certificate_skill_results"\)/);
assert.match(certData, /resolveCertificateSkills\(Boolean\(snapshot\), certificateSkillsRecord\)/);
console.log("certificate skill results remain authoritative: PASS");

// 6. Identity/QR resolution remains independent of Page 2 programme content.
assert.match(certData, /verificationMetadata\.certificate_number \?\? renderPayload\.certificate_number/);
assert.match(certData, /const certificateNumber: string/);
assert.match(certData, /generateQrSvg\(verificationUrl/);
assert.match(certData, /encodeURIComponent\(certificateNumber\)/);
assert.match(certData, /if \(!snapshot && config\.design_variant === "standard_scaffold_certificate"\)/);
assert.match(certData, /if \(!snapshot && config\.design_variant === "working_at_height_certificate"\)/);
console.log("certificate identity and QR source contract: PASS");

const qrSvg = await QRCode.toString("https://example.invalid/verify/SYNTHETIC-I1-000001", {
  type: "svg",
  margin: 1,
  color: { dark: "#0b1f3a", light: "#ffffff" },
});
const renderData = {
  render_mode: "MODERN_SNAPSHOT",
  certificate_number: "SYNTHETIC-I1-000001",
  holder_name: "Synthetic Holder",
  course_name: "Synthetic Scaffold Programme",
  programme_duration: "3 DAYS",
  issue_date: "2026-09-24",
  verification_url: "https://example.invalid/verify/SYNTHETIC-I1-000001",
  qr_svg: qrSvg,
  skills: resolvedResults.skills,
};
const page2Config = {
  design_variant: "standard_scaffold_certificate",
  logo_url: `${publicRoot}/certificates/template-a/teras-symbol-v2.png`,
  show_back_page: true,
  show_qr: true,
  show_skills_record: false,
  certificate_title: "SYNTHETIC CERTIFICATE",
  ...completeConfig,
};
const reactFront = renderToStaticMarkup(React.createElement(CertificateFront, { data: renderData, config: page2Config }));
const reactBack = renderToStaticMarkup(React.createElement(CertificateBack, { data: renderData, config: page2Config }));
const htmlFront = renderCertificateFront(renderData, page2Config);
const htmlBack = renderCertificateBack(renderData, page2Config);
for (const content of ["Captured issuance objective", "Captured coverage", "Captured outcome", "Captured method"]) {
  assert.ok(reactBack.includes(content), `React Page 2 must render captured ${content}`);
  assert.ok(htmlBack.includes(content), `HTML Page 2 must render captured ${content}`);
}
assert.ok(!reactFront.includes("Captured issuance objective"));
assert.ok(!htmlFront.includes("Captured issuance objective"));
assert.ok(!reactFront.includes(qrSvg));
assert.ok(!htmlFront.includes(qrSvg));
assert.equal((reactBack.match(/QR VERIFICATION/g) ?? []).length, 1);
assert.equal((htmlBack.match(/QR VERIFICATION/g) ?? []).length, 1);
assert.ok(reactBack.includes("SYNTHETIC-I1-000001"));
assert.ok(htmlBack.includes("SYNTHETIC-I1-000001"));
console.log("React/HTML content parity and Page 2-only QR: PASS");

const changedMap = {
  objectives_text: "Changed current objective",
  coverage_items: ["Changed current coverage"],
  learning_outcomes: ["Changed current outcome"],
  assessment_methods: ["Changed current method"],
};
const snapshotConfigAfterChange = resolveSnapshotProgrammePage2(page2Config, {
  objectives_text: "Captured issuance objective",
  coverage_items: ["Captured coverage"],
  learning_outcomes: ["Captured outcome"],
  assessment_methods: ["Captured method"],
});
applyLegacyProgrammePage2({ ...snapshotConfigAfterChange }, changedMap);
assert.equal(renderCertificateBack(renderData, snapshotConfigAfterChange), htmlBack);
console.log("rendered historical Page 2 unchanged after current mapping change: PASS");

const incompleteRenderConfig = {
  design_variant: "standard_scaffold_certificate",
  show_back_page: true,
  show_qr: true,
  show_skills_record: false,
  ...incompleteConfig,
};
const incompleteBack = renderCertificateBack(renderData, incompleteRenderConfig);
for (const absent of ["Captured issuance objective", "Captured coverage", "Captured outcome", "Captured method"]) {
  assert.ok(!incompleteBack.includes(absent), `incomplete snapshot must not invent ${absent}`);
}
assert.equal((incompleteBack.match(/QR VERIFICATION/g) ?? []).length, 1);
console.log("modern incomplete snapshot renders neutral empty Page 2: PASS");

const legacyConfigForRender = applyLegacyProgrammePage2(
  { design_variant: "standard_scaffold_certificate", show_back_page: true, show_qr: true, show_skills_record: false },
  {
    objectives_text: "Legacy mapped objective",
    coverage_items: ["Legacy coverage"],
    learning_outcomes: ["Legacy outcome"],
    assessment_methods: ["Legacy method"],
  },
);
const legacyBack = renderCertificateBack({ ...renderData, render_mode: "LEGACY_FALLBACK" }, legacyConfigForRender);
assert.ok(legacyBack.includes("Legacy mapped objective"));
assert.ok(legacyBack.includes("Legacy coverage"));
console.log("legacy Page 2 rendering fallback: PASS");

const modernDocument = renderCertificateDocument(loaderResults.complete.data, loaderResults.complete.config);
assert.equal((modernDocument.match(/QR VERIFICATION/g) ?? []).length, 1);
writeFileSync(resolve(fixtureDir, "modern-complete-two-page.html"), rewriteAssets(modernDocument), "utf8");
writeFileSync(resolve(fixtureDir, "modern-partial-two-page.html"), rewriteAssets(renderCertificateDocument(loaderResults.partial.data, loaderResults.partial.config)), "utf8");
writeFileSync(resolve(fixtureDir, "modern-incomplete-two-page.html"), rewriteAssets(renderCertificateDocument(loaderResults.incomplete.data, loaderResults.incomplete.config)), "utf8");
writeFileSync(resolve(fixtureDir, "legacy-two-page.html"), rewriteAssets(renderCertificateDocument(loaderResults.legacy.data, loaderResults.legacy.config)), "utf8");
console.log(`A4 PDF input fixtures written: ${fixtureDir}`);
