"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const filters = ["All", "Training", "Scaffolding", "Working at Height", "Confined Space", "Corporate", "Assessment"];
function categoryFor(title) {
  const value = title.toLowerCase();
  if (value.includes("scaffold")) return "Scaffolding";
  if (value.includes("height")) return "Working at Height";
  if (value.includes("confined") || value.includes("rescue")) return "Confined Space";
  if (value.includes("assessment") || value.includes("certificate")) return "Assessment";
  if (value.includes("corporate") || value.includes("client") || value.includes("team") || value.includes("coaching")) return "Corporate";
  return "Training";
}

export default function TrainingGallery({ items, showFullGalleryLink = true }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const [filter, setFilter] = useState("All");
  const filteredItems = items.filter(([title]) => filter === "All" || categoryFor(title) === filter);
  const activeItem = activeIndex === null ? null : filteredItems[activeIndex];

  useEffect(() => {
    if (activeIndex === null) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setActiveIndex(null);
      if (event.key === "ArrowRight") setActiveIndex((index) => (index + 1) % items.length);
      if (event.key === "ArrowLeft") setActiveIndex((index) => (index - 1 + items.length) % items.length);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [activeIndex, filteredItems.length]);

  return (
    <>
      <div className="gallery-filter-bar" role="toolbar" aria-label="Filter training gallery">{filters.map((item) => <button className={filter === item ? "active" : ""} type="button" key={item} onClick={() => { setFilter(item); setActiveIndex(null); }} aria-pressed={filter === item}>{item}</button>)}</div>
      <div className="training-gallery" aria-label={`${filter} training gallery`}>
        {filteredItems.map(([title, image], index) => (
          <button className="gallery-card gallery-trigger" type="button" key={title} onClick={() => setActiveIndex(index)} aria-label={`Open ${title} image`}>
            <Image src={image} alt={`${title} training activity visual.`} width={1200} height={800} sizes="(max-width: 590px) 100vw, (max-width: 920px) 50vw, 33vw" loading="lazy" />
            <span className="gallery-card-title">{title}</span>
          </button>
        ))}
      </div>
      {showFullGalleryLink && <a className="btn btn-outline gallery-view-all" href="/gallery">View Full Gallery <span aria-hidden="true">&rarr;</span></a>}
      {activeItem && (
        <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={`${activeItem[0]} enlarged image`} onClick={() => setActiveIndex(null)}>
          <div className="gallery-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="gallery-lightbox-close" type="button" onClick={() => setActiveIndex(null)} aria-label="Close image viewer">&times;</button>
            <Image src={activeItem[1]} alt={`${activeItem[0]} training activity visual.`} width={1600} height={1067} sizes="(max-width: 920px) 92vw, 78vw" priority />
            <p>{activeItem[0]}</p>
            <button className="gallery-lightbox-control gallery-lightbox-prev" type="button" onClick={() => setActiveIndex((index) => (index - 1 + filteredItems.length) % filteredItems.length)} aria-label="Previous image">&larr;</button>
            <button className="gallery-lightbox-control gallery-lightbox-next" type="button" onClick={() => setActiveIndex((index) => (index + 1) % filteredItems.length)} aria-label="Next image">&rarr;</button>
          </div>
        </div>
      )}
    </>
  );
}
