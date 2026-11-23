/**
 * W5-a (owner-approved W5-a-G1, D-07, local only): the exact, named edits to protected configuration.
 *   next.config.mjs: the CSP gains the GA4 collection endpoints in connect-src and img-src (used only after the visitor
 *   accepts analytics). script-src is not touched.
 * revertW5a(path, text) undoes ONLY these edits (each must be present exactly once), so contracts that pin
 * next.config.mjs to the contract base (public-design-foundation, s6-content) keep proving nothing else moved.
 */
const EDITS: Record<string, [string, string][]> = {
  "next.config.mjs": [
    [
      "      \"https://region1.google-analytics.com\",\n      // W5-a (owner-approved D-07): GA4 collection endpoints, used only after the visitor accepts analytics. script-src is unchanged.\n      \"https://*.google-analytics.com\",\n      \"https://*.analytics.google.com\",\n      \"https://www.googletagmanager.com\",\n    ].filter(Boolean).join(\" \");\n",
      "      \"https://region1.google-analytics.com\",\n    ].filter(Boolean).join(\" \");\n",
    ],
    [
      "img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com; connect-src ${connectSrc}",
      "img-src 'self' data: blob:; connect-src ${connectSrc}",
    ],
  ],
};

export const W5A_CHANGED = Object.keys(EDITS).sort();

export function revertW5a(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W5-a: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
