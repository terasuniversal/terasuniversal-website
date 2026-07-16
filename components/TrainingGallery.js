"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function TrainingGallery({ items, showFullGalleryLink = true }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const activeItem = activeIndex === null ? null : items[activeIndex];

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
  }, [activeIndex, items.length]);

  return (
    <>
      <div className="training-gallery" aria-label="Featured training gallery">
        {items.map(([title, image], index) => (
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
            <button className="gallery-lightbox-control gallery-lightbox-prev" type="button" onClick={() => setActiveIndex((index) => (index - 1 + items.length) % items.length)} aria-label="Previous image">&larr;</button>
            <button className="gallery-lightbox-control gallery-lightbox-next" type="button" onClick={() => setActiveIndex((index) => (index + 1) % items.length)} aria-label="Next image">&rarr;</button>
          </div>
        </div>
      )}
    </>
  );
}