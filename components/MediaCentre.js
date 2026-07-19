"use client";

import { useMemo, useState } from "react";
import { mediaItems, mediaTypes } from "../data/media";

const PAGE_SIZE = 9;

export default function MediaCentre() {
  const [type, setType] = useState("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return mediaItems
      .filter((item) => type === "All" || item.type === type)
      .filter((item) => `${item.title} ${item.excerpt}`.toLowerCase().includes(query.toLowerCase().trim()));
  }, [type, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleFilterChange = (nextType) => { setType(nextType); setPage(1); };
  const handleQueryChange = (value) => { setQuery(value); setPage(1); };

  return (
    <div className="media-centre">
      <div className="insights-controls">
        <label><span className="sr-only">Search media centre</span><input type="search" value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="Search news, announcements and events..." /></label>
        <div className="insights-filters" role="toolbar" aria-label="Filter media items">
          {["All", ...mediaTypes].map((item) => (
            <button key={item} type="button" className={type === item ? "active" : ""} onClick={() => handleFilterChange(item)} aria-pressed={type === item}>{item}</button>
          ))}
        </div>
      </div>

      {mediaItems.length === 0 ? (
        <div className="verified-empty" role="status">
          <h3>Nothing published yet</h3>
          <p>News, announcements, event details and press releases will appear here once they are confirmed. In the meantime, explore our <a href="/insights">safety insights</a> or follow us on WhatsApp for direct updates.</p>
        </div>
      ) : (
        <>
          <div className="insights-grid">
            {visible.map((item) => (
              <article className="insight-card" key={item.slug}>
                <span className="eyebrow">{item.type}</span>
                <h2>{item.title}</h2>
                <p>{item.excerpt}</p>
                <div><span>{item.date}</span></div>
              </article>
            ))}
          </div>
          {visible.length === 0 && <p className="insights-empty">No media items match your search.</p>}
          {totalPages > 1 && (
            <div className="pagination-controls" role="navigation" aria-label="Media centre pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
