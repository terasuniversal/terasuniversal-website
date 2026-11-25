/**
 * W10-UX-01 Option B (owner-approved for local development, W9-LAUNCH-PREP Lane L-C): the root loading boundary
 * app/loading.js moves to app/calendar/loading.js, the one public route that waits on live schedule data. Every other
 * public page is then rendered without a Suspense fallback and is readable without JavaScript.
 *
 * The moved file carries exactly two named edits: an explanatory comment and a <noscript> message with plain links, so
 * the calendar fallback is meaningful without JavaScript. approvedRootLoading() undoes ONLY those edits, fails closed
 * when an edit is not found exactly once, and refuses if the root file still exists (a copy instead of a move). The
 * contracts that pinned the root loading boundary compare its result with the contract base.
 *
 * Finding during local QA (reported to the owner, not silently worked around): the root boundary also supplied the
 * Suspense boundary /admin/login needs for useSearchParams(), and the loading screen for every admin route. Without it
 * the production build fails ("useSearchParams() should be wrapped in a suspense boundary at page /admin/login"). The
 * minimal fix keeps admin behaviour exactly as before: app/admin/loading.js is a BYTE-IDENTICAL copy of the original
 * root boundary, scoped to /admin only. No admin source file changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const W10UX_FROM = "app/loading.js";
export const W10UX_TO = "app/calendar/loading.js";
export const W10UX_ADMIN = "app/admin/loading.js";

/** The admin-scoped boundary must be the original root boundary, byte for byte (LF-normalised). */
export function approvedAdminLoading(root: URL): string {
  return readFileSync(new URL(W10UX_ADMIN, root), "utf8").replace(/\r\n/g, "\n");
}

const EDITS: [string, string][] = [
  [
    "import Image from \"next/image\";\n\n// W10-UX-01 Option B (W9-LAUNCH-PREP L-C): the loading boundary used to sit at the app root, so every public page was\n// streamed behind it and stayed hidden without JavaScript. It now wraps only /calendar, the one public route that\n// waits on live schedule data. Streamed content is still revealed by script here, so the fallback itself carries a\n// <noscript> message with plain links instead of an endless loading bar.\nexport default function Loading() {\n",
    "import Image from \"next/image\";\n\nexport default function Loading() {\n",
  ],
  [
    "        <p>Building Competence. Creating Opportunities.</p>\n        <noscript>\n          <p>The training calendar needs JavaScript. You can still browse our <a href=\"/training\">training courses</a> or <a href=\"/contact\">contact us</a> for session dates.</p>\n        </noscript>\n      </div>\n",
    "        <p>Building Competence. Creating Opportunities.</p>\n      </div>\n",
  ],
];

export function revertW10ux(text: string): string {
  let out = text.replace(/\r\n/g, "\n");
  for (const [now, before] of EDITS) {
    if (out.split(now).length !== 2) throw new Error(`W10-UX-01: expected edit not found exactly once in ${W10UX_TO}`);
    out = out.replace(now, () => before);
  }
  return out;
}

/** The bytes the original root app/loading.js must have had (LF), proven from the moved file. */
export function approvedRootLoading(root: URL): string {
  if (existsSync(new URL(W10UX_FROM, root))) throw new Error(`W10-UX-01: ${W10UX_FROM} must be moved, not copied`);
  return revertW10ux(readFileSync(new URL(W10UX_TO, root), "utf8"));
}

/**
 * CE-1 (Owner technical GO): the public-design-foundation contract exempts exactly one protected path,
 * app/admin/loading.js, and only while (1) the root app/loading.js is gone (a move, not a copy), (2) the admin file is
 * byte-identical (LF) to app/loading.js at the contract base, and (3) the calendar boundary reverts, through its two
 * named edits, to that same original. Any other admin path, any byte change, or a copy is still rejected. No wildcard.
 */
export function w10uxAdminBoundaryApproved(root: URL, path: string, base: string): boolean {
  if (path !== W10UX_ADMIN) return false;
  try {
    const original = execFileSync("git", ["-c", "core.autocrlf=false", "show", `${base}:${W10UX_FROM}`], { cwd: fileURLToPath(root), encoding: "utf8" }).replace(/\r\n/g, "\n");
    return approvedAdminLoading(root) === original && approvedRootLoading(root) === original;
  } catch { return false; }
}

/** CE-1 named edits to scripts/public-design-foundation-contract.mts, as [now, before]. */
export const W10UX_FOUNDATION = "scripts/public-design-foundation-contract.mts";
const FOUNDATION_EDITS: [string, string][] = [
  ["import { W9G3_PROTECTED_ADDED } from \"./w9g3-approved.mts\"; // W9-G3.3: the two exact W9-G3 API route files\nimport { w10uxAdminBoundaryApproved } from \"./w10ux-approved.mts\"; // CE-1: the one admin loading boundary, content-gated\n", "import { W9G3_PROTECTED_ADDED } from \"./w9g3-approved.mts\"; // W9-G3.3: the two exact W9-G3 API route files\n"],
  ["&& !PF_CHANGED.includes(path) && !w4aOnly(path) && !w10uxAdminBoundaryApproved(new URL(\"../\", import.meta.url), path, CONTRACT_BASE) /* CE-1 exact path */);", "&& !PF_CHANGED.includes(path) && !w4aOnly(path));"],
  ["!W9G3_PROTECTED_ADDED.includes(path) /* W9-G3.3 exact paths */ && !w10uxAdminBoundaryApproved(new URL(\"../\", import.meta.url), path, CONTRACT_BASE) /* CE-1 exact path */);", "!W9G3_PROTECTED_ADDED.includes(path) /* W9-G3.3 exact paths */);"],
];
/** Undoes ONLY the CE-1 edits (fails closed when an edit is not found exactly once); keeps the input's line endings. */
export function revertW10uxFoundation(text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of FOUNDATION_EDITS) {
    if (out.split(eol(now)).length !== 2) throw new Error(`CE-1: expected edit not found exactly once in ${W10UX_FOUNDATION}`);
    out = out.replace(eol(now), () => eol(before));
  }
  return out;
}
