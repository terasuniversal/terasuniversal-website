/**
 * Public-First W2-A (owner-approved, local only): the exact, named edits that move the public operating address to the
 * SSM company-profile spelling ("Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia") and
 * read it from data/publicContact.js. revertW2aAddress(path, text) undoes ONLY these edits. revertPublicFirst() applies
 * it first, so every earlier contract that pins these files to HEAD, to a hash or to the pre-Public-First bytes keeps
 * proving that nothing else in them moved. scripts/public-address-contract.mts proves the new address itself.
 */
const LINES_JSX = "{publicContact.businessAddress.lines.flatMap((line, i) => (i ? [<br key={i} />, line] : [line]))}";

const EDITS: Record<string, [string, string][]> = {
  "app/contact/page.js": [
    ['import bridge from "../../components/premium/legacy-bridge.module.css";\nimport { publicContact } from "../../data/publicContact";\n', 'import bridge from "../../components/premium/legacy-bridge.module.css";\n'],
    [`<h2>Office Address</h2><address>${LINES_JSX}</address>`, "<h2>Office Address</h2><address>Lot 1961<br />Jalan Tanah Merah<br />Kg Tanah Merah Dalam<br />06000 Jitra<br />Kedah<br />Malaysia</address>"],
  ],
  "app/layout.js": [
    ['streetAddress: "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam"', 'streetAddress: "Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam"'],
    ['streetAddress: "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam"', 'streetAddress: "Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam"'],
  ],
  "components/Footer.js": [
    [`          <p>${LINES_JSX}</p>\n`, "          <p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p>\n"],
  ],
  "components/home/HomeContact.js": [
    ["<small>{companyProfile.contact.address}. Sunday to Friday, 8:30 am to 5:30 pm.</small>", "<small>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah. Sunday to Friday, 8:30 am to 5:30 pm.</small>"],
  ],
  "content/en/footer.js": [
    ['// Explicit extension so plain Node contract scripts can load this module as well as the Next.js bundler.\nimport { publicContact } from "../../data/publicContact.js";\n\nexport const footerContent = {\n', "export const footerContent = {\n"],
    ["    // W2-A: the shared public operating address (data/publicContact.js), the same lines as components/Footer.js.\n    address: publicContact.businessAddress.lines,\n", '    // Unchanged from the existing site footer (components/Footer.js).\n    address: ["Lot 1961, Jalan Tanah Merah,", "Kg Tanah Merah Dalam,", "06000 Jitra, Kedah, Malaysia"],\n'],
  ],
  "data/companyProfile.js": [
    ["    // W2-A: the shared public operating address (SSM company-profile spelling).\n    address: publicContact.businessAddress.oneLine,\n", '    address: "Lot 1961 Kg Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah Darul Aman, Malaysia",\n'],
  ],
};

export const W2A_CHANGED = [...Object.keys(EDITS), "data/publicContact.js"].sort();
export const W2A_ADDED = ["scripts/w2a-address-approved.mts", "scripts/public-address-contract.mts"];

export function revertW2aAddress(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`w2a-address: expected edit not found in ${path}`);
    out = out.replace(from, eol(before));
  }
  return out;
}
