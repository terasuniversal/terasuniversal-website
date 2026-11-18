/**
 * Public-First W2 Phase 1 (owner-approved, local only): the exact, named edits that add the gated Privacy Notice link
 * to the three enquiry forms and the Premium footer. revertW2Privacy(path, text) undoes ONLY these edits, so earlier
 * phase contracts that pin those files to HEAD or to a fixed hash keep proving everything else is unchanged: no field,
 * payload, endpoint, consent or submission change. scripts/privacy-publication-contract.mts proves the edits are gated.
 */
const LINK_IMPORT = 'import PrivacyNoticeLink from "./legal/PrivacyNoticeLink";\n';
const CONTACT_NOTE = "        Privacy: we use these details to respond to your enquiry and keep a record of it. Sending this form does not subscribe you to marketing emails.\n";

const EDITS: Record<string, [string, string][]> = {
  "components/ContactEnquiryForm.js": [
    [`import { useRef, useState } from "react";\n${LINK_IMPORT}`, 'import { useRef, useState } from "react";\n'],
    [`${CONTACT_NOTE}        <PrivacyNoticeLink newTab />\n`, CONTACT_NOTE],
  ],
  "components/ContactForm.js": [
    [`import { useRef, useState } from "react";\n${LINK_IMPORT}`, 'import { useRef, useState } from "react";\n'],
    [`${CONTACT_NOTE}        <PrivacyNoticeLink newTab />\n`, CONTACT_NOTE],
  ],
  "components/ProposalWizard.js": [
    [`import { useRouter } from "next/navigation";\n${LINK_IMPORT}`, 'import { useRouter } from "next/navigation";\n'],
    ["Submitting this form does not subscribe you to marketing emails.<PrivacyNoticeLink newTab /></p>", "Submitting this form does not subscribe you to marketing emails.</p>"],
  ],
  "components/premium/PremiumFooter.js": [
    ['import { footerContent } from "../../content/en/footer";\nimport { privacyPublished } from "../../lib/privacy-publication";\n', 'import { footerContent } from "../../content/en/footer";\n'],
    ["          {privacyPublished && <p><a className={styles.legal} href={text.privacyLink.href}>{text.privacyLink.label}</a></p>}\n", ""],
  ],
  "components/premium/footer.module.css": [
    [".bottomRow .legal { display: inline-flex; align-items: center; min-height: 32px; color: var(--px-white); text-decoration: underline; text-underline-offset: 4px; }\n.bottomRow .legal:hover { color: var(--px-gold); }\n", ""],
  ],
  "content/en/footer.js": [
    ["// scripts/premium-footer-contract.mts); /ebook is not published, and the one policy link (privacyLink) is rendered only\n// once the Privacy Notice is published (lib/privacy-publication.js), so it never points at a 404.\n", "// scripts/premium-footer-contract.mts); no policy page is linked because none exists yet, and /ebook is not published.\n"],
    ['  // Public-First W2 Phase 1: shown in the bottom row only while lib/privacy-publication.js privacyPublished is true.\n  privacyLink: { label: "Privacy Notice", href: "/privacy" },\n', ""],
  ],
};

export const W2_CHANGED = Object.keys(EDITS).sort();
export const W2_ADDED = ["components/legal/PrivacyNoticeLink.js", "scripts/w2-privacy-approved.mts"];

export function revertW2Privacy(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`w2-privacy: expected edit not found in ${path}`);
    out = out.replace(from, eol(before));
  }
  return out;
}
