/**
 * Public-First W2-A contract (owner-approved): one public operating address, in the SSM company-profile spelling,
 * from one source (data/publicContact.js businessAddress). The SSM registered address stays only in the Privacy
 * Notice; the Google Maps embed is untouched; app/layout.js keeps literal JSON-LD values that must equal the source.
 *
 * Run: node --experimental-transform-types scripts/public-address-contract.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicContact } from "../data/publicContact.js";
import { companyProfile } from "../data/companyProfile.js";
import { footerContent } from "../content/en/footer.js";
import { privacyNoticeEn } from "../content/en/privacy.js";
import { privacyNoticeMs } from "../content/ms/privacy.js";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const A = publicContact.businessAddress;
const PUBLIC = ["app", "components", "content", "data", ":(exclude)app/admin", ":(exclude)components/admin"];
const grep = (pattern: string) => {
  try {
    return execFileSync("git", ["grep", "-l", "--untracked", "-i", "-E", pattern, "--", ...PUBLIC], { cwd: rootPath, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []; // git grep exits 1 when nothing matches
    throw error;
  }
};

check("source: the owner-approved operating address, in one place", () => {
  assert.deepEqual(A.lines, ["Lot 1961, Kampung Tanah Merah,", "Tanah Merah Dalam,", "06000 Jitra, Kedah, Malaysia"]);
  assert.equal(A.oneLine, "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia");
  assert.equal(A.lines.join(" ").replace(/,$/, ""), A.oneLine);
  assert.equal(A.street, "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam");
  assert.deepEqual([A.locality, A.region, A.postalCode, A.country], ["Jitra", "Kedah", "06000", "MY"]);
});
check("consumers: Premium footer, company profile, /contact, homepage and legacy footer read the shared address", () => {
  assert.deepEqual(footerContent.contact.address, A.lines);
  assert.equal(companyProfile.contact.address, A.oneLine);
  assert.match(read("content/en/footer.js"), /address: publicContact\.businessAddress\.lines,/);
  assert.match(read("data/companyProfile.js"), /address: publicContact\.businessAddress\.oneLine,/);
  const lines = /\{publicContact\.businessAddress\.lines\.flatMap\(\(line, i\) => \(i \? \[<br key=\{i\} \/>, line\] : \[line\]\)\)\}/;
  assert.match(read("app/contact/page.js"), new RegExp(`<h2>Office Address</h2><address>${lines.source}</address>`));
  assert.match(read("components/Footer.js"), new RegExp(`<p>${lines.source}</p>`));
  assert.match(read("components/home/HomeContact.js"), /<small>\{companyProfile\.contact\.address\}\. Sunday to Friday, 8:30 am to 5:30 pm\.<\/small>/);
});
check("JSON-LD: both PostalAddress blocks in app/layout.js equal the shared source", () => {
  const blocks = [...read("app/layout.js").matchAll(/address: \{ "@type": "PostalAddress", streetAddress: "([^"]+)", addressLocality: "([^"]+)", addressRegion: "([^"]+)", postalCode: "([^"]+)", addressCountry: "([^"]+)" \}/g)];
  assert.equal(blocks.length, 2);
  for (const [, street, locality, region, postal, country] of blocks) assert.deepEqual([street, locality, region, postal, country], [A.street, A.locality, A.region, A.postalCode, A.country]);
});
check("no outdated operating-address wording anywhere in public code", () => {
  assert.deepEqual(grep("Jalan Tanah Merah|Kg\\.? Tanah Merah|Darul Aman"), []);
});
check("the SSM registered address (Alor Setar) stays only in the Privacy Notice, labelled separately", () => {
  assert.deepEqual(grep("Jalan Kota|05710|Alor Setar"), ["content/en/privacy.js", "content/ms/privacy.js"]);
  const rows = (doc: typeof privacyNoticeEn) => Object.fromEntries(doc.sections[0].blocks.find((block) => "rows" in block)!.rows!);
  assert.equal(rows(privacyNoticeEn)["Registered address"], "No. 1559 (2nd Floor), Jalan Kota, P.O. Box 106, 05710 Alor Setar, Kedah, Malaysia");
  assert.equal(rows(privacyNoticeMs)["Alamat berdaftar"], "No. 1559 (Tingkat 2), Jalan Kota, P.O. Box 106, 05710 Alor Setar, Kedah, Malaysia");
  assert.equal(rows(privacyNoticeEn)["Business address and training centre"], A.oneLine);
  assert.equal(rows(privacyNoticeMs)["Alamat perniagaan dan pusat latihan"], A.oneLine);
});
check("Google Maps: the /contact embed (place ID and coordinates) is unchanged", () => {
  const page = read("app/contact/page.js");
  assert.ok(page.includes('src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3966.1999457607535!2d100.41016197499049!3d6.237356193750902!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x304b59ed020012fb%3A0x18b18a8d6d8a4a06!2sTeras%20Universal%20Sdn%20Bhd!5e0!3m2!1sen!2smy!4v1784774342646!5m2!1sen!2smy"'));
  assert.ok(page.includes('title="TERAS UNIVERSAL office location"'));
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
