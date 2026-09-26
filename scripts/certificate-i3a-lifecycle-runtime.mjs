import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire, Module } from "node:module";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixtureDir = resolve(repoRoot, "node_modules/.cache/i3a-issued-lifecycle");
const compiledDir = join(fixtureDir, "compiled");
const containerName = process.env.I3A_POSTGRES_CONTAINER ?? "teras-i3a-lifecycle-force-rls";
const databaseUser = process.env.I3A_POSTGRES_USER ?? "i3_bootstrap";
const sqlFile = resolve(repoRoot, "supabase/tests/certificate_i3a_lifecycle_runtime_contract.sql");
const sql = readFileSync(sqlFile, "utf8");

function loadIssuedFixture() {
  const run = spawnSync("docker", [
    "exec", "-i", containerName, "psql", "-U", databaseUser, "-d", "postgres",
    "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "render_fixture=1",
  ], { cwd: repoRoot, input: sql, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) {
    throw new Error(`Disposable PostgreSQL lifecycle contract failed (exit ${run.status}): ${(run.stderr || "").trim()}`);
  }
  const errorProbeNotices = (run.stderr || "").split(/\r?\n/).filter((line) => line.includes("I3C server-side"));
  assert.ok(errorProbeNotices.some((line) => line.includes("P0001") && line.includes("Invalid reissue event type.")), "runtime must observe the actual invalid-lifecycle DB detail");
  assert.ok(errorProbeNotices.some((line) => line.includes("P0002") && line.includes("Certificate not found.")), "runtime must observe the actual missing-certificate DB detail");
  process.stdout.write(`${errorProbeNotices.join("\n")}\n`);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("I3A_RENDER_DATA="));
  assert.ok(line, "real issuance SQL must return in-memory render data");
  return JSON.parse(line.slice("I3A_RENDER_DATA=".length));
}

function createFixtureSupabase(fixture) {
  return {
    from(table) {
      const query = {
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        filter() { return this; },
        limit() { return this; },
        single() { return Promise.resolve({ data: fixture.certificate, error: null }); },
        maybeSingle() {
          return Promise.resolve({ data: table === "certificate_issuance_snapshots" ? fixture.snapshot : null, error: null });
        },
        then(resolve, reject) {
          const data = table === "certificate_skill_results" ? fixture.skills : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

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

function toText(content) {
  return content.items.map((item) => item.str ?? "").join(" ");
}

async function main() {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  try {
    const fixture = loadIssuedFixture();
    assert.equal(fixture.certificate.status, "valid", "render data must be captured from the real issuance state before revocation");
    assert.equal(fixture.certificate.certificate_number, "I3A/2026/0001");
    assert.equal(fixture.snapshot.holder_name, "I3A Historical Holder");
    assert.match(fixture.snapshot.template_config.objectives_text, /^I3A HISTORICAL PAGE TWO OBJECTIVE/);
    assert.equal(fixture.snapshot.template_config.show_back_page, true);
    assert.equal(fixture.snapshot.template_config.show_qr, true);
    assert.ok(fixture.skills.length > 0, "issued certificate skill rows must be loaded from the real lifecycle fixture");
    assert.ok(!JSON.stringify(fixture.snapshot).includes("I3A LIVE MUTATED"), "captured snapshot must remain unchanged after live data mutation");

    execFileSync(process.execPath, [
      resolve(repoRoot, "node_modules/typescript/bin/tsc"),
      "--jsx", "react-jsx", "--module", "commonjs", "--target", "es2021", "--moduleResolution", "node",
      "--esModuleInterop", "--skipLibCheck", "--rootDir", repoRoot, "--outDir", compiledDir,
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

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request.endsWith("lib/supabase/server")) {
        return { createSupabaseServerClient: async () => createFixtureSupabase(fixture) };
      }
      if (request.endsWith("lib/site-origin")) return { siteOrigin: async () => "https://example.invalid" };
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      const { loadCertificateRender } = require(resolve(compiledDir, "app/admin/(protected)/certificates/certData.js"));
      const loaded = await loadCertificateRender(fixture.certificate.id);
      assert.ok(loaded, "production loader must load the actually issued certificate");
      const { data, config } = loaded;
      const expectedNumber = "I3A/2026/0001";
      const historicalObjective = fixture.snapshot.template_config.objectives_text;
      assert.equal(data.render_mode, "MODERN_SNAPSHOT");
      assert.equal(data.certificate_number, expectedNumber);
      assert.equal(data.holder_name, "I3A Historical Holder");
      assert.equal(data.course_name, "I3A Captured Course");
      assert.equal(config.objectives_text, historicalObjective);
      assert.ok(!JSON.stringify({ data, config }).includes("I3A LIVE MUTATED"));
      assert.ok(data.qr_svg?.includes("<svg"));
      assert.ok(data.verification_url?.startsWith("https://example.invalid/verify/"));
      const qrTarget = new URL(data.verification_url);
      assert.equal(qrTarget.pathname.split("/").filter(Boolean).at(-1), fixture.certificate.verification_token, "the issued QR URL must contain the token accepted by the public verifier");

      const reactFront = renderToStaticMarkup(React.createElement(CertificateFront, { data, config }));
      const reactBack = renderToStaticMarkup(React.createElement(CertificateBack, { data, config }));
      const htmlFront = renderCertificateFront(data, config);
      const htmlBack = renderCertificateBack(data, config);
      for (const content of [expectedNumber, data.holder_name, "I3A HISTORICAL PAGE TWO OBJECTIVE"]) {
        assert.ok(reactFront.includes(content) || reactBack.includes(content), `React output must preserve ${content}`);
        assert.ok(htmlFront.includes(content) || htmlBack.includes(content), `HTML output must preserve ${content}`);
      }
      assert.ok(reactBack.includes(historicalObjective) && htmlBack.includes(historicalObjective));
      assert.ok(!reactFront.includes(historicalObjective) && !htmlFront.includes(historicalObjective));
      assert.ok(!reactFront.includes("QR VERIFICATION") && !htmlFront.includes("QR VERIFICATION"));
      assert.equal((reactBack.match(/QR VERIFICATION/g) ?? []).length, 1);
      assert.equal((htmlBack.match(/QR VERIFICATION/g) ?? []).length, 1);
      assert.ok(reactBack.includes(data.qr_svg) && htmlBack.includes(data.qr_svg));
      assert.ok(!reactFront.includes(data.qr_svg) && !htmlFront.includes(data.qr_svg));
      console.log("Actual issuance snapshot → production loader → React/HTML parity and Page-2-only QR: PASS");

      const documentHtml = renderCertificateDocument(data, config)
        .replaceAll("/certificates/watermarks/", `${pathToFileURL(resolve(repoRoot, "public/certificates/watermarks")).href}/`)
        .replaceAll('src="/certificates/template-a/', `src="${pathToFileURL(resolve(repoRoot, "public/certificates/template-a")).href}/`)
        .replaceAll('src="/signatures/director-signature.png', `src="${pathToFileURL(resolve(repoRoot, "public/signatures/director-signature.png")).href}`)
        .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${pathToFileURL(resolve(repoRoot, "public/certificates/seals/teras-common-seal.png")).href}`);
      assert.equal((documentHtml.match(/QR VERIFICATION/g) ?? []).length, 1);
      const htmlPath = join(fixtureDir, "issued-certificate.html");
      const pdfPath = join(fixtureDir, "issued-certificate.pdf");
      writeFileSync(htmlPath, documentHtml, "utf8");

      const edge = findEdge();
      assert.ok(edge, "Microsoft Edge must be available for actual PDF rendering");
      execFileSync(edge, [
        "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
      ], { cwd: repoRoot, stdio: "ignore", timeout: 120_000 });
      assert.ok(existsSync(pdfPath), "Edge must emit a PDF from the real issued fixture");

      const pdfjs = await import(pathToFileURL(resolve(repoRoot, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), disableWorker: true }).promise;
      assert.equal(pdf.numPages, config.show_back_page === false ? 1 : 2, "PDF page count must follow captured show_back_page");
      const pages = [];
      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const [x0, y0, x1, y1] = page.view;
        const width = x1 - x0;
        const height = y1 - y0;
        assert.ok(Math.abs(width - 595.28) < 1.5 && Math.abs(height - 841.89) < 1.5, "issued PDF pages must be A4 portrait");
        const content = await page.getTextContent();
        const text = toText(content);
        for (const item of content.items) {
          if (typeof item.str !== "string" || !item.str.trim()) continue;
          const x = item.transform[4] - x0;
          const y = item.transform[5] - y0;
          assert.ok(x >= -1 && x + item.width <= width + 2, `PDF text horizontal overflow on page ${pageIndex}`);
          assert.ok(y >= -2 && y + item.height <= height + 2, `PDF text vertical overflow on page ${pageIndex}`);
        }
        pages.push(text);
      }
      assert.ok(pages[0].includes(expectedNumber), "issued PDF page 1 must preserve certificate number");
      assert.ok(!pages[0].includes("QR VERIFICATION"), "QR must never render on Page 1");
      const noQrHtml = renderCertificateDocument(data, { ...config, show_qr: false })
        .replaceAll("/certificates/watermarks/", `${pathToFileURL(resolve(repoRoot, "public/certificates/watermarks")).href}/`)
        .replaceAll('src="/certificates/template-a/', `src="${pathToFileURL(resolve(repoRoot, "public/certificates/template-a")).href}/`)
        .replaceAll('src="/signatures/director-signature.png', `src="${pathToFileURL(resolve(repoRoot, "public/signatures/director-signature.png")).href}`)
        .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${pathToFileURL(resolve(repoRoot, "public/certificates/seals/teras-common-seal.png")).href}`);
      const noQrHtmlPath = join(fixtureDir, "issued-certificate-no-qr.html");
      const noQrPdfPath = join(fixtureDir, "issued-certificate-no-qr.pdf");
      writeFileSync(noQrHtmlPath, noQrHtml, "utf8");
      execFileSync(edge, [
        "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
        `--print-to-pdf=${noQrPdfPath}`, pathToFileURL(noQrHtmlPath).href,
      ], { cwd: repoRoot, stdio: "ignore", timeout: 120_000 });
      const noQrPdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(noQrPdfPath)), disableWorker: true }).promise;
      assert.equal(noQrPdf.numPages, 2, "show_qr=false must not change captured two-page layout");
      const issuedPdfBytes = readFileSync(pdfPath);
      const noQrPdfBytes = readFileSync(noQrPdfPath);
      const noQrPage1 = await noQrPdf.getPage(1);
      const noQrPage1Text = toText(await noQrPage1.getTextContent());
      assert.equal(pages[0], noQrPage1Text, "QR-on/off PDFs must keep Page 1 content identical");
      assert.ok(issuedPdfBytes.length > noQrPdfBytes.length + 250, "historical show_qr=true must add QR vector graphics to the PDF");
      assert.ok(pages[1]?.includes("I3A HISTORICAL PAGE TWO OBJECTIVE"), "issued PDF Page 2 must use captured historical content");
      console.log("Actual issued PDF: A4, historical 2-page layout, Page-2-only QR graphics, certificate number, no text overflow: PASS");
    } finally {
      Module._load = originalLoad;
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

await main();
