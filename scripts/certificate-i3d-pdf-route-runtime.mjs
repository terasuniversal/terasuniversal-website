import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire, Module } from "node:module";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import QRCode from "qrcode";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixtureDir = resolve(repoRoot, "node_modules/.cache/certificate-i3d-pdf-route");
const compiledDir = join(fixtureDir, "compiled");
const publicRoot = pathToFileURL(resolve(repoRoot, "public")).href;
const routeSource = readFileSync(resolve(repoRoot, "app/admin/cert-pdf/[id]/page.tsx"), "utf8");
const routeStyleStart = routeSource.indexOf("<style>{`") + "<style>{`".length;
const routeStyleEnd = routeSource.indexOf("`}</style>", routeStyleStart);
assert.ok(routeStyleStart >= "<style>{`".length && routeStyleEnd > routeStyleStart, "PDF route print styles must be extractable for runtime QA");
const routePrintCss = routeSource.slice(routeStyleStart, routeStyleEnd);

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function rewriteAssets(html) {
  return html
    .replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`)
    .replaceAll('src="/signatures/director-signature.png', `src="${publicRoot}/signatures/director-signature.png`)
    .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${publicRoot}/certificates/seals/teras-common-seal.png`)
    .replaceAll('src="/certificates/template-a/', `src="${publicRoot}/certificates/template-a/`);
}

function printableRoute(front, back, includeShellPrintFix = true) {
  const css = includeShellPrintFix
    ? routePrintCss
    : routePrintCss
      .replace(/\.cert-pdf-shell\s*\{[^}]*\}/, "")
      .replace(/\.cert-pdf-wrap\s*\{[^}]*\}/, "");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="cert-pdf-shell" style="background:#eef1f6;min-height:100vh;padding:20px"><div class="cert-pdf-wrap" style="display:grid;gap:20px"><div class="cert-pdf-page">${front}</div><div class="cert-pdf-page">${back}</div></div></div></body></html>`;
}

function textOf(content) {
  return content.items.map((item) => item.str ?? "").join(" ");
}

async function main() {
  mkdirSync(fixtureDir, { recursive: true });
  try {
    execFileSync(process.execPath, [
      resolve(repoRoot, "node_modules/typescript/bin/tsc"),
      "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021",
      "--moduleResolution", "node", "--esModuleInterop", "--skipLibCheck",
      "--rootDir", repoRoot, "--outDir", compiledDir,
      resolve(repoRoot, "components/admin/CertificateRenderer.tsx"),
      resolve(repoRoot, "lib/certificate-skills.ts"),
    ], { cwd: repoRoot, stdio: "inherit" });

    process.env.NODE_PATH = [resolve(repoRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter);
    Module._initPaths();
    const require = createRequire(import.meta.url);
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const { CertificateFront, CertificateBack } = require(resolve(compiledDir, "components/admin/CertificateRenderer.js"));
    const data = {
      certificate_number: "SYNTH-I3D-2026-000001",
      holder_name: "I3D Synthetic Holder",
      course_name: "I3D Synthetic Certificate QA",
      programme_duration: "2 DAYS",
      training_date: "2026-09-08",
      training_end_date: "2026-09-09",
      issue_date: "2026-09-09",
      venue: "Synthetic QA Centre",
      participant_id: "SYNTH-I3D-001",
      skills: [],
      verification_url: "https://example.invalid/verify/SYNTH-I3D-2026-000001",
      qr_svg: await QRCode.toString("https://example.invalid/verify/SYNTH-I3D-2026-000001", { type: "svg", margin: 1 }),
    };
    const config = {
      design_variant: "standard_scaffold_certificate",
      show_back_page: true,
      show_qr: true,
      show_skills_record: false,
      certificate_title: "SYNTHETIC CERTIFICATE",
      objectives_text: "Synthetic Page 2 training objective.",
      coverage_items: ["Synthetic training coverage."],
      learning_outcomes: ["Synthetic assessment outcome."],
      assessment_methods: ["Synthetic assessment method."],
      logo_url: `${publicRoot}/certificates/template-a/teras-symbol-v2.png`,
    };
    const front = rewriteAssets(renderToStaticMarkup(React.createElement(CertificateFront, { data, config })));
    const back = rewriteAssets(renderToStaticMarkup(React.createElement(CertificateBack, { data, config })));
    assert.ok(!front.includes("QR VERIFICATION") && !front.includes(data.qr_svg), "Page 1 must not contain QR content");
    assert.ok(back.includes("QR VERIFICATION") && back.includes(data.qr_svg), "Page 2 must contain its verification QR");

    const edge = findEdge();
    assert.ok(edge, "Microsoft Edge is required for route-level PDF page-count QA");
    const pdfPath = join(fixtureDir, "certificate-route.pdf");
    writeFileSync(join(fixtureDir, "certificate-route.html"), printableRoute(front, back), "utf8");
    execFileSync(edge, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(join(fixtureDir, "certificate-route.html")).href], { cwd: repoRoot, stdio: "ignore", timeout: 120_000 });

    const pdfjs = await import(pathToFileURL(resolve(repoRoot, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), disableWorker: true }).promise;
    assert.equal(pdf.numPages, 2, "the certificate PDF route must print exactly two pages");
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      assert.ok(Math.abs(width - 595.28) < 1.5 && Math.abs(height - 841.89) < 1.5, `page ${index} must be A4 portrait`);
      const content = await page.getTextContent();
      const text = textOf(content);
      for (const item of content.items) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const x = item.transform[4] - x0;
        const y = item.transform[5] - y0;
        assert.ok(x >= -1 && x + item.width <= width + 2, `horizontal text overflow on page ${index}`);
        assert.ok(y >= -2 && y + item.height <= height + 2, `vertical text overflow on page ${index}`);
      }
      pages.push(text);
    }
    assert.ok(pages[0].includes(data.certificate_number), "Page 1 must contain the certificate identity");
    assert.ok(!pages[0].includes("QR VERIFICATION"), "Page 1 must not contain the QR label");
    assert.ok(pages[1].includes("Synthetic Page 2 training objective."), "Page 2 must contain training content");

    const noQrConfig = { ...config, show_qr: false };
    const noQrBack = rewriteAssets(renderToStaticMarkup(React.createElement(CertificateBack, { data, config: noQrConfig })));
    writeFileSync(join(fixtureDir, "certificate-route-no-qr.html"), printableRoute(front, noQrBack), "utf8");
    const noQrPdfPath = join(fixtureDir, "certificate-route-no-qr.pdf");
    execFileSync(edge, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${noQrPdfPath}`, pathToFileURL(join(fixtureDir, "certificate-route-no-qr.html")).href], { cwd: repoRoot, stdio: "ignore", timeout: 120_000 });
    const noQrPdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(noQrPdfPath)), disableWorker: true }).promise;
    assert.equal(noQrPdf.numPages, 2, "hiding QR must not add or remove a page");
    assert.equal(pages[0], textOf(await (await noQrPdf.getPage(1)).getTextContent()), "QR visibility must not change Page 1");
    assert.ok(readFileSync(pdfPath).length > readFileSync(noQrPdfPath).length + 250, "Page 2 must include QR vector content in the PDF");

    const defectiveHtmlPath = join(fixtureDir, "certificate-route-before-offset-fix.html");
    const defectivePdfPath = join(fixtureDir, "certificate-route-before-offset-fix.pdf");
    writeFileSync(defectiveHtmlPath, printableRoute(front, back, false), "utf8");
    execFileSync(edge, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${defectivePdfPath}`, pathToFileURL(defectiveHtmlPath).href], { cwd: repoRoot, stdio: "ignore", timeout: 120_000 });
    const defectivePdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(defectivePdfPath)), disableWorker: true }).promise;

    console.log(`I3D React certificate route PDF: A4 portrait, exactly 2 pages, Page-2-only QR graphics, no blank page, no text overflow: PASS; synthetic fixture with old 20px offsets: ${defectivePdf.numPages} pages`);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

await main();
