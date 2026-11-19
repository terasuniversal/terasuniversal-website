/**
 * Release 2 S2-0 (owner-approved K-DEV, 19 Nov 2026): recognition-claim accuracy, Company Profile PDF withdrawal (E11/E12),
 * Director credential removal (D1) and no numeric recognition count on the homepage (E13).
 *
 * Each entry is [text now, text at 33514b4]. revertS2_0(path, text) undoes ONLY these edits; the S2-0 contract then
 * requires the result to hash to the 33514b4 content, so any other change in these files still fails.
 */
export const S2_0_BASE = "33514b4ff68f540825af3b231c3b2a7cb00234d6";

const CIDB_ENTRY = '  { org: "CIDB Malaysia", label: "Registered Training Provider", text: "Registered with the Construction Industry Development Board Malaysia (CIDB) as an approved training provider to deliver construction industry-related training programmes." },\n';
const MOF_ENTRY = '  { org: "MOF", label: "Registered Supplier", text: "Registered with the Ministry of Finance Malaysia (MOF) as an approved supplier for training, courses and development programmes for government agencies and departments." },\n';
const SUSPENDED_NOTE = "  // R2 S2-0 (owner decision, 19 Nov 2026): the CIDB and MOF entries are suspended until valid official certificates\n  // are verified; the documents on file are a CIDB contractor registration and an MOF Bumiputera status certificate.\n";
const COMPANY_PROFILE_LINK = '      { title: "Company Profile", text: "A concise overview of TERAS UNIVERSAL, our capabilities and the industries we support.", action: "Download PDF", href: "/downloads/TERAS-UNIVERSAL-Company-Profile.pdf", note: "PDF · Corporate profile" },\n';

export const S2_0_EDITS: Record<string, [string, string][]> = {
  "data/companyProfile.js": [
    [SUSPENDED_NOTE, CIDB_ENTRY + MOF_ENTRY],
    ['    role: "Director",\n    bio: "Began', '    role: "Director",\n    credential: "DOSH Registration No. JKKP: KD/17/PP/03/2",\n    bio: "Began'],
    ['  "HRD Corp Registered Training Provider",\n  "SSM Registered Company (since 2012)",\n', '  "HRD Corp Registered Training Provider",\n  "CIDB Malaysia Registered Training Provider",\n  "MOF Registered Supplier",\n  "SSM Registered Company (since 2012)",\n'],
    ['  "G3 CIDB licence or registration",\n  "CIDB training-provider registration (suspended 19 Nov 2026 pending a valid official certificate)",\n  "MOF supplier registration (suspended 19 Nov 2026 pending a valid official certificate)",\n', '  "G3 CIDB licence or registration",\n'],
  ],
  "data/faq.js": [
    ['"TERAS UNIVERSAL supports training and consultancy engagements with government agencies, departments and government-linked companies. Contact us for the registration details your procurement process requires."', '"Yes. TERAS UNIVERSAL is a registered supplier with the Ministry of Finance Malaysia (MOF), and can support training and consultancy engagements with government agencies, departments and government-linked companies."'],
  ],
  "data/industries.js": [
    ["training aligned with construction site safety requirements.\",", "training aligned with CIDB-registered construction requirements.\","],
    ["Our programmes support crews from first entry", "Our CIDB-registered programmes support crews from first entry"],
    ['    summary: "HRD Corp claimable training and consultancy support for government agencies and GLCs.",', '    summary: "MOF-registered, HRD Corp claimable training and consultancy support for government agencies and GLCs.",'],
    ['    focus: "As an HRD Corp registered training provider, we support', '    focus: "As an MOF-registered supplier and HRD Corp registered training provider, we support'],
  ],
  "lib/successMetrics.js": [
    ['label: "Registrations & Recognitions", detail: "JKKP, HRD Corp, SSM" },', 'label: "Regulatory Accreditations", detail: "JKKP, HRD Corp, CIDB, MOF, SSM" },'],
  ],
  "app/resources/page.js": [
    ['    items: [\n      { title: "About TERAS UNIVERSAL",', `    items: [\n${COMPANY_PROFILE_LINK}      { title: "About TERAS UNIVERSAL",`],
  ],
  "components/home/Recognition.js": [
    ["  const rows = accreditationRows();\n  return (", "  const rows = accreditationRows();\n  const currentCount = rows.filter((row) => row.current).length;\n  return ("],
    ["Established {companyProfile.established}. Company registrations and recognitions, with their current status.</p>", "Established {companyProfile.established}. Approved and registered with {currentCount} bodies.</p>"],
  ],
};

/** SHA-256 (first 16 hex) of each file at S2_0_BASE, line endings normalised to LF. */
export const S2_0_BASE_HASH: Record<string, string> = {
  "data/companyProfile.js": "5e1858b37a9ff90c",
  "data/faq.js": "fc385e40444d0e0d",
  "data/industries.js": "583f52367301347f",
  "lib/successMetrics.js": "111c7224523744b0",
  "app/resources/page.js": "5622b1d4b169d927",
  "components/home/Recognition.js": "4cbdb5ac0b6a2676",
};

export const S2_0_CHANGED = Object.keys(S2_0_EDITS).sort();
/** Withdrawn from public/ (E11); a byte-identical archive copy is kept outside the repository. */
export const S2_0_WITHHELD = ["public/downloads/TERAS-UNIVERSAL-Company-Profile.pdf"];
export const S2_0_WITHHELD_SHA256 = "edbff2346b2941528e7f12fbc62eeed6643ccf6ae405762603a0c000249ca741";

export function revertS2_0(path: string, input: string): string {
  const text = input.replace(/\r\n/g, "\n");
  let out = text;
  for (const [now, before] of S2_0_EDITS[path] ?? []) {
    if (out.split(now).length !== 2) throw new Error(`r2-s2-0: expected edit not found exactly once in ${path}`);
    out = out.replace(now, () => before);
  }
  return out;
}
