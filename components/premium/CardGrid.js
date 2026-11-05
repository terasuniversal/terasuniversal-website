import inner from "./inner.module.css";

// Plain (non-link) cards in the kit's tile style: small label, title, text and optional extras.
// items: [{ label, title, text, meta, tags, points }]  (tags: short labels as chips; points: full sentences as a dashed list)
export default function CardGrid({ items, label }) {
  return (
    <ul className={inner.tiles} aria-label={label}>
      {items.map((item) => (
        <li className={`${inner.tile} ${inner.tilePlain}`} key={item.title}>
          {item.label && <span className={inner.cat}>{item.label}</span>}
          <h3>{item.title}</h3>
          {item.meta && <p className={inner.cardMeta}>{item.meta}</p>}
          {item.text && <p>{item.text}</p>}
          {item.points?.length > 0 && <ul className={inner.pointList}>{item.points.map((point) => <li key={point}>{point}</li>)}</ul>}
          {item.tags?.length > 0 && <ul className={inner.tags}>{item.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
        </li>
      ))}
    </ul>
  );
}
