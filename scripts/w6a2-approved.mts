/**
 * W6-SEO-a2 G1 (owner-approved, local only): the exact, named editorial corrections in data/insights.js.
 *   readTime for the four complete articles from one consistent measure (body words / 200 per minute, rounded up):
 *     working-at-height 9 -> 6, competency-based-training 8 -> 4, oil-and-gas 9 -> 6, training-needs-analysis 8 -> 5.
 *   oil-and-gas-workforce-readiness metaDescription shortened to 151 characters (no change of meaning).
 *   Explicit CTAs to existing pages for competency-based-training (/corporate-training) and training-needs-analysis
 *   (/request-proposal); before this, the article page rendered generic fallback CTAs for them.
 * Every article stays reviewStatus "pending" and noindex; no author or date is added; the placeholders are untouched.
 * revertW6a2(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once. Generated from
 * git diff -U1 against main b597a353; strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "data/insights.js": [
    [
      "    excerpt: \"A practical, high-level guide for HSE managers and supervisors reviewing elevated work, access, communication and workforce capability.\",\n    readTime: \"6 min read\",\n    audience: \"HSE Managers and Supervisors\",\n",
      "    excerpt: \"A practical, high-level guide for HSE managers and supervisors reviewing elevated work, access, communication and workforce capability.\",\n    readTime: \"9 min read\",\n    audience: \"HSE Managers and Supervisors\",\n"
    ],
    [
      "    excerpt: \"Understand the difference between attending a course and demonstrating the knowledge, practical skills and workplace behaviours a role requires.\",\n    readTime: \"4 min read\",\n    audience: \"Training Managers and HR/L&D\",\n",
      "    excerpt: \"Understand the difference between attending a course and demonstrating the knowledge, practical skills and workplace behaviours a role requires.\",\n    readTime: \"8 min read\",\n    audience: \"Training Managers and HR/L&D\",\n"
    ],
    [
      "    relatedIndustries: [],\n    ctaLabel: \"Discuss a Competency-Based Training Plan\",\n    ctaHref: \"/corporate-training\",\n    body: [\n",
      "    relatedIndustries: [],\n    body: [\n"
    ],
    [
      "    excerpt: \"A practical framework for HSE, project and workforce managers connecting role-based capability, onboarding, supervision and learning follow-up.\",\n    readTime: \"6 min read\",\n    audience: \"Oil & Gas HSE, Project and Workforce Managers\",\n    metaDescription: \"A practical framework for building Oil & Gas workforce readiness through role-based competency, onboarding, supervision and coordinated training plans.\",\n    reviewStatus: \"pending\",\n",
      "    excerpt: \"A practical framework for HSE, project and workforce managers connecting role-based capability, onboarding, supervision and learning follow-up.\",\n    readTime: \"9 min read\",\n    audience: \"Oil & Gas HSE, Project and Workforce Managers\",\n    metaDescription: \"A practical framework for building Oil & Gas workforce readiness through role-based competency, onboarding, supervision, evidence and coordinated training plans.\",\n    reviewStatus: \"pending\",\n"
    ],
    [
      "    excerpt: \"A practical framework for identifying, prioritising and reviewing workforce training needs based on roles, capability gaps and operational requirements.\",\n    readTime: \"5 min read\",\n    audience: \"HR/L&D and HSE Managers\",\n",
      "    excerpt: \"A practical framework for identifying, prioritising and reviewing workforce training needs based on roles, capability gaps and operational requirements.\",\n    readTime: \"8 min read\",\n    audience: \"HR/L&D and HSE Managers\",\n"
    ],
    [
      "    relatedIndustries: [\"/industries\"],\n    ctaLabel: \"Request a Training Proposal\",\n    ctaHref: \"/request-proposal\",\n    body: [\n",
      "    relatedIndustries: [\"/industries\"],\n    body: [\n"
    ]
  ]
};

export const W6A2_CHANGED = Object.keys(EDITS).sort();
export const W6A2_ADDED = ["scripts/w6a2-approved.mts", "scripts/w6a2-editorial-contract.mts"];

export function revertW6a2(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W6-SEO-a2: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
