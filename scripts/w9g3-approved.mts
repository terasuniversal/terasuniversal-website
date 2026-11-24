/**
 * W9-G3 (owner-approved, local only): the exact, named edits to the two pinned eBook files for the live flow.
 *   app/ebook page: also exists when TERAS_EBOOK_PUBLIC is "on" at build time; renders the live EbookRequestForm then
 *   (the local preview keeps the network-free demo) and hides the preview banner.
 *   ebook.module.css: honeypot, verify-page and result-state styles.
 *   public-design-foundation contract (W9-G3.2): the verify page joins the Premium kit importer allowlist;
 *   (W9-G3.3): the two W9-G3 API route files become exact-path exceptions to the protected "no new files" check.
 * revertW9g3(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once. Generated from
 * git diff -U1 against main 45672429; strings are JSON-escaped verbatim. Chained before revertW9g3.
 */
const EDITS: Record<string, [string, string][]> = {
  "app/ebook/[[...ebook]]/page.js": [
    [
      "import EbookRequestDemo from \"../../../components/ebook/EbookRequestDemo\";\nimport EbookRequestForm from \"../../../components/ebook/EbookRequestForm\";\nimport { ebookPreviewEnabled, ebookRelease } from \"../../../lib/ebook-preview\";\nimport { ebookPublicEnabled } from \"../../../lib/ebook-lead\";\n\n",
      "import EbookRequestDemo from \"../../../components/ebook/EbookRequestDemo\";\nimport { ebookPreviewEnabled, ebookRelease } from \"../../../lib/ebook-preview\";\n\n"
    ],
    [
      "\n// W9-G3: the page also exists when TERAS_EBOOK_PUBLIC is \"on\" at build time (launch needs a rebuild, which an env change\n// on Vercel triggers anyway). Live mode renders the real request form; the local preview keeps the network-free demo.\nexport function generateStaticParams() {\n  return ebookPreviewEnabled || ebookPublicEnabled() ? [{ ebook: [] }] : [];\n}\n",
      "\nexport function generateStaticParams() {\n  return ebookPreviewEnabled ? [{ ebook: [] }] : [];\n}\n"
    ],
    [
      "export default function EbookPage() {\n  const live = ebookPublicEnabled();\n  return (\n",
      "export default function EbookPage() {\n  return (\n"
    ],
    [
      "      <main className={`${publicBody.variable} ${kit.px} ${styles.page}`}>\n        {!live && <p className={styles.previewBanner} role=\"note\"><strong>Local preview, not live.</strong> This page and its request form are a demonstration for owner review. No details are sent or stored, and the eBook is not delivered here.</p>}\n\n",
      "      <main className={`${publicBody.variable} ${kit.px} ${styles.page}`}>\n        <p className={styles.previewBanner} role=\"note\"><strong>Local preview, not live.</strong> This page and its request form are a demonstration for owner review. No details are sent or stored, and the eBook is not delivered here.</p>\n\n"
    ],
    [
      "            </div>\n            {live ? <EbookRequestForm /> : <EbookRequestDemo />}\n          </div>\n",
      "            </div>\n            <EbookRequestDemo />\n          </div>\n"
    ]
  ],
  "components/ebook/ebook.module.css": [
    [
      "}\n\n.honeypot {\n  position: absolute;\n  left: -10000px;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n}\na.reset {\n  display: inline-flex;\n  align-items: center;\n  text-decoration: none;\n}\n.verifySection {\n  max-width: 720px;\n}\n.verifyHeading {\n  margin: 8px 0 24px;\n}\n.verifyTitle {\n  margin: 0 0 12px;\n  font-size: 22px;\n}\n.result button + button,\n.result form + .hint,\n.result button + .hint {\n  margin-top: 12px;\n}\n",
      "}\n"
    ]
  ],
  // W9-G3.2 (owner-approved): the W9-G3 /ebook/verify page uses the Premium kit (PremiumHeader/Footer, fonts, kit css),
  // like the S6 /ebook page; exactly this one path joins the kit importer allowlist. No wildcard; nothing else changes.
  "scripts/public-design-foundation-contract.mts": [
    [
      "\"app/ebook/[[...ebook]]/page.js\" /* S6 local-preview eBook page */, \"app/ebook/verify/[[...verify]]/page.js\" /* W9-G3 eBook verification page (W9-G3.2) */, \"app/faq/page.js\",",
      "\"app/ebook/[[...ebook]]/page.js\" /* S6 local-preview eBook page */, \"app/faq/page.js\","
    ],
    // W9-G3.3 (owner-approved): the two W9-G3 API route files are exact-path exceptions to "protected paths have no new
    // files"; the assertion itself and every other protected path are unchanged.
    [
      "import { revertW4a, W4A_CHANGED } from \"./w4a-approved.mts\";\nimport { W9G3_PROTECTED_ADDED } from \"./w9g3-approved.mts\"; // W9-G3.3: the two exact W9-G3 API route files\n",
      "import { revertW4a, W4A_CHANGED } from \"./w4a-approved.mts\";\n"
    ],
    [
      ".filter((path) => !PF_ADDED.includes(path) && !W9G3_PROTECTED_ADDED.includes(path) /* W9-G3.3 exact paths */);",
      ".filter((path) => !PF_ADDED.includes(path));"
    ]
  ]
};

// W9-G3.3: the only new files W9-G3 adds under a protected path (app/api). Exact paths, no wildcard or directory.
export const W9G3_PROTECTED_ADDED = Object.freeze(["app/api/ebook/download/route.js", "app/api/ebook/verify/route.js"]);

export const W9G3_CHANGED = Object.keys(EDITS).sort();
// W9-G3.1 (erratum v1.0.2) adds lib/ebook-verify-link.js (fragment token transport).
export const W9G3_ADDED = ["app/api/ebook/download/route.js", "app/api/ebook/verify/route.js", "app/ebook/verify/[[...verify]]/page.js", "components/ebook/EbookRequestForm.js", "components/ebook/EbookVerify.js", "lib/ebook-contract.js", "lib/ebook-mailer.js", "lib/ebook-privileged.server.js", "lib/ebook-runtime.server.js", "lib/ebook-verify-link.js", "lib/email-dns.js", "scripts/fixtures/w9g3-ebook-crm-mock.mjs", "scripts/w9g3-approved.mts", "scripts/w9g3-ebook-contract.mts", "scripts/w9g3-ebook-flow.test.mts"];

export function revertW9g3(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W9-G3: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
