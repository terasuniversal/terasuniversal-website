/**
 * W6-SEO-a1 (owner-approved, local only): the exact, named edits of the public SEO metadata package.
 *   app/training/[slug]/page.js  absolute "<Course> Training | TERAS UNIVERSAL" title and the course's search description
 *                                (content/en/course-seo.js, falling back to the catalogue summary) for meta and social tags.
 *   app/verify/page.tsx          a fuller description and the page's own share metadata (og:url /verify, not the homepage).
 *   content/en/calendar.js       the calendar's search title and description (the visible heading is unchanged).
 *   components/InsightsCentre.js the /insights listing shows only articles with a full body; the two placeholders keep
 *                                their URL, noindex and pending status.
 * revertW6seo(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once.
 * revertPublicFirst() applies it first (latest change first), so every earlier contract that pins these files keeps
 * proving that nothing else in them moved. Generated from git diff -U1 against main 96e58eac; JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "app/training/[slug]/page.js": [
    [
      "import { socialMetadata } from \"../../../lib/social-metadata\";\nimport { courseSeoDescriptions } from \"../../../content/en/course-seo\";\nimport { CANONICAL_ORIGIN } from \"../../../lib/canonical-origin\";\n",
      "import { socialMetadata } from \"../../../lib/social-metadata\";\nimport { CANONICAL_ORIGIN } from \"../../../lib/canonical-origin\";\n"
    ],
    [
      "export const revalidate = 60;\n// W6-SEO-a1 (owner-approved): an absolute title, because app/training/layout.js sets its own absolute title and so the\n// root \"%s | TERAS UNIVERSAL\" template never reached this page (the title was the bare course name). The description is\n// the course's search description (content/en/course-seo.js), falling back to the catalogue summary.\nexport async function generateMetadata({ params }) { const { slug } = await params; const course = findCourse(slug); if (!course) return { title: \"Training Programme | TERAS UNIVERSAL\" }; const pageTitle = `${course.title} Training | TERAS UNIVERSAL`; const description = courseSeoDescriptions[course.slug] || course.summary; return { title: { absolute: pageTitle }, description, alternates: { canonical: `/training/${course.slug}` }, ...socialMetadata({ title: pageTitle, description, path: `/training/${course.slug}` }) }; }\n\n",
      "export const revalidate = 60;\nexport async function generateMetadata({ params }) { const { slug } = await params; const course = findCourse(slug); return course ? { title: course.title, description: course.summary, alternates: { canonical: `/training/${course.slug}` }, ...socialMetadata({ title: `${course.title} | TERAS UNIVERSAL`, description: course.summary, path: `/training/${course.slug}` }) } : { title: \"Training Programme | TERAS UNIVERSAL\" }; }\n\n"
    ]
  ],
  "app/verify/page.tsx": [
    [
      "import { normalizeVerificationRpcResponse } from \"../../lib/public-verification-rpc\";\nimport { socialMetadata } from \"../../lib/social-metadata\";\nimport { VerificationResult, VerifyShell, firstIp, type VerifyRow } from \"./VerificationResult\";\n",
      "import { normalizeVerificationRpcResponse } from \"../../lib/public-verification-rpc\";\nimport { VerificationResult, VerifyShell, firstIp, type VerifyRow } from \"./VerificationResult\";\n"
    ],
    [
      "  const hasResult = !!sp.q;\n  // W6-SEO-a1 (owner-approved): a fuller description, and the page's own share metadata so og:url is /verify rather\n  // than the homepage inherited from the root layout. The robots rule and the verification itself are unchanged.\n  const title = hasResult ? \"Verification Result\" : \"Verify a Certificate\";\n  const description = \"Check that a certificate issued by TERAS UNIVERSAL SDN. BHD. is authentic, using its QR verification code or certificate number.\";\n  return {\n    title,\n    description,\n    alternates: { canonical: \"/verify\" },\n    robots: hasResult ? { index: false, follow: false } : { index: true, follow: true },\n    ...socialMetadata({ title: `${title} | TERAS UNIVERSAL`, description, path: \"/verify\" }),\n  };\n",
      "  const hasResult = !!sp.q;\n  return {\n    title: hasResult ? \"Verification Result\" : \"Verify a Certificate\",\n    description: \"Verify the authenticity of a certificate issued by TERAS UNIVERSAL SDN. BHD.\",\n    alternates: { canonical: \"/verify\" },\n    robots: hasResult ? { index: false, follow: false } : { index: true, follow: true },\n  };\n"
    ]
  ],
  "components/InsightsCentre.js": [
    [
      "\n// W6-SEO-a1 (owner-approved): only articles with a full body are listed. The placeholders keep their URL, noindex and\n// pending status; they are left out of the listing (and its topic filters) until their content is written and approved.\nconst listed = insights.filter((item) => Array.isArray(item.body));\nconst categories = [\"All\", ...new Set(listed.map(({ category }) => category))];\n\n",
      "\nconst categories = [\"All\", ...new Set(insights.map(({ category }) => category))];\n\n"
    ],
    [
      "  const [query, setQuery] = useState(\"\");\n  const visible = useMemo(() => listed.filter((item) => (category === \"All\" || item.category === category) && `${item.title} ${item.excerpt}`.toLowerCase().includes(query.toLowerCase().trim())), [category, query]);\n  return <div className=\"insights-centre\"><div className=\"insights-controls\"><label><span className=\"sr-only\">Search articles</span><input type=\"search\" value={query} onChange={(event) => setQuery(event.target.value)} placeholder=\"Search articles...\" /></label><div className=\"insights-filters\" role=\"toolbar\" aria-label=\"Filter articles by topic\">{categories.map((item) => <button key={item} type=\"button\" className={category === item ? \"active\" : \"\"} onFocus={(event) => event.currentTarget.scrollIntoView({ block: \"nearest\", inline: \"nearest\" })} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div></div><p className=\"insights-count\" aria-live=\"polite\"><strong>{visible.length}</strong> article{visible.length === 1 ? \"\" : \"s\"}{category === \"All\" ? \"\" : ` in ${category}`}</p><div className=\"insights-grid\">{visible.map((item) => <article className=\"insight-card\" key={item.slug}><span className=\"eyebrow\">{item.category}</span><h2>{item.title}</h2><p>{item.excerpt}</p><div><span>{Array.isArray(item.body) ? item.readTime : \"Full article in preparation\"}</span><a href={`/insights/${item.slug}`}>{Array.isArray(item.body) ? \"Read article\" : \"Read summary\"} <span aria-hidden=\"true\">&rarr;</span><span className=\"sr-only\">: {item.title}</span></a></div></article>)}</div>{visible.length === 0 && <p className=\"insights-empty\">No articles match your search.</p>}</div>;\n",
      "  const [query, setQuery] = useState(\"\");\n  const visible = useMemo(() => insights.filter((item) => (category === \"All\" || item.category === category) && `${item.title} ${item.excerpt}`.toLowerCase().includes(query.toLowerCase().trim())), [category, query]);\n  return <div className=\"insights-centre\"><div className=\"insights-controls\"><label><span className=\"sr-only\">Search articles</span><input type=\"search\" value={query} onChange={(event) => setQuery(event.target.value)} placeholder=\"Search articles...\" /></label><div className=\"insights-filters\" role=\"toolbar\" aria-label=\"Filter articles by topic\">{categories.map((item) => <button key={item} type=\"button\" className={category === item ? \"active\" : \"\"} onFocus={(event) => event.currentTarget.scrollIntoView({ block: \"nearest\", inline: \"nearest\" })} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div></div><p className=\"insights-count\" aria-live=\"polite\"><strong>{visible.length}</strong> article{visible.length === 1 ? \"\" : \"s\"}{category === \"All\" ? \"\" : ` in ${category}`}</p><div className=\"insights-grid\">{visible.map((item) => <article className=\"insight-card\" key={item.slug}><span className=\"eyebrow\">{item.category}</span><h2>{item.title}</h2><p>{item.excerpt}</p><div><span>{Array.isArray(item.body) ? item.readTime : \"Full article in preparation\"}</span><a href={`/insights/${item.slug}`}>{Array.isArray(item.body) ? \"Read article\" : \"Read summary\"} <span aria-hidden=\"true\">&rarr;</span><span className=\"sr-only\">: {item.title}</span></a></div></article>)}</div>{visible.length === 0 && <p className=\"insights-empty\">No articles match your search.</p>}</div>;\n"
    ]
  ],
  "content/en/calendar.js": [
    [
      "  meta: {\n    // W6-SEO-a1 (owner-approved): search title and description only; the page heading below is unchanged.\n    title: \"Public Training Calendar\",\n    description: \"Upcoming public industrial safety and technical training sessions from TERAS UNIVERSAL in Malaysia, with dates, venues and how to enquire.\",\n  },\n",
      "  meta: {\n    title: \"Training Calendar\",\n    description: \"Browse TERAS UNIVERSAL training programme dates and delivery options in Malaysia.\",\n  },\n"
    ]
  ]
};

export const W6SEO_CHANGED = Object.keys(EDITS).sort();
export const W6SEO_ADDED = ["content/en/course-seo.js", "scripts/w6seo-a1-contract.mts", "scripts/w6seo-approved.mts"];

export function revertW6seo(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W6-SEO-a1: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
