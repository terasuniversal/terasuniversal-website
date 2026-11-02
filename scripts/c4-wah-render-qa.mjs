// Synthetic WAH Golden Reference render QA through both real renderers, plus an
// Erector/Inspector pixel comparison against a baseline checkout when
// C4_BASELINE_ROOT is set. Needs PLAYWRIGHT_NODE_PATH and C4_CHROME_EXECUTABLE;
// no repo dependency is added and no database is contacted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const output = resolve(process.env.PREVIEW_OUTPUT_DIR || resolve(root, "certificate-previews/wah"));
mkdirSync(output, { recursive: true });
process.env.NODE_PATH = [process.env.PLAYWRIGHT_NODE_PATH, resolve(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const QRCode = require("qrcode");
const { chromium } = require("playwright-core");
const { getDocument } = await import(pathToFileURL(resolve(root, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);

function compile(sourceRoot, name) {
  const outDir = resolve(output, `.compiled-${name}`);
  try {
    execFileSync(process.execPath, [
      resolve(root, "node_modules/typescript/bin/tsc"), "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021", "--moduleResolution", "node",
      "--esModuleInterop", "--skipLibCheck", "--noCheck", "--rootDir", sourceRoot, "--outDir", outDir,
      resolve(sourceRoot, "components/admin/CertificateRenderer.tsx"), resolve(sourceRoot, "lib/certificate-html.ts"), resolve(sourceRoot, "lib/standard-scaffold-programmes.ts"), resolve(sourceRoot, "lib/certificate-watermark-assets.ts"),
    ], { cwd: root, stdio: "pipe" });
  } catch (error) {
    if (!existsSync(resolve(outDir, "lib/certificate-html.js"))) throw error;
  }
  return {
    publicUrl: pathToFileURL(resolve(sourceRoot, "public") + "/").href,
    renderer: require(resolve(outDir, "components/admin/CertificateRenderer.js")),
    html: require(resolve(outDir, "lib/certificate-html.js")),
    scaffold: require(resolve(outDir, "lib/standard-scaffold-programmes.js")),
    watermarks: require(resolve(outDir, "lib/certificate-watermark-assets.js")),
  };
}

const programme = readFileSync(resolve(root, "lib/working-at-height-programme.ts"), "utf8");
const listOf = (key) => [...programme.match(new RegExp(`${key}: \\[([\\s\\S]*?)\\]`))[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const objectives = programme.match(/objectives_text:\s*"([^"]+)"/)[1];
const SKILLS = [["Theory Session", "Completed"], ["Practical Training", "Completed"], ["Safety Awareness", "Completed"], ["Practical Assessment", "Passed"], ["Attendance Requirement", "Met"]].map(([area, status]) => ({ area, status }));
const qr = await QRCode.toString("https://example.test/verify/synthetic", { type: "svg", margin: 0 });
const contact = { contact_phone: "019-519 3834", contact_website: "www.terasuniversal.com.my", contact_email: "admin@terasuniversal.com.my" };
const wahConfig = {
  design_variant: "working_at_height_certificate", golden_reference_family: "working_at_height", certificate_title: "WORKING AT HEIGHT TRAINING CERTIFICATE",
  frozen_watermark_asset_family: "working-at-height", show_back_page: true, show_qr: true, show_skills_record: true, logo_url: "/teras-universal-logo.png", primary_color: "#0b3a63", accent_color: "#d4af37",
  programme_title: "Working at Height", duration_label: "2-Day Practical Training", objectives_text: objectives, coverage_items: listOf("coverage_items"), learning_outcomes: listOf("learning_outcomes"), assessment_methods: listOf("assessment_methods"), ...contact,
};
const baseData = { holder_name: "SYNTHETIC QA PARTICIPANT", course_name: "Working at Height", training_date: "2026-10-16", training_end_date: "2026-10-17", issue_date: "2026-10-20", venue: "Synthetic QA Venue, Kedah", ic_passport: "SYNTHETIC-NOT-REAL", certificate_number: "CERT-2026-000999", issuer_branch_address: "LOT 1961, JALAN TANAH MERAH, KG TANAH MERAH DALAM, 06000 JITRA, KEDAH.", qr_svg: qr, skills: SKILLS };
const LONG_NAME = "MUHAMMAD SYNTHETIC QA PARTICIPANT BIN ABDUL RAHMAN AL-HAFIZ BIN MOHAMAD ZULKARNAIN SHAH";
const LONG_VENUE = "SYNTHETIC INTERNATIONAL TRAINING AND CONVENTION CENTRE, BLOCK C LEVEL 12, LOT 1234 JALAN PERINDUSTRIAN KAWASAN PERUSAHAAN MUKIM SYNTHETIC, 06000 JITRA, KEDAH DARUL AMAN, MALAYSIA";
const LONG_ADDRESS = "SYNTHETIC BRANCH OFFICE, LOT 1961 AND LOT 1962, JALAN TANAH MERAH, KAMPUNG TANAH MERAH DALAM, MUKIM SYNTHETIC, 06000 JITRA, KEDAH DARUL AMAN, MALAYSIA.";
const wahCases = [
  { key: "wah-current", data: {} },
  { key: "wah-long-name", data: { holder_name: LONG_NAME } },
  { key: "wah-long-venue", data: { venue: LONG_VENUE } },
  { key: "wah-max-content", data: { holder_name: LONG_NAME, venue: LONG_VENUE, issuer_branch_address: LONG_ADDRESS, certificate_number: "TU-CERT-2026-WORKING-AT-HEIGHT-SUPERVISOR-QUALIFICATION-000999" } },
  { key: "wah-not-recorded", data: { skills: SKILLS.map((r, i) => (i === 4 ? r : { area: r.area, status: "Not Recorded" })) } },
];
const scaffold = (family, title, level, programmeTitle) => ({
  design_variant: "standard_scaffold_certificate", golden_reference_family: family, certificate_title: title, show_back_page: true, show_qr: true, show_skills_record: true, logo_url: "/teras-universal-logo.png", primary_color: "#0b3a63", accent_color: "#d4af37",
  ...(family === "scaffold_erector" ? { frozen_watermark_asset_family: "scaffolding-technical" } : { inspector_watermark_level: level }),
  programme_title: programmeTitle, duration_label: "2-Day Practical Training", objectives_text: "Synthetic objective text.", coverage_items: ["A", "B", "C", "D", "E", "F", "G"], learning_outcomes: ["A", "B", "C", "D", "E"], assessment_methods: ["A", "B", "C"], ...contact,
});
const regressionCases = [
  { key: "erector-basic", config: scaffold("scaffold_erector", "SCAFFOLDING TRAINING CERTIFICATE", "basic", "TERAS BASIC SCAFFOLD ERECTION PROGRAMME"), data: { course_name: "Basic Scaffolding Erector" } },
  { key: "inspector-basic", config: scaffold("scaffold_inspector", "SCAFFOLDING INSPECTION CERTIFICATE", "basic", "TERAS BASIC SCAFFOLD INSPECTION PROGRAMME"), data: { course_name: "Basic Scaffolding Inspector" } },
  { key: "professional", config: { design_variant: "professional_scaffold_erection_skills", show_back_page: true, show_qr: true, primary_color: "#0b3a63", accent_color: "#d4af37", programme_title: "TERAS Professional", objectives_text: "Synthetic objective text.", coverage_items: ["A", "B"], learning_outcomes: ["A"], assessment_methods: ["A"], ...contact }, data: {}, reactOnly: true },
  { key: "legacy-wah", config: { design_variant: "working_at_height_certificate", wah_watermark: true, show_back_page: true, show_qr: true, primary_color: "#0b3a63", accent_color: "#d4af37", logo_url: "/teras-universal-logo.png", signature_url: "/signatures/director-signature.png", ...contact, programme_title: "Working at Height", coverage_items: [], learning_outcomes: [], assessment_methods: [] }, data: {} },
];

// The real resolver, cut from certData.ts because that file needs Next's server runtime.
function loadResolver(levelOf) {
  const ts = require("typescript");
  const source = readFileSync(resolve(root, "app/admin/(protected)/certificates/certData.ts"), "utf8");
  const versions = source.match(/const GOLDEN_REFERENCE_RENDERER_VERSIONS[\s\S]*?;\r?\n/)[0];
  const fn = source.slice(source.indexOf("export function applyGoldenReferenceSnapshotConfig"), source.indexOf("async function buildCertificateSkillsRecord")).replace("export ", "");
  return new Function("levelOf", `${ts.transpile(versions + fn, { target: "es2021" })};return applyGoldenReferenceSnapshotConfig;`)(levelOf);
}
// Same shape as the live snapshots: empty lists in template_config.
const liveTemplate = (design_variant, signature_url) => ({ design_variant, signature_url, show_qr: true, show_back_page: true, show_skills_record: false, logo_url: "/teras-universal-logo.png", primary_color: "#0b3a63", accent_color: "#d4af37", skills_record: [], coverage_items: [], learning_outcomes: [], assessment_methods: [], ...contact });
const frozenFrom = (p) => ({ programme_title: p.programme_title, programme_duration: p.duration_label, objectives: p.objectives_text, coverage: p.coverage_items, outcomes: p.learning_outcomes, assessment: p.assessment_methods });
const inOrder = (text, items) => { let at = -1; for (const item of items) { const next = text.indexOf(item, at + 1); if (next < 0) return false; at = next; } return true; };

const styles = "@page{size:A4 portrait;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.cert-page{width:794px;height:1123px;margin:0;padding:0;position:relative;overflow:hidden;break-after:page;page-break-after:always}.cert-page:last-child{break-after:auto;page-break-after:auto}";
const documentOf = (front, back, publicUrl) => {
  const fix = (m) => m.replaceAll('"/certificates/', `"${publicUrl}certificates/`).replaceAll('"/signatures/', `"${publicUrl}signatures/`).replaceAll('"/teras-', `"${publicUrl}teras-`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body><section class="cert-page">${fix(front)}</section><section class="cert-page">${fix(back)}</section></body></html>`;
};
const renderBoth = (mods, data, config) => ({
  react: documentOf(renderToStaticMarkup(React.createElement(mods.renderer.CertificateFront, { data, config })), renderToStaticMarkup(React.createElement(mods.renderer.CertificateBack, { data, config })), mods.publicUrl),
  html: documentOf(mods.html.renderCertificateFront(data, config), mods.html.renderCertificateBack(data, config), mods.publicUrl),
});

// Runs in the page: every text line's box, then clipping and overlap per page.
const inspectLayout = () => {
  const issues = [];
  const pages = [...document.querySelectorAll(".cert-page")];
  pages.forEach((page, pageIndex) => {
    const pageBox = page.getBoundingClientRect();
    const lines = [];
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) lines.push({ text: node.textContent.trim().slice(0, 40), l: r.left - pageBox.left, r: r.right - pageBox.left, t: r.top - pageBox.top, b: r.bottom - pageBox.top });
    }
    for (const a of lines) if (a.l < 13 || a.r > 781 || a.t < 13 || a.b > 1110) issues.push(`p${pageIndex + 1} outside frame: "${a.text}" [${a.l.toFixed(0)},${a.t.toFixed(0)},${a.r.toFixed(0)},${a.b.toFixed(0)}]`);
    for (let i = 0; i < lines.length; i += 1) for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i], b = lines[j];
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w > 1.5 && h > 3.5) issues.push(`p${pageIndex + 1} overlap: "${a.text}" / "${b.text}" (${w.toFixed(1)}x${h.toFixed(1)})`);
    }
    // The tagline footer is the page's last text; body text must clear it.
    const footer = lines.find((l) => l.t > 1070);
    if (footer) for (const a of lines) if (a !== footer && a.t < footer.t && a.b > footer.t - 4) issues.push(`p${pageIndex + 1} footer clearance: "${a.text}"`);
    const lowest = Math.max(...lines.filter((l) => l !== footer).map((l) => l.b));
    const wm = [...page.querySelectorAll('img[aria-hidden="true"]')].map((im) => { const r = im.getBoundingClientRect(); return { src: im.getAttribute("src").split("/").pop(), natural: im.naturalWidth, t: r.top - pageBox.top, b: r.bottom - pageBox.top, l: r.left - pageBox.left, r: r.right - pageBox.left }; });
    const broken = [...page.querySelectorAll("img")].filter((im) => !im.naturalWidth).map((im) => im.getAttribute("src"));
    for (const src of broken) issues.push(`p${pageIndex + 1} broken image: ${src}`);
    const hits = wm.flatMap((w) => lines.filter((a) => Math.min(a.r, w.r) - Math.max(a.l, w.l) > 1 && Math.min(a.b, w.b) - Math.max(a.t, w.t) > 1).map((a) => a.text));
    window.__report = window.__report || [];
    window.__report.push({ page: pageIndex + 1, lowestText: Math.round(lowest), footerTop: footer ? Math.round(footer.t) : null, watermark: wm.map((w) => w.src), textUnderWatermark: [...new Set(hits)].length });
  });
  return { issues, report: window.__report, text: document.body.innerText, tops: [...document.querySelectorAll("li, td, h1, p")].map((e) => e.getBoundingClientRect().top) };
};

const context = await chromium.launchPersistentContext(resolve(output, ".profile"), { executablePath: process.env.C4_CHROME_EXECUTABLE, headless: true, viewport: { width: 794, height: 2246 }, args: ["--allow-file-access-from-files", "--no-first-run"] });
async function capture(html, key) {
  const path = resolve(output, `${key}.html`);
  writeFileSync(path, html);
  const page = await context.newPage();
  await page.goto(pathToFileURL(path).href, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  const layout = await page.evaluate(inspectLayout);
  const shot = await page.screenshot({ fullPage: true, path: resolve(output, `${key}.png`) });
  const pdf = await page.pdf({ path: resolve(output, `${key}.pdf`), format: "A4", preferCSSPageSize: true, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  await page.close();
  const doc = await getDocument({ data: new Uint8Array(pdf), disableWorker: true, verbosity: 0 }).promise;
  return { ...layout, pdfPages: doc.numPages, shot: createHash("sha256").update(shot).digest("hex") };
}

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures += 1; };
try {
  const current = compile(root, "current");
  for (const c of wahCases) {
    const data = { ...baseData, ...c.data };
    const { react, html } = renderBoth(current, data, wahConfig);
    const r = await capture(react, `${c.key}-react`);
    const h = await capture(html, `${c.key}-html`);
    console.log(`  ${c.key} react ${JSON.stringify(r.report)}`);
    for (const [name, res] of [["react", r], ["html", h]]) {
      check(res.pdfPages === 2, `${c.key} ${name}: exactly two A4 pages (${res.pdfPages})`);
      check(res.issues.length === 0, `${c.key} ${name}: no clipping/overlap${res.issues.length ? `\n    ${res.issues.slice(0, 12).join("\n    ")}` : ""}`);
      for (const item of [...wahConfig.coverage_items, ...wahConfig.learning_outcomes, ...wahConfig.assessment_methods]) {
        if (!res.text.includes(item)) check(false, `${c.key} ${name}: missing "${item}"`);
      }
      check(res.text.includes("WORKING AT HEIGHT TRAINING CERTIFICATE") && res.text.includes("2-Day Practical Training"), `${c.key} ${name}: title and 2-day duration present`);
      check(res.report.some((p) => p.watermark.includes("wah-scene.png")) && res.report.some((p) => p.watermark.includes("wah-detail.png")), `${c.key} ${name}: page-specific WAH watermarks`);
    }
    check(r.text.replace(/\s+/g, " ") === h.text.replace(/\s+/g, " "), `${c.key}: React and bulk-ZIP text identical`);
    const drift = r.tops.length === h.tops.length ? Math.max(...r.tops.map((t, i) => Math.abs(t - h.tops[i]))) : Infinity;
    check(drift <= 12, `${c.key}: React and bulk-ZIP layout within 12px (max drift ${drift.toFixed(1)}px)`);
  }
  const applyFrozen = loadResolver(current.watermarks.levelOf);
  const migrationSql = read("supabase/migrations/20261101124601_production_inspector_c4_snapshot_dispatch.sql");
  const scaffoldFamilies = [["basic_erection", "scaffold_erector", "c4_wave1_v1"], ["intermediate_erection", "scaffold_erector", "c4_wave1_v1"], ["advanced_erection", "scaffold_erector", "c4_wave1_v1"], ["basic_inspection", "scaffold_inspector", "c4_wave1_inspector_v1"], ["intermediate_inspection", "scaffold_inspector", "c4_wave1_inspector_v1"], ["advanced_inspection", "scaffold_inspector", "c4_wave1_inspector_v1"]];
  const liveCases = scaffoldFamilies.map(([key, family, version]) => {
    const p = current.scaffold.standardScaffoldProgrammes[key];
    for (const text of [...p.coverage_items, ...p.learning_outcomes, ...p.assessment_methods]) assert.ok(migrationSql.includes(`'${text.replace(/'/g, "''")}'`), `fixture differs from frozen migration content: ${text}`);
    const level = key.split("_")[0];
    const facts = family === "scaffold_erector"
      ? { certificate_title: "SCAFFOLDING TRAINING CERTIFICATE", watermark_asset_family: "scaffolding-technical" }
      : { certificate_title: "SCAFFOLDING INSPECTION CERTIFICATE", inspector_watermark_level: level };
    return { key: `live-shape-${key}`, version, template: liveTemplate("standard_scaffold_certificate", "/signatures/director-signature-v2.png"), payload: { certificate_family: family, ...facts, programme_content: frozenFrom(p) }, data: { course_name: key }, sizes: [7, 5, 3] };
  });
  const wahFrozen = { programme_title: "Working at Height", programme_duration: "2-Day Practical Training", objectives, coverage: wahConfig.coverage_items, outcomes: wahConfig.learning_outcomes, assessment: wahConfig.assessment_methods };
  liveCases.push(...wahCases.slice(0, 4).map((c) => ({ key: `live-shape-${c.key}`, version: "c4_wave1_wah_v1", template: liveTemplate("working_at_height_certificate", "/signatures/director-signature.png"), payload: { certificate_family: "working_at_height", certificate_title: "WORKING AT HEIGHT TRAINING CERTIFICATE", watermark_asset_family: "working-at-height", programme_content: wahFrozen }, data: c.data, sizes: [9, 6, 5] })));
  for (const c of liveCases) {
    const config = { ...c.template };
    applyFrozen(config, c.version, c.payload);
    const content = c.payload.programme_content;
    check([content.coverage.length, content.outcomes.length, content.assessment.length].join() === c.sizes.join(), `${c.key}: frozen counts ${c.sizes.join("/")}`);
    const data = { ...baseData, ...c.data };
    const docs = renderBoth(current, data, config);
    const results = {};
    for (const kind of ["react", "html"]) {
      const res = await capture(docs[kind], `${c.key}-${kind}`);
      results[kind] = res;
      check(res.pdfPages === 2, `${c.key} ${kind}: exactly two A4 pages (${res.pdfPages})`);
      check(res.issues.length === 0, `${c.key} ${kind}: no clipping/overlap${res.issues.length ? `\n    ${res.issues.slice(0, 12).join("\n    ")}` : ""}`);
      check(["PROGRAMME COVERAGE", "LEARNING OUTCOMES", "ASSESSMENT METHOD", "PARTICIPANT SKILLS RECORD", "QR VERIFICATION"].every((t) => res.text.toUpperCase().includes(t)) && res.text.includes("JITRA"), `${c.key} ${kind}: sections, Skills Record, QR and branch address present`);
      check(inOrder(res.text, content.coverage) && inOrder(res.text, content.outcomes) && inOrder(res.text, content.assessment), `${c.key} ${kind}: every item shown in frozen order`);
      check(!res.issues.length, `${c.key} ${kind}: textUnderWatermark ${JSON.stringify(res.report.map((p) => p.textUnderWatermark))} lowest ${JSON.stringify(res.report.map((p) => p.lowestText))} wm ${JSON.stringify(res.report.map((p) => p.watermark))}`);
    }
    const drift = results.react.tops.length === results.html.tops.length ? Math.max(...results.react.tops.map((t, i) => Math.abs(t - results.html.tops[i]))) : Infinity;
    check(results.react.text.replace(/\s+/g, " ") === results.html.text.replace(/\s+/g, " ") && drift <= 12, `${c.key}: React and bulk-ZIP same text, drift ${drift.toFixed(1)}px`);
  }
  if (process.env.C4_BASELINE_ROOT) {
    const baseline = compile(resolve(process.env.C4_BASELINE_ROOT), "baseline");
    for (const c of regressionCases) {
      const data = { ...baseData, ...c.data };
      const now = renderBoth(current, data, c.config);
      const was = renderBoth(baseline, data, c.config);
      for (const kind of c.reactOnly ? ["react"] : ["react", "html"]) {
        const a = await capture(now[kind], `${c.key}-${kind}-current`);
        const b = await capture(was[kind], `${c.key}-${kind}-baseline`);
        check(a.shot === b.shot, `${c.key} ${kind}: pixel-identical to baseline ${b.shot.slice(0, 12)}`);
      }
    }
  }
} finally {
  await context.close();
}
assert.equal(failures, 0, `${failures} render QA check(s) failed`);
console.log("WATERMARK_ARTWORK: owner visually approved; independent competent-person safety verification not established");
