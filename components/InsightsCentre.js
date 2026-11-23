"use client";

import { useMemo, useState } from "react";
import { insights } from "../data/insights";

// W6-SEO-a1 (owner-approved): only articles with a full body are listed. The placeholders keep their URL, noindex and
// pending status; they are left out of the listing (and its topic filters) until their content is written and approved.
const listed = insights.filter((item) => Array.isArray(item.body));
const categories = ["All", ...new Set(listed.map(({ category }) => category))];

export default function InsightsCentre() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => listed.filter((item) => (category === "All" || item.category === category) && `${item.title} ${item.excerpt}`.toLowerCase().includes(query.toLowerCase().trim())), [category, query]);
  return <div className="insights-centre"><div className="insights-controls"><label><span className="sr-only">Search articles</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles..." /></label><div className="insights-filters" role="toolbar" aria-label="Filter articles by topic">{categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div></div><p className="insights-count" aria-live="polite"><strong>{visible.length}</strong> article{visible.length === 1 ? "" : "s"}{category === "All" ? "" : ` in ${category}`}</p><div className="insights-grid">{visible.map((item) => <article className="insight-card" key={item.slug}><span className="eyebrow">{item.category}</span><h2>{item.title}</h2><p>{item.excerpt}</p><div><span>{Array.isArray(item.body) ? item.readTime : "Full article in preparation"}</span><a href={`/insights/${item.slug}`}>{Array.isArray(item.body) ? "Read article" : "Read summary"} <span aria-hidden="true">&rarr;</span><span className="sr-only">: {item.title}</span></a></div></article>)}</div>{visible.length === 0 && <p className="insights-empty">No articles match your search.</p>}</div>;
}
