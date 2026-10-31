// Generates synthetic Golden Reference PDFs (Erector Basic/Intermediate/
// Advanced, c4_wave1_v1 shaped data) via the isolated Playwright/Chromium
// already set up earlier this session (PLAYWRIGHT_NODE_PATH /
// C4_CHROME_EXECUTABLE), to feed c4-snapshot-preview-contract.mjs's PDF
// assertions. No new dependency is installed; reuses the existing isolated
// install exactly as the prior C4 worktree's scripts did.
//
// Verification/contact fields are fully populated (certificate number,
// contact phone, website, email, and the full issuing branch address) --
// matching the real staging template's 5-item grid, not a simplified
// 2-item fixture -- so the Page 2 address/footer layout is tested against
// the actual worst case, not an easier one.
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
  // Compiled too, for the HTML/Bulk-ZIP render path check below (Task 3:
  // "Test both React and HTML/Bulk ZIP render paths where supported") --
  // this is the exact string renderer app/.../download-zip/route.ts uses,
  // not a separate reimplementation.
  resolve(root, "lib/certificate-html.ts"),
], { cwd: root, stdio: "inherit" });

process.env.NODE_PATH = [process.env.PLAYWRIGHT_NODE_PATH, resolve(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { CertificateFront, CertificateBack } = require(resolve(compileDir, "components/admin/CertificateRenderer.js"));
const { renderCertificateFront: renderHtmlFront, renderCertificateBack: renderHtmlBack } = require(resolve(compileDir, "lib/certificate-html.js"));
const { chromium } = require("playwright-core");

const publicUrl = pathToFileURL(resolve(root, "public") + "/").href;

// Approved, owner-confirmed address -- same value used throughout this
// session's QA, not fabricated here.
const ISSUER_ADDRESS = "LOT 1961, JALAN TANAH MERAH, KG TANAH MERAH DALAM, 06000 JITRA, KEDAH.";
const COMMON_CONTACT = {
  contact_phone: "+604-917 1961",
  contact_website: "www.terasuniversal.com.my",
  contact_email: "info@terasuniversal.com.my",
};

const baseConfig = {
  design_variant: "standard_scaffold_certificate",
  golden_reference_family: "scaffold_erector",
  certificate_title: "SCAFFOLDING TRAINING CERTIFICATE",
  frozen_watermark_asset_family: "scaffolding-technical",
  show_back_page: true,
  show_qr: true,
  show_skills_record: true,
  logo_url: `${publicUrl}certificates/template-a/teras-symbol-v2.png`,
  primary_color: "#0B3A63",
  accent_color: "#D4AF37",
  ...COMMON_CONTACT,
};

const baseData = {
  holder_name: "SYNTHETIC QA PARTICIPANT",
  training_date: "2026-09-01",
  training_end_date: "2026-09-10",
  issue_date: "2026-09-10",
  venue: "Synthetic QA Venue",
  ic_passport: "SYNTHETIC-NOT-REAL",
  issuer_branch_address: ISSUER_ADDRESS,
  qr_svg: '<svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg"><rect width="29" height="29" fill="white"/><rect x="2" y="2" width="8" height="8" fill="#0b1f3a"/><rect x="19" y="2" width="8" height="8" fill="#0b1f3a"/><rect x="2" y="19" width="8" height="8" fill="#0b1f3a"/></svg>',
  skills: [
    { area: "Theory Session", status: "Completed" },
    { area: "Practical Training", status: "Completed" },
    { area: "Safety Awareness", status: "Completed" },
    { area: "Practical Assessment", status: "Passed" },
    { area: "Attendance Requirement", status: "Met" },
  ],
};

// Content below is copied verbatim from lib/standard-scaffold-programmes.ts's
// basic_erection/intermediate_erection/advanced_erection entries (the real,
// "verified" / content_status catalog content, sourced from
// data/courseCatalog.js) -- not a shortened placeholder. The prior revision
// of this fixture used 2-4 item coverage/outcome lists where the real
// catalog has 7 and 5 respectively; that under-stressed the Page 2 middle
// block and is why a passing local QA run did not predict the real
// Verification/footer overlap the owner found on actual staging PDFs.
const levels = [
  {
    key: "erector-basic",
    name: "BASIC SCAFFOLDING ERECTOR",
    certificateNumber: "TU-CERT-2026-ERECTOR-BASIC-000123",
    config: {
      programme_title: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME",
      duration_label: "10-Day Practical Training",
      objectives_text: "Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures in accordance with industry standards and workplace safety requirements.",
      coverage_items: [
        "Scaffolding Components & Terminology",
        "Workplace Hazard Identification",
        "Personal Protective Equipment (PPE)",
        "Safe Scaffold Erection & Dismantling",
        "Pre-Use Component Inspection",
        "Safety Procedures & Best Practices",
        "Teamwork in Scaffolding Operations",
      ],
      learning_outcomes: [
        "Identify scaffolding components and terminology correctly",
        "Recognise and control common workplace hazards",
        "Select and use PPE correctly",
        "Erect and dismantle basic scaffold structures safely",
        "Carry out a pre-use inspection of scaffold components",
      ],
      assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    },
  },
  {
    key: "erector-intermediate",
    name: "INTERMEDIATE SCAFFOLDING ERECTOR",
    // Representative long certificate number, to stress-test alongside the
    // full-width address change rather than testing each in isolation.
    certificateNumber: "TU-CERT-2026-INTERMEDIATE-SCAFFOLDING-ERECTOR-000124",
    config: {
      programme_title: "TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME",
      duration_label: "10-Day Practical Training",
      objectives_text: "Further develops the knowledge, technical skills and practical competency of scaffolders who have completed Basic Scaffold Erection, for greater responsibilities in construction, maintenance, petrochemical and Oil & Gas operations.",
      coverage_items: [
        "Work Planning & Organisation",
        "Reading Scaffold Drawings & Instructions",
        "Erecting Complex Scaffold Structures",
        "Hazard Identification & Control Measures",
        "Inspecting Completed Structures",
        "Safe Supervision Practices",
        "Industry Standards & Regulatory Requirements",
      ],
      learning_outcomes: [
        "Plan scaffolding work activities safely",
        "Interpret scaffold drawings and work instructions",
        "Erect, modify and dismantle more complex scaffold structures",
        "Identify hazards and apply effective control measures",
        "Conduct inspections on completed scaffold structures",
      ],
      assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    },
  },
  {
    key: "erector-advanced",
    name: "ADVANCED SCAFFOLDING ERECTOR",
    certificateNumber: "TU-CERT-2026-ERECTOR-ADVANCED-000125",
    config: {
      programme_title: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME",
      duration_label: "10-Day Practical Training",
      objectives_text: "Designed for experienced scaffolders who wish to further enhance their technical expertise and leadership capabilities in complex scaffolding operations, covering advanced planning, supervision, structural stability, inspection and risk management.",
      coverage_items: [
        "Planning Complex Scaffolding Operations",
        "Team Supervision & Safety",
        "Advanced Drawings & Specifications",
        "Scaffold Stability Evaluation",
        "Comprehensive Inspection & Corrective Action",
        "Risk Management & Compliance",
        "Leadership & Communication",
      ],
      learning_outcomes: [
        "Plan and coordinate complex scaffolding operations",
        "Supervise scaffolding teams effectively and safely",
        "Evaluate scaffold stability and identify structural hazards",
        "Conduct comprehensive scaffold inspections",
        "Apply risk management strategies and regulatory requirements",
      ],
      assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    },
  },
  {
    key: "erector-long-number-stress",
    name: "ADVANCED SCAFFOLDING ERECTOR",
    // Deliberately longer than the intermediate level's already-long number,
    // isolating certificate-number length from programme-content length as
    // a separate stress dimension (Task 3's explicit "long certificate
    // number stress case"), reusing the Advanced level's real (longest)
    // content so both stresses combine in one fixture.
    certificateNumber: "TU-CERT-2026-ADVANCED-SCAFFOLDING-ERECTOR-SUPERVISOR-QUALIFICATION-000999",
    config: {
      programme_title: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME",
      duration_label: "10-Day Practical Training",
      objectives_text: "Designed for experienced scaffolders who wish to further enhance their technical expertise and leadership capabilities in complex scaffolding operations, covering advanced planning, supervision, structural stability, inspection and risk management.",
      coverage_items: [
        "Planning Complex Scaffolding Operations",
        "Team Supervision & Safety",
        "Advanced Drawings & Specifications",
        "Scaffold Stability Evaluation",
        "Comprehensive Inspection & Corrective Action",
        "Risk Management & Compliance",
        "Leadership & Communication",
      ],
      learning_outcomes: [
        "Plan and coordinate complex scaffolding operations",
        "Supervise scaffolding teams effectively and safely",
        "Evaluate scaffold stability and identify structural hazards",
        "Conduct comprehensive scaffold inspections",
        "Apply risk management strategies and regulatory requirements",
      ],
      assessment_methods: ["Theory Assessment", "Practical Assessment", "Continuous Trainer Evaluation"],
    },
  },
];

const styles = `@page{size:A4 portrait;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.cert-page{width:794px;height:1123px;margin:0;padding:0;position:relative;overflow:hidden;break-after:page;page-break-after:always}.cert-page:last-child{break-after:auto;page-break-after:auto}`;
// The app emits site-root-relative URLs (e.g. /certificates/watermarks/...),
// correct for an actual HTTP origin (Next.js serving public/) but not
// resolvable when this script loads the HTML directly via file://. Rewrite
// to the checked-out public/ directory for this local-only preview, same
// pattern already used by scripts/c4-watermark-source-proof.mjs.
const rewritePublicPaths = (markup) => markup.replaceAll('"/certificates/', `"${publicUrl}certificates/`);

const browserContext = await chromium.launchPersistentContext(resolve(runDir, "profile"), {
  ...(process.env.C4_CHROME_EXECUTABLE ? { executablePath: process.env.C4_CHROME_EXECUTABLE } : {}),
  headless: true,
  viewport: { width: 1200, height: 1600 },
  args: ["--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
});
try {
  for (const level of levels) {
    const config = { ...baseConfig, ...level.config };
    const data = { ...baseData, certificate_number: level.certificateNumber, course_name: level.name };
    const front = renderToStaticMarkup(React.createElement(CertificateFront, { data, config }));
    const back = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${styles}</style></head><body><section class="cert-page">${rewritePublicPaths(front)}</section><section class="cert-page">${rewritePublicPaths(back)}</section></body></html>`;
    const htmlPath = resolve(runDir, `${level.key}.html`);
    writeFileSync(htmlPath, html, "utf8");

    const page = await browserContext.newPage();
    try {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: resolve(output, `${level.key}.pdf`),
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        scale: 1,
      });
    } finally {
      await page.close();
    }
    console.log(`generated ${resolve(output, `${level.key}.pdf`)}`);

    // HTML/Bulk-ZIP render path (lib/certificate-html.ts, the string
    // renderer app/.../certificates/download-zip/route.ts actually uses --
    // not a reimplementation) -- Task 3 explicitly requires both the React
    // and HTML paths be exercised, not just the React admin preview path.
    const htmlFront = renderHtmlFront(data, config);
    const htmlBack = renderHtmlBack(data, config);
    const htmlDoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${styles}</style></head><body><section class="cert-page">${rewritePublicPaths(htmlFront)}</section><section class="cert-page">${rewritePublicPaths(htmlBack)}</section></body></html>`;
    const htmlDocPath = resolve(runDir, `${level.key}-html.html`);
    writeFileSync(htmlDocPath, htmlDoc, "utf8");

    const htmlPage = await browserContext.newPage();
    try {
      await htmlPage.goto(pathToFileURL(htmlDocPath).href, { waitUntil: "load" });
      await htmlPage.emulateMedia({ media: "print" });
      await htmlPage.pdf({
        path: resolve(output, `${level.key}-html.pdf`),
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        scale: 1,
      });
    } finally {
      await htmlPage.close();
    }
    console.log(`generated ${resolve(output, `${level.key}-html.pdf`)}`);
  }
} finally {
  await browserContext.close();
}
assert.ok(true);
