import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const configUrl = new URL("../next.config.mjs", import.meta.url);
const stagingUrl = "https://eokiaehnvzbggmacifcf.supabase.co";
const productionHost = "iagzkrzeuawaxvacqprk.supabase.co";

process.env.NEXT_PUBLIC_SUPABASE_URL = stagingUrl;
const { default: config } = await import(new URL("../next.config.mjs", import.meta.url));
const headers = await config.headers();
const csp = headers[0].headers.find(({ key }) => key === "Content-Security-Policy")?.value;

assert.ok(csp, "CSP header is configured");
assert.ok(csp.includes(stagingUrl), "CSP allows the configured STAGING Supabase origin");
assert.ok(!csp.includes(productionHost), "CSP excludes the Production Supabase host");
assert.ok(!csp.includes("*.supabase.co"), "CSP does not allow wildcard Supabase origins");

for (const [label, configuredUrl] of [
  ["missing URL", undefined],
  ["invalid URL", "not-a-url"],
  ["non-HTTPS URL", "http://eokiaehnvzbggmacifcf.supabase.co"],
  ["Production URL", `https://${productionHost}`],
]) {
  const childEnv = { ...process.env };
  if (configuredUrl === undefined) delete childEnv.NEXT_PUBLIC_SUPABASE_URL;
  else childEnv.NEXT_PUBLIC_SUPABASE_URL = configuredUrl;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(configUrl.href)})`], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, `${label} must fail configuration`);
  assert.match(`${result.stdout}\n${result.stderr}`, /NEXT_PUBLIC_SUPABASE_URL/);
}

for (const [label, vercelEnv, configuredUrl, shouldPass] of [
  ["preview with STAGING", "preview", stagingUrl, true],
  ["preview with Production", "preview", `https://${productionHost}`, false],
  ["production with Production", "production", `https://${productionHost}`, true],
  ["production with STAGING", "production", stagingUrl, false],
  ["preview suffix-confusion host", "preview", "https://eokiaehnvzbggmacifcf.supabase.co.attacker.example", false],
  ["preview prefix-confusion host", "preview", "https://eokiaehnvzbggmacifcf.supabase.co.attacker", false],
  ["preview lookalike project", "preview", "https://eokiaehnvzbggmacifcfx.supabase.co", false],
]) {
  const childEnv = { ...process.env, VERCEL_ENV: vercelEnv, NEXT_PUBLIC_SUPABASE_URL: configuredUrl };
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `const { default: config } = await import(${JSON.stringify(configUrl.href)}); const headers = await config.headers(); console.log(headers[0].headers.find(({ key }) => key === "Content-Security-Policy")?.value);`], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
  });

  if (shouldPass) {
    assert.equal(result.status, 0, `${label} must load configuration`);
    assert.ok(result.stdout.includes(new URL(configuredUrl).origin), `${label} CSP must include its environment's origin`);
  } else {
    assert.notEqual(result.status, 0, `${label} must fail configuration`);
    assert.match(`${result.stdout}\n${result.stderr}`, /NEXT_PUBLIC_SUPABASE_URL/);
  }
}

console.log("S3 preview CSP contract passed: VERCEL_ENV binding, exact origins, domain-confusion rejection, fail-closed configuration.");