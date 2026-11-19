import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accreditations, confirmedFacts } from "../data/companyProfile.js";

// S5B-1B Round 1 (owner-approved, local only): JKKP wording limited to the letter's scope, an honest newsletter
// success message, neutral newsletter configuration errors and no client IP in enquiry/proposal error logs.
// Email display (admin@) and the header/footer changes are proven by home-content, premium-footer and
// premium-header-pilot contracts.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

check("JKKP: label and text are limited to the tube-scaffolding recognition scope", () => {
  const jkkp = accreditations.find((entry) => entry.org === "JKKP (DOSH)");
  assert.ok(jkkp);
  assert.equal(jkkp.label, "Recognised Training Centre (Tube Scaffolding)");
  assert.match(jkkp.text, /training centre for tube scaffold erectors, inspectors and supervisors/);
  assert.match(jkkp.text, /covers that scope only/);
  assert.doesNotMatch(`${jkkp.label} ${jkkp.text}`, /approved training provider|occupational safety and health training programmes|latest regulations/i);
  assert.equal(jkkp.recognition.scope, "tube scaffold erectors, inspectors and supervisors");
  assert.equal(jkkp.recognition.validUntil, "2027-05-25");
  assert.ok(confirmedFacts.includes("JKKP (DOSH) Recognised Training Centre (Tube Scaffolding)"));
  assert.ok(!confirmedFacts.some((fact) => /JKKP.*Approved Training Provider/.test(fact)));
  assert.match(read("data/companyProfile.js"), /JKKP BC 127\/682\/3 klt\. 1\(11-4\)/);
});
check("JKKP: homepage status states the scope and expiry without repeating the label", () => {
  // components/home/recognitionStatus.js uses an extensionless import (bundler-only), so its source is checked.
  const status = read("components/home/recognitionStatus.js");
  assert.match(status, /status: `Recognised training centre for \$\{recognition\.scope\}, valid until \$\{until\}\.`, current: true/);
  assert.doesNotMatch(status, /\$\{entry\.label\}\. Recognised/);
  assert.match(status, /status: `Recognition as a training centre for \$\{recognition\.scope\} was valid until \$\{until\}\.`, current: false/);
});
check("newsletter: the success message claims only that the request was received", () => {
  const component = read("components/NewsletterSignup.js");
  assert.match(component, /your subscription request has been received\./);
  assert.doesNotMatch(component, /check your inbox|confirm your subscription|confirmation email/i);
  assert.match(component, /useState\(false\)/, "consent box still starts unticked");
});
check("newsletter: configuration problems are logged server-side and never shown to visitors", () => {
  const route = read("app/api/newsletter/route.js");
  assert.doesNotMatch(route, /responseError\([^)]*RESEND_/);
  assert.match(route, /Newsletter sign-up is temporarily unavailable\. Please try again later\./);
  assert.match(route, /console\.error\("Newsletter subscription unavailable: email service not configured", \{ missing: /);
  assert.match(route, /recentSubscriptions/, "the existing rate limit is kept");
  assert.match(route, /resend\.contacts\.create\(\{ email, unsubscribed: false, audienceId \}\)/);
});
check("logs: no client IP in enquiry or proposal error logs, and no leftover IP helper", () => {
  for (const path of ["app/api/contact/route.js", "app/api/request-proposal/route.js"]) {
    const route = read(path);
    assert.doesNotMatch(route, /getClientIp|ip:/, path);
    assert.match(route, /INTERNAL_RECIPIENT = "training@terasuniversal\.com\.my"/, `${path}: backend recipient unchanged`);
  }
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
