// Phase A contract test: C4 Visual Master -- Option A ported onto
// origin/main's immutable issuance-snapshot architecture.
//
// Covers:
//  1. Erector c4_wave1_v1 snapshot -> Golden Reference, frozen facts used
//  2. Legacy certificate without any snapshot -> generic layout
//  3. certificate_renderer_v1 snapshot (pre-Wave1) -> generic layout
//  4. Inspector / WAH proposed synthetic C4 payloads -> Golden Reference
//  5. Frozen snapshot facts stay stable even when "current" programme/
//     template data would disagree with them
//  6. Historical watermark compatibility (frozen 'scaffolding-technical')
//  7. React / HTML renderer parity
//
// applyGoldenReferenceSnapshotConfig lives in certData.ts, which also
// imports createSupabaseServerClient -> "next/headers"/"server-only" --
// packages a plain Node require() cannot resolve outside Next's own build
// (confirmed: "server-only" is not even present in node_modules here).
// Compiling the whole file is therefore not viable. Instead this test
// extracts the exact, self-contained lines that define
// applyGoldenReferenceSnapshotConfig straight out of the live certData.ts
// source at run time -- so it always exercises the real, current
// implementation, never a hand-copied duplicate -- and compiles only that
// slice, same technique as c4-skills-completeness-contract.mjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Module, { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const scratch = process.env.TMPDIR || tmpdir();
mkdirSync(scratch, { recursive: true });
const probeDir = mkdtempSync(resolve(scratch, "teras-c4-snapshot-contract-"));
const compileDir = resolve(probeDir, "compiled");

// --- Extract applyGoldenReferenceSnapshotConfig from the live certData.ts ---
const certDataPath = resolve(repoRoot, "app/admin/(protected)/certificates/certData.ts");
const certDataSource = readFileSync(certDataPath, "utf8");
const certDataLines = certDataSource.split("\n");
const startIndex = certDataLines.findIndex((line) => line.includes("const GOLDEN_REFERENCE_RENDERER_VERSIONS"));
assert.ok(startIndex !== -1, "could not locate GOLDEN_REFERENCE_RENDERER_VERSIONS in certData.ts -- extraction markers are stale");
const endDeclIndex = certDataLines.findIndex((line, index) => index > startIndex && line.includes("export function applyGoldenReferenceSnapshotConfig"));
assert.ok(endDeclIndex !== -1, "could not locate applyGoldenReferenceSnapshotConfig in certData.ts -- extraction markers are stale");
// Walk by brace depth (not just "first line that is exactly '}'") since the
// function body itself contains a nested `if (content) { ... }` block whose
// own closing brace would otherwise end the slice early.
let depth = 0;
let endIndex = endDeclIndex;
for (; endIndex < certDataLines.length; endIndex += 1) {
  for (const ch of certDataLines[endIndex]) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  if (depth === 0 && certDataLines[endIndex].includes("}")) break;
}
const slice = certDataLines
  .slice(startIndex, endIndex + 1)
  .join("\n")
  // The only external dependency is the (type-only, erased at emit)
  // GoldenReferenceFamily cast, which resolves relative to the real repo
  // tree and wouldn't resolve from this standalone scratch-dir probe --
  // strip it; it has no runtime effect.
  .replace(/ as GoldenReferenceFamily/g, "")
  .replace("config: TemplateConfig,", "config: any,");
// applyGoldenReferenceSnapshotConfig calls levelOf (imported from
// lib/certificate-watermark-assets.ts); extract that live definition too
// rather than hand-copying it.
const watermarkSource = readFileSync(resolve(repoRoot, "lib/certificate-watermark-assets.ts"), "utf8");
const levelsDecl = watermarkSource.match(/const LEVELS = [^\r\n]+\r?\n/);
const levelOfDecl = watermarkSource.match(/export function levelOf\([\s\S]*?\r?\n}\r?\n/);
assert.ok(levelsDecl && levelOfDecl, "could not locate LEVELS/levelOf in certificate-watermark-assets.ts -- extraction markers are stale");
const levelHelpers = `${levelsDecl[0]}${levelOfDecl[0]}`.replace(/WatermarkLevel/g, "string");
writeFileSync(resolve(probeDir, "apply-golden-reference-probe.ts"), `${levelHelpers}\n${slice}\n`, "utf8");

// --- Compile the probe + the real renderer sources we need to require ---
execFileSync(process.execPath, [
  resolve(repoRoot, "node_modules/typescript/bin/tsc"),
  "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021",
  "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
  "--rootDir", probeDir, "--outDir", resolve(compileDir, "probe"),
  resolve(probeDir, "apply-golden-reference-probe.ts"),
], { cwd: repoRoot, stdio: "inherit" });

execFileSync(process.execPath, [
  resolve(repoRoot, "node_modules/typescript/bin/tsc"),
  "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021",
  "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
  "--rootDir", repoRoot, "--outDir", resolve(compileDir, "repo"),
  resolve(repoRoot, "components/admin/CertificateRenderer.tsx"),
  resolve(repoRoot, "lib/certificate-format.ts"),
  resolve(repoRoot, "lib/certificate-design-system.ts"),
  resolve(repoRoot, "lib/certificate-watermark-assets.ts"),
  resolve(repoRoot, "lib/certificate-approval-assets.ts"),
  resolve(repoRoot, "lib/certificate-html.ts"),
  resolve(repoRoot, "lib/teras-company.ts"),
], { cwd: repoRoot, stdio: "inherit" });

process.env.NODE_PATH = [resolve(repoRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const { applyGoldenReferenceSnapshotConfig } = require(resolve(compileDir, "probe/apply-golden-reference-probe.js"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { CertificateFront, CertificateBack } = require(resolve(compileDir, "repo/components/admin/CertificateRenderer.js"));
const { renderCertificateFront, renderCertificateBack } = require(resolve(compileDir, "repo/lib/certificate-html.js"));

assert.equal(typeof applyGoldenReferenceSnapshotConfig, "function", "applyGoldenReferenceSnapshotConfig was not exported from the extracted slice");

// ============================================================
// 1. Erector c4_wave1_v1 snapshot -- real, live render_payload shape
//    (confirmed by direct read-only inspection of
//    app.capture_c4_wave1_erector_snapshot() on eokiaehnvzbggmacifcf)
// ============================================================
const erectorPayload = {
  canonical_course_id: "2a78decf-6997-4626-a7cc-a1a23a110cf8",
  certificate_family: "scaffold_erector",
  certificate_title: "SCAFFOLDING TRAINING CERTIFICATE",
  programme_level: "basic",
  programme_content: {
    programme_title: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME",
    programme_duration: "10-Day Practical Training",
    objectives: "Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures.",
    coverage: ["Scaffolding Components & Terminology", "Workplace Hazard Identification"],
    outcomes: ["Identify scaffolding components and terminology correctly"],
    assessment: ["Theory Assessment", "Practical Assessment"],
  },
  watermark_asset_family: "scaffolding-technical",
};
{
  const config = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_v1", erectorPayload);
  assert.equal(config.golden_reference_family, "scaffold_erector", "Erector: golden_reference_family must come from the frozen certificate_family verbatim");
  assert.equal(config.certificate_title, "SCAFFOLDING TRAINING CERTIFICATE", "Erector: certificate_title must come from the frozen render_payload");
  assert.equal(config.show_back_page, true);
  assert.equal(config.show_qr, true);
  assert.equal(config.frozen_watermark_asset_family, "scaffolding-technical");
  assert.equal(config.programme_title, "TERAS BASIC SCAFFOLD ERECTION PROGRAMME");
  assert.equal(config.duration_label, "10-Day Practical Training");
  assert.deepEqual(config.coverage_items, ["Scaffolding Components & Terminology", "Workplace Hazard Identification"]);
  console.log("PASS Erector c4_wave1_v1 snapshot populates Golden Reference config from frozen render_payload");
}

// ============================================================
// 2. Legacy certificate -- no snapshot at all (renderer_version is
//    undefined/null, exactly as certData.ts passes when snapshot is null)
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(config, null, {});
  assert.equal(config.golden_reference_family, undefined, "Legacy (no snapshot): must never gain a golden_reference_family");
  assert.equal(config.certificate_title, undefined, "Legacy (no snapshot): must never gain a certificate_title");
  console.log("PASS Legacy certificate without any snapshot keeps the generic layout untouched");
}

// ============================================================
// 3. MODERN_SNAPSHOT but pre-Wave1 (certificate_renderer_v1) -- a real,
//    already-issued snapshot exists, but it predates any C4 trigger
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(config, "certificate_renderer_v1", { certificate_number: "TU-CERT-0001" });
  assert.equal(config.golden_reference_family, undefined, "Pre-Wave1 MODERN_SNAPSHOT: must never gain a golden_reference_family");
  assert.equal(config.certificate_title, undefined, "Pre-Wave1 MODERN_SNAPSHOT: must never gain a certificate_title");
  console.log("PASS certificate_renderer_v1 (pre-Wave1) snapshot keeps its historical generic layout");
}

// ============================================================
// 4. Inspector c4_wave1_inspector_v1 -- the render_payload shape written by
//    supabase/migrations/20261102090000_production_inspector_c4_snapshot_
//    dispatch.sql (frozen inspector_watermark_level, no
//    watermark_asset_family). WAH below is still a PROPOSED contract that
//    no trigger writes yet.
// ============================================================
const { resolveCertificateWatermarkAsset } = require(resolve(compileDir, "repo/lib/certificate-watermark-assets.js"));
for (const level of ["basic", "intermediate", "advanced"]) {
  const config = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_inspector_v1", {
    certificate_family: "scaffold_inspector",
    certificate_title: "SCAFFOLDING INSPECTION CERTIFICATE",
    programme_level: level,
    programme_content: { programme_title: `TERAS ${level.toUpperCase()} SCAFFOLD INSPECTION PROGRAMME`, programme_duration: "2-Day Practical Training" },
    inspector_watermark_level: level,
  });
  assert.equal(config.golden_reference_family, "scaffold_inspector");
  assert.equal(config.certificate_title, "SCAFFOLDING INSPECTION CERTIFICATE");
  assert.equal(config.inspector_watermark_level, level, "Inspector: watermark level must come from the frozen render_payload");
  assert.equal(config.frozen_watermark_asset_family, null, "Inspector: must not carry Erector's frozen watermark family");
  assert.equal(config.duration_label, "2-Day Practical Training");
  assert.equal(resolveCertificateWatermarkAsset(config)?.src, `/certificates/watermarks/inspector-${level}.svg`);
  console.log(`PASS Inspector ${level} c4_wave1_inspector_v1 snapshot -> Golden Reference with inspector-${level} watermark`);
}
{
  // An Inspector-shaped payload under an unrecognised renderer must stay legacy.
  const config = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(config, "certificate_renderer_v1", { certificate_family: "scaffold_inspector", certificate_title: "SCAFFOLDING INSPECTION CERTIFICATE", inspector_watermark_level: "basic" });
  assert.equal(config.golden_reference_family, undefined);
  assert.equal(config.inspector_watermark_level, undefined);
  // Erector snapshots never gain an Inspector watermark level.
  const erector = { design_variant: "standard_scaffold_certificate" };
  applyGoldenReferenceSnapshotConfig(erector, "c4_wave1_v1", erectorPayload);
  assert.equal(erector.inspector_watermark_level, undefined);
  assert.equal(resolveCertificateWatermarkAsset(erector)?.src, "/certificates/watermarks/scaffolding-technical.svg");
  console.log("PASS Inspector fields ignored for legacy renderer; Erector keeps scaffolding-technical watermark");
}
{
  const config = { design_variant: "working_at_height_certificate" };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_wah_v1", {
    certificate_family: "working_at_height",
    certificate_title: "WORKING AT HEIGHT TRAINING CERTIFICATE",
    programme_content: { programme_title: "Working at Height", programme_duration: "2-Day Practical Training" },
    watermark_asset_family: "working-at-height",
  });
  assert.equal(config.golden_reference_family, "working_at_height");
  assert.equal(config.certificate_title, "WORKING AT HEIGHT TRAINING CERTIFICATE");
  console.log("PASS WAH c4_wave1_wah_v1 synthetic payload dispatches correctly (draft migration, not applied)");
}

{
  // Production-confirmed defect (CERT-2026-000099): template_config freezes these
  // lists as [], and ??= would keep them.
  const emptyArrays = () => ({ coverage_items: [], learning_outcomes: [], assessment_methods: [] });
  const list = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
  const contentOf = (cov, out, asm) => ({ programme_title: "T", programme_duration: "D", objectives: "O", coverage: list("C", cov), outcomes: list("L", out), assessment: list("A", asm) });
  const families = [
    ["Inspector", "c4_wave1_inspector_v1", "standard_scaffold_certificate", { certificate_family: "scaffold_inspector", certificate_title: "SCAFFOLDING INSPECTION CERTIFICATE", inspector_watermark_level: "basic" }, [7, 5, 3]],
    ["Erector", "c4_wave1_v1", "standard_scaffold_certificate", { certificate_family: "scaffold_erector", certificate_title: "SCAFFOLDING TRAINING CERTIFICATE", watermark_asset_family: "scaffolding-technical" }, [7, 5, 3]],
    ["WAH", "c4_wave1_wah_v1", "working_at_height_certificate", { certificate_family: "working_at_height", certificate_title: "WORKING AT HEIGHT TRAINING CERTIFICATE", watermark_asset_family: "working-at-height" }, [9, 6, 5]],
  ];
  for (const [label, version, variant, facts, [cov, out, asm]] of families) {
    const content = contentOf(cov, out, asm);
    const payload = { ...facts, programme_content: content };
    const before = JSON.stringify(payload);
    const config = { design_variant: variant, show_skills_record: false, ...emptyArrays() };
    applyGoldenReferenceSnapshotConfig(config, version, payload);
    assert.deepEqual([config.coverage_items, config.learning_outcomes, config.assessment_methods], [content.coverage, content.outcomes, content.assessment]);
    assert.equal(config.certificate_title, facts.certificate_title);
    assert.equal(config.show_skills_record, true);
    assert.equal(config.frozen_watermark_asset_family, facts.watermark_asset_family ?? null);
    assert.equal(JSON.stringify(payload), before, "the frozen payload must not be mutated");
    // Conflicting template values never replace frozen content.
    const conflicting = { design_variant: variant, programme_title: "TEMPLATE", duration_label: "TEMPLATE", objectives_text: "TEMPLATE", coverage_items: ["TEMPLATE"], learning_outcomes: ["TEMPLATE"], assessment_methods: ["TEMPLATE"] };
    applyGoldenReferenceSnapshotConfig(conflicting, version, payload);
    assert.deepEqual([conflicting.programme_title, conflicting.duration_label, conflicting.objectives_text, conflicting.coverage_items, conflicting.learning_outcomes, conflicting.assessment_methods], [content.programme_title, content.programme_duration, content.objectives, content.coverage, content.outcomes, content.assessment]);
    // Missing frozen fields are not invented; the snapshot's own value stays.
    const partial = { design_variant: variant, programme_title: "OWN", coverage_items: ["OWN"] };
    applyGoldenReferenceSnapshotConfig(partial, version, { ...facts, programme_content: { objectives: "O" } });
    assert.deepEqual([partial.programme_title, partial.coverage_items, partial.duration_label, partial.objectives_text], ["OWN", ["OWN"], undefined, "O"]);
    console.log(`PASS ${label} frozen ${cov}/${out}/${asm} content replaces empty and conflicting template values`);
  }
  // Legacy and unrelated paths: no C4 renderer_version, no change, even when a
  // payload happens to carry content.
  const stray = { certificate_family: "working_at_height", certificate_title: "X", programme_content: contentOf(9, 6, 5) };
  for (const [version, variant] of [["certificate_renderer_v1", "working_at_height_certificate"], [null, "working_at_height_certificate"], ["certificate_renderer_v1", "standard_scaffold_certificate"], ["certificate_renderer_v1", "professional_scaffold_erection_skills"]]) {
    const config = { design_variant: variant, ...emptyArrays() };
    const before = JSON.stringify(config);
    applyGoldenReferenceSnapshotConfig(config, version, stray);
    assert.equal(JSON.stringify(config), before);
  }
  console.log("PASS legacy WAH, legacy scaffold and Professional configs untouched; no retroactive content");
}

// ============================================================
// 5. Frozen facts stay stable even when "current" programme data disagrees
//    -- the function takes no course_id/programme lookup input at all, so
//    there is no way for it to pick up a changed live value; prove this by
//    feeding programme_content that deliberately differs from the real
//    lib/standard-scaffold-programmes.ts basic_erection entry and confirming
//    the frozen (not live) text wins.
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate" };
  const mutatedProgrammeContent = {
    ...erectorPayload,
    programme_content: { ...erectorPayload.programme_content, programme_title: "DELIBERATELY DIFFERENT FROM LIVE PROGRAMME DATA" },
  };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_v1", mutatedProgrammeContent);
  assert.equal(config.programme_title, "DELIBERATELY DIFFERENT FROM LIVE PROGRAMME DATA", "The frozen payload's own text must render verbatim, never silently reconciled against current programme data");
  console.log("PASS frozen render_payload content is used as-is, never cross-checked or overridden by current programme data");
}

// ============================================================
// 6. Historical watermark compatibility -- the frozen legacy value
//    resolves through the real resolver to the real, existing asset file.
// ============================================================
{
  const { resolveCertificateWatermarkAsset } = require(resolve(compileDir, "repo/lib/certificate-watermark-assets.js"));
  const asset = resolveCertificateWatermarkAsset({ frozen_watermark_asset_family: "scaffolding-technical", watermark_level: "basic" });
  assert.ok(asset, "a frozen 'scaffolding-technical' value must resolve to an asset, not null");
  assert.equal(asset.src, "/certificates/watermarks/scaffolding-technical.svg", "frozen Erector watermark must resolve to its own historical file, not a newer per-level file");
  const unrecognized = resolveCertificateWatermarkAsset({ frozen_watermark_asset_family: "not-a-real-frozen-value", watermark_level: "advanced" });
  assert.equal(unrecognized?.src, "/certificates/watermarks/erector-advanced.svg", "an unrecognized frozen value must fall through to normal (current) resolution, not fail closed");
  console.log("PASS historical 'scaffolding-technical' watermark resolves to its own asset; unrecognized frozen values fall through safely");
}

// ============================================================
// 7. React / HTML parity for a full Golden Reference Erector render
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate", primary_color: "#0B3A63", accent_color: "#D4AF37", logo_url: "/certificates/template-a/teras-symbol-v2.png" };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_v1", erectorPayload);
  const data = {
    certificate_number: "TU-CERT-2026-ERECTOR-000123",
    holder_name: "SYNTHETIC QA PARTICIPANT",
    course_name: "BASIC SCAFFOLDING ERECTOR",
    training_date: "2026-09-01",
    training_end_date: "2026-09-10",
    issue_date: "2026-09-10",
    venue: "Synthetic QA Venue",
    ic_passport: "SYNTHETIC-NOT-REAL",
    qr_svg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  };
  const reactFront = renderToStaticMarkup(React.createElement(CertificateFront, { data, config }));
  const htmlFront = renderCertificateFront(data, config);
  for (const [name, markup] of [["React", reactFront], ["HTML", htmlFront]]) {
    assert.ok(markup.includes("SCAFFOLDING TRAINING CERTIFICATE"), `${name}: Golden Reference certificate_title must render`);
    assert.ok(markup.includes("SYNTHETIC QA PARTICIPANT"), `${name}: holder name must render`);
    assert.ok(!markup.includes(">CERTIFICATE</h1>"), `${name}: must not fall through to the generic bare "CERTIFICATE" heading`);
  }
  const reactBack = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
  const htmlBack = renderCertificateBack(data, config);
  for (const [name, markup] of [["React", reactBack], ["HTML", htmlBack]]) {
    assert.ok(markup.includes("QR VERIFICATION"), `${name}: Page 2 QR heading must render for a Golden Reference certificate`);
    assert.ok(markup.includes("TERAS BASIC SCAFFOLD ERECTION PROGRAMME"), `${name}: frozen programme title must render on the back page`);
  }
  console.log("PASS React/HTML parity holds for a full Golden Reference Erector render (front + back)");
}

// ============================================================
// 8. Five-area skills record must now be VISIBLE for an eligible Golden
//    Reference certificate (the show_skills_record fix), using the real
//    skills data as-is -- no fabricated/substituted statuses.
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate", primary_color: "#0B3A63", accent_color: "#D4AF37" };
  applyGoldenReferenceSnapshotConfig(config, "c4_wave1_v1", erectorPayload);
  assert.equal(config.show_skills_record, true, "show_skills_record must be enabled for an eligible Golden Reference certificate");
  const data = {
    certificate_number: "TU-CERT-2026-ERECTOR-SKILLS-000124",
    holder_name: "SYNTHETIC QA PARTICIPANT",
    course_name: "BASIC SCAFFOLDING ERECTOR",
    skills: [
      { area: "Theory Session", status: "Completed" },
      { area: "Practical Training", status: "Completed" },
      { area: "Safety Awareness", status: "Completed" },
      { area: "Practical Assessment", status: "Passed" },
      { area: "Attendance Requirement", status: "Met" },
    ],
  };
  const reactBack = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
  const htmlBack = renderCertificateBack(data, config);
  for (const [name, markup] of [["React", reactBack], ["HTML", htmlBack]]) {
    assert.ok(markup.includes("PARTICIPANT SKILLS RECORD"), `${name}: skills record section must be visible`);
    for (const area of ["Theory Session", "Practical Training", "Safety Awareness", "Practical Assessment", "Attendance Requirement"]) {
      assert.ok(markup.includes(area), `${name}: skills area "${area}" must render verbatim`);
    }
  }
  console.log("PASS five-area skills record is now visible for an eligible Golden Reference certificate, in React and HTML");
}

// ============================================================
// 9. Historical watermark asset file now actually exists on disk (it was
//    missing before this fix) and the resolver's src path resolves to it.
// ============================================================
{
  const assetPath = resolve(repoRoot, "public/certificates/watermarks/scaffolding-technical.svg");
  assert.ok(existsSync(assetPath), "public/certificates/watermarks/scaffolding-technical.svg must exist on disk");
  const svg = readFileSync(assetPath, "utf8");
  assert.ok(svg.includes("<svg"), "the restored asset must be a real SVG file, not an empty/placeholder file");
  console.log("PASS scaffolding-technical.svg now exists on disk and is a real SVG");
}

// ============================================================
// 10. Issuing Branch Address: renders only when present; never fabricated,
//     never substituted by venue when absent.
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate", contact_phone: "012-3456789" };
  const withAddress = { certificate_number: "TU-CERT-ADDR-001", holder_name: "SYNTHETIC QA PARTICIPANT", venue: "Synthetic QA Training Venue", issuer_branch_address: "LOT 1961, JALAN TANAH MERAH, KG TANAH MERAH DALAM, 06000 JITRA, KEDAH." };
  const withoutAddress = { certificate_number: "TU-CERT-ADDR-002", holder_name: "SYNTHETIC QA PARTICIPANT", venue: "Synthetic QA Training Venue", issuer_branch_address: null };
  for (const [name, renderFn, dataIn] of [
    ["React present", (d, c) => renderToStaticMarkup(React.createElement(CertificateBack, { data: d, config: c })), withAddress],
    ["HTML present", renderCertificateBack, withAddress],
    ["React absent", (d, c) => renderToStaticMarkup(React.createElement(CertificateBack, { data: d, config: c })), withoutAddress],
    ["HTML absent", renderCertificateBack, withoutAddress],
  ]) {
    const markup = renderFn(dataIn, config);
    if (dataIn.issuer_branch_address) {
      assert.ok(markup.includes("Issuing Branch Address"), `${name}: label must render when an address is present`);
      assert.ok(markup.includes("JITRA"), `${name}: the real address text must render verbatim`);
    } else {
      assert.ok(!markup.includes("Issuing Branch Address"), `${name}: label must not render when no address is present`);
      assert.ok(!markup.includes("Synthetic QA Training Venue".toUpperCase()) || true, "sanity no-op"); // venue itself is expected elsewhere on the page; see next assertion
    }
    // Venue must never be mistaken for the issuer address in either case: the
    // literal "Issuing Branch Address" label must only ever be followed by
    // the real address text, never by the venue string.
    if (markup.includes("Issuing Branch Address")) {
      assert.ok(!markup.includes("Issuing Branch Address</div><div style=\"color:#0B3A63;font-weight:700;margin-top:2px;\">Synthetic QA Training Venue"), `${name}: venue must never be substituted for the issuer address`);
    }
  }
  console.log("PASS Issuing Branch Address renders only when an authoritative address is present, never substituting venue");
}

// ============================================================
// 11. Issuing Branch Address spans the full Verification grid width
//     (fixes the Page 2 footer-overlap defect); every other field in the
//     same grid stays single-column, unchanged.
// ============================================================
{
  const config = { design_variant: "standard_scaffold_certificate", contact_phone: "012-3456789", contact_website: "www.terasuniversal.com.my", contact_email: "info@terasuniversal.com.my" };
  const data = { certificate_number: "TU-CERT-ADDR-003", holder_name: "SYNTHETIC QA PARTICIPANT", issuer_branch_address: "LOT 1961, JALAN TANAH MERAH, KG TANAH MERAH DALAM, 06000 JITRA, KEDAH." };
  const reactMarkup = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
  const htmlMarkup = renderCertificateBack(data, config);
  // React's renderToStaticMarkup serializes the gridColumn style prop as
  // kebab-case CSS text in the actual HTML output (not the JSX source
  // spelling), so match that rendered form.
  assert.ok(reactMarkup.includes("grid-column:1 / -1"), "React: Issuing Branch Address cell must span the full grid width");
  assert.ok(htmlMarkup.includes("grid-column:1 / -1"), "HTML: Issuing Branch Address cell must span the full grid width");
  // Scoping: the span rule must appear exactly once per render (only on the
  // address cell), not applied to Contact Number/Website/Email too.
  const reactSpanCount = (reactMarkup.match(/grid-column:1 \/ -1/g) || []).length;
  const htmlSpanCount = (htmlMarkup.match(/grid-column:1 \/ -1/g) || []).length;
  assert.equal(reactSpanCount, 1, "React: full-width span must be scoped to exactly the address cell, not applied elsewhere");
  assert.equal(htmlSpanCount, 1, "HTML: full-width span must be scoped to exactly the address cell, not applied elsewhere");
  console.log("PASS Issuing Branch Address spans the full Verification grid width, scoped only to that one field, in React and HTML");
}

console.log("c4-snapshot-renderer-contract: all Phase A snapshot-safe Golden Reference checks passed");
