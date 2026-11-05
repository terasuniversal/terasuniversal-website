import inner from "./inner.module.css";

// Dated list: year on the left, event on the right. items: [{ year, text }]
export default function Timeline({ items, label }) {
  return (
    <ol className={inner.timeline} aria-label={label}>
      {items.map((item, index) => <li key={`${item.year}-${index}`}><span>{item.year}</span><p>{item.text}</p></li>)}
    </ol>
  );
}
