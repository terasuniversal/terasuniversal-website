"use client";

import { useMemo, useState } from "react";
import { insights } from "../data/insights";

const categories = ["All", ...new Set(insights.map(({ category }) => category))];

export default function InsightsCentre() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => insights.filter((item) => (category === "All" || item.category === category) && `${item.title} ${item.excerpt}`.toLowerCase().includes(query.toLowerCase().trim())), [category, query]);
  return <div className="insights-centre"><div className="insights-controls"><label><span className="sr-only">Search insights</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search safety insights..." /></label><div className="insights-filters" role="toolbar" aria-label="Filter insights">{categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div></div><div className="insights-grid">{visible.map((item) => <article className="insight-card" key={item.slug}><span className="eyebrow">{item.category}</span><h2>{item.title}</h2><p>{item.excerpt}</p><div><span>{item.readTime}</span><a href={`/insights/${item.slug}`}>Read insight <span aria-hidden="true">&rarr;</span></a></div></article>)}</div>{visible.length === 0 && <p className="insights-empty">No insights match your search.</p>}</div>;
}
