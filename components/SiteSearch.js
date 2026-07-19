"use client";

import { useMemo, useState } from "react";

const entries = [
  ["Training", "Industrial safety and competency programmes for safety-critical workforces.", "/training", "Courses"],
  ["Scaffolding Competency", "Structured scaffolding knowledge, safe work practices and practical task discipline.", "/training/scaffolding-competency", "Courses"],
  ["Services", "Industrial safety, technical competency, consultancy and workforce development.", "/services", "Pages"],
  ["About TERAS UNIVERSAL", "Our values, approach and commitment to safer, more capable organisations.", "/about", "Pages"],
  ["Frequently Asked Questions", "Answers about onsite, in-house and customised training arrangements.", "/#faq", "FAQ"],
  ["Request a Proposal", "Share your organisation's training requirements with our team.", "/request-proposal", "Pages"],
  ["Resources", "Company information, course materials and training resources.", "/resources", "Resources"],
];

export default function SiteSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => (category === "All" || entry[3] === category) && (!normalized || entry.slice(0, 2).join(" ").toLowerCase().includes(normalized)));
  }, [category, query]);

  return (
    <section className="search-tool" aria-labelledby="search-heading">
      <div className="search-controls">
        <label className="sr-only" htmlFor="site-search-input">Search the website</label>
        <input id="site-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses, pages, resources or FAQ..." type="search" />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter search category">
          <option>All</option><option>Courses</option><option>Pages</option><option>Resources</option><option>FAQ</option>
        </select>
      </div>
      <p className="search-count" aria-live="polite">{results.length} result{results.length === 1 ? "" : "s"}</p>
      <div className="search-results">
        {results.map(([title, description, href, type]) => <a className="search-result-card" href={href} key={href}><span>{type}</span><h3>{title}</h3><p>{description}</p><strong>Open result <span aria-hidden="true">&rarr;</span></strong></a>)}
        {!results.length && <p className="search-empty">No matching results. Try a broader search term.</p>}
      </div>
    </section>
  );
}
