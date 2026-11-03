// Private certificate render assets: allowlist, historical reference mapping,
// authorization, SHA-256 integrity, fail-closed rendering and no public path.
// Synthetic images only; never contacts Supabase. Run with --experimental-strip-types.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";
import {
  CERTIFICATE_RENDER_ASSETS_BUCKET,
  CertificateRenderAssetError,
  MAX_RENDER_ASSET_BYTES,
  RENDER_ASSETS,
  SIGNATURE_REFERENCES,
  createRenderAssetLoader,
  requiredRenderAssets,
  sha256Hex,
  zipRenderAssetPath,
} from "../lib/certificate-render-asset-policy.ts";
import { SYNTHETIC_RENDER_ASSETS, SYNTHETIC_SEAL_PNG, SYNTHETIC_SIGNATURE_PNG } from "./synthetic-render-assets.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const pass = (label) => console.log(`PASS ${label}`);
const rejectsWith = async (fn, code, label) => {
  await assert.rejects(fn, (e) => e instanceof CertificateRenderAssetError && e.code === code, label);
};

// 1. Allowlist and historical mapping.
assert.equal(CERTIFICATE_RENDER_ASSETS_BUCKET, "certificate-render-assets");
assert.equal(MAX_RENDER_ASSET_BYTES, 1048576);
for (const [key, entry] of Object.entries(RENDER_ASSETS)) {
  assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${key}: pinned SHA-256`);
  assert.match(entry.objectPath, /^(signatures|seals)\/[a-z0-9-]+-v\d+\.png$/, `${key}: versioned object path`);
}
assert.deepEqual(Object.keys(SIGNATURE_REFERENCES).sort(), ["/signatures/director-signature-v2.png", "/signatures/director-signature.png"]);
const need = (o) => requiredRenderAssets({ goldenReference: false, ...o });
assert.deepEqual(requiredRenderAssets({ goldenReference: true, signatureReference: "/signatures/director-signature-v2.png" }), { signature: "director-signature-refined-v1", seal: "common-seal-3d-34mm-v1" }, "C4 always uses the refined signature and seal (Option A)");
assert.deepEqual(need({ designVariant: "standard_scaffold_certificate", signatureReference: "/signatures/director-signature-v2.png" }), { signature: "director-signature-legacy-v2", seal: null });
assert.deepEqual(need({ designVariant: "working_at_height_certificate", signatureReference: "/signatures/director-signature.png" }), { signature: "director-signature-legacy-v1", seal: null });
assert.deepEqual(need({ designVariant: "working_at_height_certificate" }), { signature: "director-signature-legacy-v1", seal: null }, "single-signatory default");
assert.deepEqual(need({ designVariant: "professional_scaffold_erection_skills" }), { signature: "director-signature-legacy-v1", seal: null }, "Professional default");
assert.deepEqual(need({ designVariant: "generic", signatureLayout: "dual" }), { signature: null, seal: null }, "dual layout without a signature keeps the empty labelled well");
for (const bad of ["/signatures/other.png", "https://example.test/sig.png", "constructor", "__proto__", "toString", " /signatures/director-signature.png/ "]) {
  assert.throws(() => need({ designVariant: "working_at_height_certificate", signatureReference: bad }), (e) => e instanceof CertificateRenderAssetError && e.code === "unknown_reference", `unknown reference rejected: ${bad}`);
}
assert.deepEqual(need({ designVariant: "working_at_height_certificate", signatureReference: "  /signatures/director-signature.png  " }), { signature: "director-signature-legacy-v1", seal: null }, "surrounding whitespace tolerated");
pass("allowlist, pinned hashes and historical signature mapping (unknown references fail closed)");

// 2. Loader: authorization, integrity, failure, caching. Synthetic registry and bytes.
const registry = {
  "director-signature-refined-v1": { objectPath: "signatures/synthetic-sig-v1.png", sha256: sha256Hex(SYNTHETIC_SIGNATURE_PNG) },
  "common-seal-3d-34mm-v1": { objectPath: "seals/synthetic-seal-v1.png", sha256: sha256Hex(SYNTHETIC_SEAL_PNG) },
};
const store = new Map([["signatures/synthetic-sig-v1.png", SYNTHETIC_SIGNATURE_PNG], ["seals/synthetic-seal-v1.png", SYNTHETIC_SEAL_PNG]]);
const harness = (over = {}) => {
  const calls = { authorize: 0, download: [] };
  const load = createRenderAssetLoader({
    registry,
    authorize: async () => { calls.authorize += 1; return over.allowed ?? true; },
    download: async (path) => { calls.download.push(path); if (over.download) return over.download(path); if (!store.has(path)) throw new Error("missing"); return new Uint8Array(store.get(path)); },
  });
  return { load, calls };
};
const keys = ["director-signature-refined-v1", "common-seal-3d-34mm-v1"];
{
  const { load, calls } = harness({ allowed: false });
  await rejectsWith(() => load(keys), "unauthorized", "unauthorized user");
  assert.equal(calls.download.length, 0, "nothing downloaded for an unauthorized user");
  const throwing = createRenderAssetLoader({ registry, authorize: async () => { throw new Error("rpc down"); }, download: async () => { throw new Error("must not run"); } });
  await rejectsWith(() => throwing(keys), "unauthorized", "authorization error fails closed");
}
{
  const { load } = harness({ download: () => { throw new Error("object not found"); } });
  await rejectsWith(() => load(keys), "unavailable", "missing object");
}
for (const [label, bytes] of [
  ["corrupt bytes", Buffer.concat([SYNTHETIC_SIGNATURE_PNG.subarray(0, 40), Buffer.from("tampered")])],
  ["different valid PNG", SYNTHETIC_SEAL_PNG],
  ["non-PNG bytes", Buffer.from("GIF89a synthetic")],
  ["empty object", Buffer.alloc(0)],
  ["over 1 MiB", Buffer.concat([SYNTHETIC_SIGNATURE_PNG, Buffer.alloc(MAX_RENDER_ASSET_BYTES)])],
]) {
  const { load } = harness({ download: (path) => (path.startsWith("signatures/") ? new Uint8Array(bytes) : new Uint8Array(SYNTHETIC_SEAL_PNG)) });
  await rejectsWith(() => load(keys), "integrity", label);
}
{
  const { load, calls } = harness();
  const first = await load(keys);
  assert.equal(sha256Hex(first.get("director-signature-refined-v1").bytes), registry["director-signature-refined-v1"].sha256);
  await load(keys);
  assert.equal(calls.download.length, 2, "verified bytes cached per instance");
  assert.equal(calls.authorize, 2, "authorization re-checked on every call");
  await rejectsWith(() => load(["not-allowlisted"]), "unknown_reference", "key outside the allowlist");
}
{
  let fail = true;
  const load = createRenderAssetLoader({ registry, authorize: async () => true, download: async (p) => { if (fail) throw new Error("transient"); return new Uint8Array(store.get(p)); } });
  await rejectsWith(() => load(keys), "unavailable", "first attempt fails");
  fail = false;
  assert.equal((await load(keys)).size, 2, "failures are not cached");
}
for (const code of ["unauthorized", "unknown_reference", "unavailable", "integrity"]) {
  const message = new CertificateRenderAssetError(code).message;
  assert.ok(!/[\\/]|bucket|supabase|http|\.png/i.test(message), `fixed message has no path or URL: ${message}`);
}
assert.equal(zipRenderAssetPath("ab".repeat(32)), `assets/${"ab".repeat(32)}.png`);
pass("loader: authorization every call, missing/corrupt/foreign/oversize assets fail closed, verified-only cache, fixed messages");

// 3. Renderers: required assets, preview mode, no public fallback. Compiled with the same tsc options as the other render contracts.
const outDir = mkdtempSync(join(tmpdir(), "teras-render-assets-"));
try {
  execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck", "--noCheck", "--rootDir", root, "--outDir", outDir,
    resolve(root, "components/admin/CertificateRenderer.tsx"), resolve(root, "lib/certificate-html.ts")], { cwd: root, stdio: "pipe" });
} catch (error) {
  if (!statSync(join(outDir, "lib/certificate-html.js"), { throwIfNoEntry: false })) throw error;
}
// The compiled renderers live in a temp dir; resolve react from the repo, as c4-wah-render-qa.mjs does.
process.env.NODE_PATH = [resolve(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const React = require(resolve(root, "node_modules/react"));
const { renderToStaticMarkup } = require(resolve(root, "node_modules/react-dom/server"));
const { CertificateFront } = require(join(outDir, "components/admin/CertificateRenderer.js"));
const { renderCertificateFront, renderCertificateDocument } = require(join(outDir, "lib/certificate-html.js"));
const base = { certificate_number: "CERT-SYNTH-0001", holder_name: "SYNTHETIC QA PARTICIPANT", course_name: "Synthetic Course", issue_date: "2026-11-03", qr_svg: "<svg/>" };
const golden = { design_variant: "working_at_height_certificate", golden_reference_family: "working_at_height", certificate_title: "WORKING AT HEIGHT TRAINING CERTIFICATE", show_back_page: true };
const generic = { design_variant: "working_at_height_certificate", show_back_page: true, signature_url: "/signatures/director-signature.png" };
const dual = { design_variant: "generic", signature_layout: "dual", show_back_page: true };
const professional = { design_variant: "professional_scaffold_erection_skills", show_back_page: true };
const react = (data, config) => renderToStaticMarkup(React.createElement(CertificateFront, { data, config }));
// The HTML path dispatches Professional Scaffold inside renderCertificateDocument, as the ZIP route does.
const html = (data, config) => (config.design_variant === "professional_scaffold_erection_skills" ? renderCertificateDocument(data, config) : renderCertificateFront(data, config));
for (const [name, render] of [["React", react], ["HTML", html], ["HTML document", (d, c) => renderCertificateDocument(d, c)]]) {
  for (const [label, config] of [["golden", golden], ["generic", generic], ["professional", professional]]) {
    assert.throws(() => render(base, config), /render assets were not resolved/, `${name} ${label}: no assets -> throws`);
  }
  assert.throws(() => render({ ...base, render_assets: { mode: "resolved", signature: SYNTHETIC_RENDER_ASSETS.signature, seal: null } }, golden), /incomplete/, `${name}: C4 without seal -> throws`);
  assert.throws(() => render({ ...base, render_assets: { mode: "resolved", signature: null, seal: null } }, professional), /incomplete/, `${name}: Professional without signature -> throws`);
  const g = render({ ...base, render_assets: SYNTHETIC_RENDER_ASSETS }, golden);
  assert.ok(g.includes(SYNTHETIC_RENDER_ASSETS.signature) && g.includes(SYNTHETIC_RENDER_ASSETS.seal), `${name}: C4 draws the supplied signature and seal`);
  assert.ok(/data-certificate-seal="common-seal-3d"[^>]*width:\s?136\.82px/.test(g), `${name}: seal drawn at 34 mm (136.82 px with shadow)`);
  assert.ok(g.includes('data-certificate-stamp-area="seal"') && !g.includes('data-certificate-stamp-area="reserved"'), `${name}: seal replaces the empty ring`);
  assert.ok(/data-certificate-signature="director"[^>]*max-height:\s?68px;max-width:\s?180px/.test(g), `${name}: C4 signature at the approved 68 px preview size`);
  assert.ok(/data-certificate-signature="director"[^>]*max-height:\s?92px;max-width:\s?145px/.test(render({ ...base, render_assets: SYNTHETIC_RENDER_ASSETS }, generic)), `${name}: generic signature size unchanged (92 px)`);
  assert.ok(/data-certificate-signature="director"[^>]*width:\s?154px;height:\s?105px/.test(render({ ...base, render_assets: SYNTHETIC_RENDER_ASSETS }, professional)), `${name}: Professional signature size unchanged (154x105)`);
  const p = render({ ...base, render_assets: { mode: "preview" } }, golden);
  assert.ok(p.includes('data-certificate-signature="preview"') && p.includes('data-certificate-stamp-area="reserved"') && !p.includes("data:image/png"), `${name}: preview has no images`);
  const blank = render({ ...base, render_assets: { mode: "resolved", signature: null, seal: null } }, { ...dual, signature_url: "   " });
  assert.ok(blank.includes("Authorised Signature"), `${name}: whitespace-only signature_url treated as absent, as the policy does`);
  assert.deepEqual(requiredRenderAssets({ goldenReference: false, designVariant: "generic", signatureLayout: "dual", signatureReference: "   " }), { signature: null, seal: null });
  const d = render({ ...base, render_assets: { mode: "resolved", signature: null, seal: null } }, dual);
  assert.ok(d.includes("Authorised Signature") && !d.includes("data-certificate-signature"), `${name}: dual layout keeps the labelled empty well`);
  for (const [label, config] of [["golden", golden], ["generic", generic], ["professional", professional]]) {
    const out = render({ ...base, render_assets: SYNTHETIC_RENDER_ASSETS }, config);
    assert.ok(!out.includes("/signatures/") && !out.includes("/seals/"), `${name} ${label}: no public signature/seal path in output`);
  }
}
pass("React and HTML/ZIP renderers: assets required, C4 seal at 34 mm, preview shows no images, no public path emitted");

// 4. Source invariants.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", ".git", ".next", "work"].includes(e.name) ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));
const runtime = ["app", "lib", "components"].flatMap((d) => walk(resolve(root, d))).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
for (const file of runtime) {
  const src = readFileSync(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");
  assert.ok(!/createSignedUrls?\(|getPublicUrl\(/.test(src) || !src.includes(CERTIFICATE_RENDER_ASSETS_BUCKET), `${rel}: no signed/public URL for the render-asset bucket`);
  if (rel !== "lib/certificate-render-asset-policy.ts") assert.ok(!src.includes("/signatures/") && !src.includes("seals/teras-common-seal"), `${rel}: no public signature/seal path`);
  if (/^\s*["']use client["']/.test(src)) assert.ok(!src.includes("certificate-render-assets") && !src.includes("certificate-render-asset-policy"), `${rel}: client component must not import the asset loader`);
}
const wrapper = read("lib/certificate-render-assets.ts");
assert.match(wrapper, /^import "server-only";/, "loader is server-only");
assert.match(wrapper, /\.storage\.from\(CERTIFICATE_RENDER_ASSETS_BUCKET\)\.download\(objectPath\)/, "loader only downloads");
assert.match(wrapper, /profile\.is_active[\s\S]*canViewCertificate\(profile\.role\)[\s\S]*hasModuleAccess\("certificates"\)/, "loader re-checks active user, certificate view role and module access");
assert.ok(!/console\.(log|error|warn)/.test(wrapper) && !/console\./.test(read("lib/certificate-render-asset-policy.ts")), "no asset logging");
const certPdf = read("app/admin/cert-pdf/[id]/page.tsx");
assert.ok(certPdf.indexOf("inlineCertificateRenderAssets") < certPdf.indexOf("PRINT_WHEN_READY_SCRIPT }}") && /instanceof CertificateRenderAssetError\) return <CertificateAssetsUnavailable/.test(certPdf), "PDF page fails closed before the print script");
assert.match(read("app/admin/(protected)/certificates/[id]/page.tsx"), /renderAssets \? <CertificateFront data=\{\{ \.\.\.r\.data, render_assets: renderAssets \}\}/, "preview page renders only with verified assets");
assert.match(read("app/admin/(protected)/certificates/templates/TemplateForm.tsx"), /render_assets: \{ mode: "preview" \}/, "template editor preview never requests private assets");
const zip = read("app/admin/(protected)/certificates/download-zip/route.ts");
assert.ok(zip.includes("zipCertificateRenderAssets(r.config, certificateAssets)") && zip.indexOf("renderCertificateDocument({") < zip.indexOf("assetFiles.set(path, bytes)") && zip.includes('e instanceof CertificateRenderAssetError ? e.message : "render error"') && !zip.includes("e?.message"), "ZIP: shared asset files, fixed failure reasons");
pass("source: server-only loader, download only, re-authorization, no signed/public URLs, no public paths, fail-closed pages, preview isolation, fixed ZIP reasons");

// 5. The approved private artwork is not in the repository, and the Phase A migration is unchanged.
const pinned = new Set([RENDER_ASSETS["director-signature-refined-v1"].sha256, RENDER_ASSETS["common-seal-3d-34mm-v1"].sha256]);
for (const file of walk(root).filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))) {
  assert.ok(!pinned.has(createHash("sha256").update(readFileSync(file)).digest("hex")), `${relative(root, file)}: approved private artwork must not be in the repository`);
}
assert.equal(createHash("sha256").update(readFileSync(resolve(root, "supabase/migrations/20261103073927_production_certificate_render_assets_bucket.sql"))).digest("hex"), "375efef3520c8400a10b8d0bcc3f053bb0cebbb38beb8c905c005646e154488c", "approved Phase A migration unchanged");
pass("approved refined signature and 3D seal absent from the repository; Phase A migration SHA-256 unchanged");

// 6. ZIP response-size guard: small and exactly-at-limit archives are valid and allowed; one byte over is refused.
const { createZip, crc32, MAX_ZIP_RESPONSE_BYTES, suggestedZipBatchSize } = await import("../lib/zip.ts");
assert.ok(MAX_ZIP_RESPONSE_BYTES === 4_000_000 && MAX_ZIP_RESPONSE_BYTES < 4.5 * 1000 * 1000, "threshold stays below Vercel's 4.5 MB response limit");
const readZip = (buf) => {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, "central directory entry");
    const crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    assert.equal(crc32(buf.subarray(dataAt, dataAt + size)), crc, `${name}: CRC matches`);
    names.push(name);
    at += 46 + nameLen + extra + comment;
  }
  return names;
};
const certEntry = (i, bytes) => ({ name: `certificates/CERT-SYNTH-${String(i).padStart(6, "0")}.html`, data: Buffer.alloc(bytes, 0x61) });
const assetEntries = [SYNTHETIC_SIGNATURE_PNG, SYNTHETIC_SEAL_PNG].map((b) => ({ name: `certificates/${zipRenderAssetPath(sha256Hex(b))}`, data: Buffer.from(b) }));
{
  const small = createZip([certEntry(1, 37044), certEntry(2, 37044), ...assetEntries, { name: "MANIFEST.txt", data: "synthetic\n" }]);
  assert.ok(small.length <= MAX_ZIP_RESPONSE_BYTES && readZip(small).length === 5, "small ZIP allowed and intact");
  const overhead = createZip([{ name: "certificates/boundary.html", data: Buffer.alloc(0) }]).length;
  const exact = createZip([{ name: "certificates/boundary.html", data: Buffer.alloc(MAX_ZIP_RESPONSE_BYTES - overhead, 0x61) }]);
  assert.equal(exact.length, MAX_ZIP_RESPONSE_BYTES, "boundary archive built at exactly the threshold");
  assert.ok(!(exact.length > MAX_ZIP_RESPONSE_BYTES) && readZip(exact).length === 1, "archive at exactly the threshold allowed and intact");
  const over = createZip([{ name: "certificates/boundary.html", data: Buffer.alloc(MAX_ZIP_RESPONSE_BYTES - overhead + 1, 0x61) }]);
  assert.ok(over.length === MAX_ZIP_RESPONSE_BYTES + 1 && over.length > MAX_ZIP_RESPONSE_BYTES, "one byte over the threshold refused");
  // Oversized realistic batch (150 x 37 KB + all four asset sizes): the suggested batch then fits.
  const big = (n) => createZip([...Array.from({ length: n }, (_, i) => certEntry(i, 37044)), ...[15850, 416933, 49605, 290650].map((b, i) => ({ name: `certificates/assets/${String(i).repeat(64)}.png`, data: Buffer.alloc(b) })), { name: "MANIFEST.txt", data: "x".repeat(300) }]);
  const oversized = big(150);
  assert.ok(oversized.length > MAX_ZIP_RESPONSE_BYTES, "150-certificate mixed batch is over the threshold");
  const suggested = suggestedZipBatchSize(oversized.length, 150, 15850 + 416933 + 49605 + 290650);
  assert.ok(suggested >= 1 && suggested < 150 && big(suggested).length <= MAX_ZIP_RESPONSE_BYTES, `suggested batch of ${suggested} fits`);
  assert.equal(suggestedZipBatchSize(0, 0), 0);
  for (const [args, label] of [[[4_000_001, 1, 0], "single certificate"], [[NaN, 10, 0], "NaN size"], [[5e6, Infinity, 0], "infinite count"], [[5e6, 10, -1], "negative shared bytes"], [[5e6, 10, 6e6], "shared bytes over size"]]) assert.equal(suggestedZipBatchSize(...args), 0, `no suggestion: ${label}`);
  assert.ok(suggestedZipBatchSize(4_000_001, 3, 3_900_000) <= 2, "suggestion never exceeds the attempted count minus one");
  const c4Only = (n) => createZip([...Array.from({ length: n }, (_, i) => certEntry(i, 37044)), ...[49605, 290650].map((b, i) => ({ name: `certificates/assets/${String(i).repeat(64)}.png`, data: Buffer.alloc(b) })), { name: "MANIFEST.txt", data: "x".repeat(300) }]);
  const s2 = suggestedZipBatchSize(c4Only(400).length, 400, 49605 + 290650);
  assert.ok(c4Only(400).length > MAX_ZIP_RESPONSE_BYTES && c4Only(s2).length <= MAX_ZIP_RESPONSE_BYTES, `C4-only 400 -> suggested ${s2} fits`);
}
{
  const route = read("app/admin/(protected)/certificates/download-zip/route.ts");
  const guard = route.indexOf("if (zip.length > MAX_ZIP_RESPONSE_BYTES)");
  assert.ok(guard > route.indexOf("const zip = createZip(entries);"), "size checked on the final archive");
  assert.ok(guard < route.indexOf('const status = failed.length === 0 ? "success" : "partial";') && guard < route.indexOf('rpc("log_event"') && guard < route.indexOf("new NextResponse(new Uint8Array(zip)"), "guard runs before the success record, audit event and ZIP response");
  const branch = route.slice(guard, route.indexOf("// --- Record the automation run + audit ---"));
  assert.ok(branch.includes('status: "failed"') && branch.includes("success_count: 0") && branch.includes("skipped_count: renderedCount") && branch.includes("failed_count: failed.length") && branch.includes("{ status: 413") && !branch.includes("new Uint8Array(zip)"), "oversized: failed run with honest counts, 413, no archive returned");
  assert.ok(branch.includes("if (runError) console.error(") && branch.includes("{ code: runError.code }"), "oversized: a failed run record is logged (error code only)");
  assert.ok(!/assets\/|sha256|objectPath|bucket|zip_bytes}/.test(branch.slice(branch.indexOf("return new NextResponse("))), "oversized message carries counts only");
}
pass("ZIP guard: small and exactly-at-limit archives valid, one byte over refused, suggested batch fits, guard precedes success/audit/response");
