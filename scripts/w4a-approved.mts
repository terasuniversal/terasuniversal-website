/**
 * W4-a (owner-approved, local only): the exact, named edits from the W1 / W4-a QA remediation (W4-a-G1).
 *   NE-1 components/premium/header.module.css: below 360px the header row spacing tightens so the Contact label no longer
 *        overflows its 44px box (all four controls stay, every target stays 44px, the 54px logo is unchanged).
 *   NE-2 app/globals.css: the /insights "Read article / Read summary" links get a 44px target and 14px text, and the
 *        decorative arrow becomes navy (gold was 2.1:1 on white).
 * revertW4a(path, text) undoes ONLY these edits. revertPublicFirst() applies it first (latest change first), so every
 * earlier contract that pins these files to HEAD, to a hash or to the pre-Public-First bytes keeps proving that nothing
 * else in them moved.
 */
const EDITS: Record<string, [string, string][]> = {
  "components/premium/header.module.css": [
    [
      "  .hdr :global(.menu-button) { width: 44px; height: 44px; padding: 10px; }\n}\n/* W4-a NE-1 (owner-approved): below 360px the four controls (54px logo, Sessions, Contact, menu) did not fit, so the\n   Contact label (47px) overflowed its 44px box. Tighter spacing only on these widths; every control keeps a 44px target. */\n@media (max-width: 359px) {\n  .hdr .hdrRow { gap: 6px; padding-inline: 16px; }\n  .regCta { padding: 0 8px; }\n  .hdr :global(.contact-button) { flex: none; padding: 0 6px; }\n}\n",
      "  .hdr :global(.menu-button) { width: 44px; height: 44px; padding: 10px; }\n}\n",
    ],
  ],
  "app/globals.css": [
    [
      "/* W4-a NE-2 (owner-approved): a 44px touch target and 14px text for \"Read article / Read summary\", and a navy arrow\n   (the gold one was 2.1:1 on white). */\n.insight-card a { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; font-size: 14px; }\n.insight-card a span { color: var(--navy); }\n",
      ".insight-card a { display: inline-flex; align-items: center; gap: 5px; }\n",
    ],
  ],
};

export const W4A_CHANGED = Object.keys(EDITS).sort();
export const W4A_ADDED = ["scripts/w4a-approved.mts", "scripts/w4a-remediation-contract.mts"];

export function revertW4a(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`W4-a: expected edit not found in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
