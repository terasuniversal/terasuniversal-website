"use client";

import { useMemo, useState } from "react";
import { resources } from "../data/resources";

const categories = ["All", ...new Set(resources.map((item) => item.category))];

export default function ResourceCentre() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => resources.filter((item) => (category === "All" || item.category === category) && `${item.title} ${item.text}`.toLowerCase().includes(query.toLowerCase().trim())),
    [category, query]
  );

  return (
    <div className="resource-centre">
      <div className="insights-controls">
        <label><span className="sr-only">Search resources</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources..." /></label>
        <div className="insights-filters" role="toolbar" aria-label="Filter resources by category">
          {categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}
        </div>
      </div>
      <div className="resource-grid">
        {visible.map(({ title, category: itemCategory, text, action, href, note }, index) => (
          <article className="resource-card" key={title}>
            <span className="resource-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="resource-note">{note}</span>
            <h2>{title}</h2>
            <p>{text}</p>
            <span className="resource-category-tag">{itemCategory}</span>
            <a href={href}>{action} <span aria-hidden="true">&rarr;</span></a>
          </article>
        ))}
      </div>
      {visible.length === 0 && <p className="search-empty">No resources match your search.</p>}
    </div>
  );
}
