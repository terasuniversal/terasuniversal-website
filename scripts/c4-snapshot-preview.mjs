// Generates one synthetic Golden Reference PDF (Erector, c4_wave1_v1 shaped
// data) via the isolated Playwright/Chromium already set up earlier this
// session (PLAYWRIGHT_NODE_PATH / C4_CHROME_EXECUTABLE), to feed
// c4-snapshot-preview-contract.mjs's PDF assertions. No new dependency is
// installed; reuses the existing isolated install exactly as the prior C4
// worktree's scripts did.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import Module, { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.PREVIEW_OUTPUT_DIR || resolve(root, "certificate-previews"));
const scratch = process.env.TMPDIR || resolve(root, "..", "_qa_scratch");
mkdirSync(scratch, { recursive: true });
const runDir = resolve(scratch, `teras-c4-snapshot-preview-${Date.now()}`);
const compileDir = resolve(runDir, ".compiled");
mkdirSync(output, { recursive: true });
mkdirSync(runDir, { recursive: true });

execFileSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021",
  "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
  "--rootDir", root, "--outDir", compileDir,
  resolve(root, "components/admin/CertificateRenderer.tsx"),
  resolve(root, "lib/certificate-format.ts"),
  resolve(root, "lib/certificate-design-system.ts"),
  resolve(root, "lib/certificate-watermark-assets.ts"),
  resolve(root, "lib/certificate-approval-assets.ts"),
  resolve(root, "lib/teras-company.ts"),
], { cwd: root, stdio: "inherit" });

process.env.NODE_PATH = [process.env.PLAYWRIGHT_NODE_PATH, resolve(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { CertificateFront, CertificateBack } = require(resolve(compileDir, "components/admin/CertificateRenderer.js"));
const { chromium } = require("playwright-core");

const publicUrl = pathToFileURL(resolve(root, "public") + "/").href;
const config = {
  design_variant: "standard_scaffold_certificate",
  golden_reference_family: "scaffold_erector",
  certificate_title: "SCAFFOLDING TRAINING CERTIFICATE",
  programme_title: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME",
  duration_label: "10-Day Practical Training",
  objectives_text: "Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures.",
  coverage_items: ["Scaffolding Components & Terminology", "Workplace Hazard Identification"],
  learning_outcomes: ["Identify scaffolding components and terminology correctly"],
  assessment_methods: ["Theory Assessment", "Practical Assessment"],
  frozen_watermark_asset_family: "scaffolding-technical",
  show_back_page: true,
  show_qr: true,
  show_skills_record: true,
  logo_url: `${publicUrl}certificates/template-a/teras-symbol-v2.png`,
  primary_color: "#0B3A63",
  accent_color: "#D4AF37",
};
const data = {
  certificate_number: "TU-CERT-2026-ERECTOR-SNAPSHOT-000123",
  holder_name: "SYNTHETIC QA PARTICIPANT",
  course_name: "BASIC SCAFFOLDING ERECTOR",
  training_date: "2026-09-01",
  training_end_date: "2026-09-10",
  issue_date: "2026-09-10",
  venue: "Synthetic QA Venue",
  ic_passport: "SYNTHETIC-NOT-REAL",
  issuer_branch_address: "LOT 1961, JALAN TANAH MERAH, KG TANAH MERAH DALAM, 06000 JITRA, KEDAH.",
  qr_svg: '<svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg"><rect width="29" height="29" fill="white"/><rect x="2" y="2" width="8" height="8" fill="#0b1f3a"/><rect x="19" y="2" width="8" height="8" fill="#0b1f3a"/><rect x="2" y="19" width="8" height="8" fill="#0b1f3a"/></svg>',
  skills: [
    { area: "Theory Session", status: "Completed" },
    { area: "Practical Training", status: "Completed" },
    { area: "Safety Awareness", status: "Completed" },
    { area: "Practical Assessment", status: "Passed" },
    { area: "Attendance Requirement", status: "Met" },
  ],
};

const styles = `@page{size:A4 portrait;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.cert-page{width:794px;height:1123px;margin:0;padding:0;position:relative;overflow:hidden;break-after:page;page-break-after:always}.cert-page:last-child{break-after:auto;page-break-after:auto}`;
const front = renderToStaticMarkup(React.createElement(CertificateFront, { data, config }));
const back = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
// The app emits site-root-relative URLs (e.g. /certificates/watermarks/...),
// correct for an actual HTTP origin (Next.js serving public/) but not
// resolvable when this script loads the HTML directly via file://. Rewrite
// to the checked-out public/ directory for this local-only preview, same
// pattern already used by scripts/c4-watermark-source-proof.mjs.
const rewritePublicPaths = (markup) => markup.replaceAll('"/certificates/', `"${publicUrl}certificates/`);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${styles}</style></head><body><section class="cert-page">${rewritePublicPaths(front)}</section><section class="cert-page">${rewritePublicPaths(back)}</section></body></html>`;
const htmlPath = resolve(runDir, "erector-snapshot.html");
writeFileSync(htmlPath, html, "utf8");

const browserContext = await chromium.launchPersistentContext(resolve(runDir, "profile"), {
  ...(process.env.C4_CHROME_EXECUTABLE ? { executablePath: process.env.C4_CHROME_EXECUTABLE } : {}),
  headless: true,
  viewport: { width: 1200, height: 1600 },
  args: ["--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
});
try {
  const page = await browserContext.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: resolve(output, "erector-snapshot.pdf"),
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    scale: 1,
  });
} finally {
  await browserContext.close();
}
assert.ok(true);
console.log(`generated ${resolve(output, "erector-snapshot.pdf")}`);
