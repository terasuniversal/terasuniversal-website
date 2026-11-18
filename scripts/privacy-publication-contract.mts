/**
 * Public-First F-6 contract: the owner-approved Privacy Notice (v0.5 since W2 Phase 1) and its own fail-closed publication switch.
 *  - /privacy and /privacy/ms publish ONLY with a valid PRIVACY_EFFECTIVE_DATE (null in the release candidate) and
 *    never through TERAS_LEGAL_DRAFTS; /terms keeps its original draft-only gate;
 *  - the content states only owner-approved, verified facts: general retention principle (no durations), qualified
 *    Google Sheets wording, Google Maps cookies, /verify logging, admin@ as privacy contact (no DPO claim), no
 *    language-precedence clause; Bahasa Melayu and English have the same structure and the same facts and numbers.
 *  - W2 Phase 1: no hashed-IP claim for the forms (K-B), a separate-consent marketing statement (K-C), and one shared
 *    Privacy Notice link for the three enquiry forms that renders only once the notice is published.
 *
 * Run: node --experimental-transform-types scripts/privacy-publication-contract.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privacyNoticeEn } from "../content/en/privacy.js";
import { privacyNoticeMs } from "../content/ms/privacy.js";
import { PRIVACY_EFFECTIVE_DATE, isPrivacyEffectiveDate, privacyPublished, privacyEffectiveDateText } from "../lib/privacy-publication.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
type Doc = typeof privacyNoticeEn;
const text = (doc: Doc) => JSON.stringify(doc.sections);

check("release candidate: the notice is NOT published (no effective date set)", () => {
  assert.equal(PRIVACY_EFFECTIVE_DATE, null);
  assert.equal(privacyPublished, false);
  assert.equal(privacyEffectiveDateText("en"), null);
});
check("the switch fails closed: only a real ISO calendar date publishes", () => {
  for (const bad of [null, undefined, "", "2026-02-30", "2026-13-01", "18/11/2026", "2026-11-18T00:00:00Z", " 2026-11-18", "true", 20261118]) assert.equal(isPrivacyEffectiveDate(bad), false, String(bad));
  for (const good of ["2026-11-18", "2027-02-28", "2028-02-29"]) assert.equal(isPrivacyEffectiveDate(good), true, good);
});
check("routes: privacy has its own switch; TERAS_LEGAL_DRAFTS alone still only previews; terms gate unchanged", () => {
  const page = code("app/privacy/[[...lang]]/page.js");
  assert.match(page, /^export const dynamicParams = false;$/m);
  assert.match(page, /return privacyPublished \|\| legalDraftsEnabled \? \[\{ lang: \[\] \}, \{ lang: \["ms"\] \}\] : \[\];/);
  assert.match(page, /robots: \{ index: false, follow: false \}/, "draft branch stays noindex");
  assert.match(page, /if \(!privacyPublished\) \{/);
  assert.match(page, /const status = privacyPublished \? null : /, "draft banner only while unpublished");
  const terms = code("app/terms/[[...part]]/page.js");
  assert.match(terms, /return legalDraftsEnabled \? \[.+\] : \[\];/);
  assert.doesNotMatch(terms, /privacyPublished|privacy-publication/);
  assert.match(read("lib/legal-drafts.js"), /export const legalDraftsEnabled = process\.env\.TERAS_LEGAL_DRAFTS === "preview";/);
});
check("sitemap lists /privacy and /privacy/ms only behind the publication switch and never /terms", () => {
  const sitemap = code("app/sitemap.js");
  assert.match(sitemap, /\.\.\.\(privacyPublished \? \[`\$\{siteUrl\}\/privacy`, `\$\{siteUrl\}\/privacy\/ms`\]/);
  assert.doesNotMatch(sitemap, /terms/);
});
check("legal component shows the draft banner only when a status is given", () => {
  assert.match(read("components/legal/LegalDocument.js"), /\{status && <p className=\{styles\.draft\} role="note"><strong>\{status\}<\/strong><\/p>\}/);
});
check("structure: 12 sections in each language with identical block shapes", () => {
  assert.equal(privacyNoticeEn.sections.length, 12);
  assert.equal(privacyNoticeMs.sections.length, 12);
  const shape = (blocks: Record<string, unknown>[]) => blocks.map((b) => Object.keys(b).sort().join("+") + ":" + ((b.list as unknown[])?.length ?? (b.rows as unknown[])?.length ?? 1));
  privacyNoticeEn.sections.forEach((section, i) => assert.deepEqual(shape(privacyNoticeMs.sections[i].blocks), shape(section.blocks), `section ${i + 1}`));
});
check("equivalence: the same numbers, email, URLs and company facts in both languages", () => {
  const facts = (doc: Doc) => [...text(doc).matchAll(/\d[\d()-]*\d|\d|[\w.-]+@[\w.-]+|https?:\/\/[^\s"]+|\/verify/g)].map((m) => m[0]).sort();
  assert.deepEqual(facts(privacyNoticeMs), facts(privacyNoticeEn));
  for (const doc of [privacyNoticeEn, privacyNoticeMs]) {
    const t = text(doc);
    for (const fact of ["201201003207 (976732-P)", "No. 1559", "Jalan Kota", "05710 Alor Setar", "Lot 1961", "06000 Jitra", "admin@terasuniversal.com.my", "+60 19-519 3834", "ToyyibPay", "Vercel", "Supabase", "Resend", "Google Maps"]) assert.ok(t.includes(fact), `${doc.lang}: ${fact}`);
  }
});
check("no open markers, invented durations, unverified locations, compliance or DPO claims, or precedence clause", () => {
  for (const doc of [privacyNoticeEn, privacyNoticeMs]) {
    const t = JSON.stringify(doc);
    // Open decision markers look like "[[D-05: …]]" / "[[PLANNED: …]]" (JSON table rows legitimately contain `[["`).
    assert.doesNotMatch(t, /\[\[[A-Z]+(?:-\d+)?:/);
    assert.doesNotMatch(t, /\b\d+\s*(years?|months?|days?|tahun|bulan|hari)\b/i, `${doc.lang}: retention durations`);
    assert.doesNotMatch(t, /\b(United States|USA|Europe|Ireland|Amerika|Eropah)\b/i);
    assert.doesNotMatch(t, /\b(compliant|complies with|fully comply|mematuhi sepenuhnya|patuh PDPA)\b/i);
    assert.doesNotMatch(t, /Data Protection Officer|Pegawai Perlindungan Data|\bDPO\b/);
    assert.doesNotMatch(t, /prevail|precedence|diutamakan|terpakai jika/i);
  }
});
check("approved wording: general retention principle, qualified Google Sheets, Maps cookies, /verify logging", () => {
  const en = text(privacyNoticeEn), ms = text(privacyNoticeMs);
  assert.match(en, /retain personal data only for as long as reasonably necessary for the purposes described in this notice and to meet applicable legal, contractual and recordkeeping requirements/);
  assert.match(ms, /menyimpan data peribadi hanya selama yang munasabah diperlukan untuk tujuan yang diterangkan dalam notis ini dan untuk memenuhi keperluan undang-undang, kontrak dan penyimpanan rekod yang terpakai/);
  assert.match(en, /proposal requests may also be copied into a Google spreadsheet/);
  assert.match(ms, /permohonan cadangan juga mungkin disalin ke dalam hamparan Google/);
  assert.match(en, /Google may collect information such as your IP address and may set its own cookies/);
  assert.match(ms, /Google mungkin mengumpul maklumat seperti alamat IP anda dan mungkin menetapkan kukinya sendiri/);
  assert.match(en, /record your IP address, browser user-agent and the result of each check/);
  assert.match(ms, /merekodkan alamat IP anda, maklumat pelayar \(user-agent\) dan keputusan setiap semakan/);
  assert.match(en, /A certificate number is not a password/);
  assert.match(ms, /Nombor sijil bukan kata laluan/);
});
check("W2 K-B: form submission control is described as the email-based check, with no hashed-IP claim", () => {
  const en = text(privacyNoticeEn), ms = text(privacyNoticeMs);
  assert.ok(en.includes("To prevent repeated or automated submissions, we check whether a form has recently been sent from the same email address."));
  assert.ok(ms.includes("Untuk mengelakkan penghantaran berulang atau automatik, kami menyemak sama ada borang telah dihantar baru-baru ini daripada alamat e-mel yang sama."));
  assert.doesNotMatch(en + ms, /hash|one-way coded|berkod sehala/i);
  // The /verify log disclosure is a different, accurate activity and stays.
  assert.match(en, /record your IP address, browser user-agent and the result of each check/);
});
check("W2 K-C: a separate-consent marketing statement in both languages, and no unconditional never-marketing claim", () => {
  const en = text(privacyNoticeEn), ms = text(privacyNoticeMs);
  assert.ok(en.includes("Sending an enquiry or proposal request does not sign you up for marketing emails. We will only add you to our marketing communications with your separate consent, and you can withdraw that consent at any time."));
  assert.ok(ms.includes("Menghantar pertanyaan atau permohonan cadangan tidak mendaftarkan anda untuk e-mel pemasaran. Kami hanya akan memasukkan anda ke dalam komunikasi pemasaran kami dengan persetujuan berasingan anda, dan anda boleh menarik balik persetujuan itu pada bila-bila masa."));
  assert.doesNotMatch(en, /never (be )?used for marketing|never send (you )?marketing/i);
  assert.doesNotMatch(ms, /tidak sekali-kali|tidak akan pernah/i);
  for (const doc of [privacyNoticeEn, privacyNoticeMs]) assert.match(doc.unpublishedVersion, /v0\.5/);
});
check("W2 form links: one shared component, gated on privacyPublished, new tab only where approved", () => {
  const link = code("components/legal/PrivacyNoticeLink.js");
  assert.match(link, /^import \{ privacyPublished \} from "\.\.\/\.\.\/lib\/privacy-publication";$/m);
  assert.match(link, /if \(!privacyPublished\) return null;/);
  assert.match(link, /<a href="\/privacy" target="_blank" rel="noopener noreferrer">\s*Privacy Notice<span className="sr-only"> \(opens in a new tab\)<\/span>\s*<\/a>/);
  assert.match(link, /<a href="\/privacy">Privacy Notice<\/a>/);
  assert.doesNotMatch(link, /\/terms|\/ebook|useState|useEffect/);
  assert.equal((read("components/ProposalWizard.js").match(/<PrivacyNoticeLink newTab \/>/g) ?? []).length, 1, "Proposal wizard: new tab (K-E)");
  for (const path of ["components/ContactEnquiryForm.js", "components/ContactForm.js"]) assert.equal((read(path).match(/<PrivacyNoticeLink \/>/g) ?? []).length, 1, path);
  for (const path of ["components/ContactEnquiryForm.js", "components/ContactForm.js", "components/ProposalWizard.js"]) assert.match(read(path), /^import PrivacyNoticeLink from "\.\/legal\/PrivacyNoticeLink";$/m, path);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
