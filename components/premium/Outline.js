import inner from "./inner.module.css";

// Numbered list (objectives, modules, steps). `check` swaps the numbers for check marks.
export default function Outline({ items, check = false, single = false, label }) {
  return <ol className={check ? inner.checks : `${inner.outline} ${single ? inner.outlineOne : ""}`} aria-label={label}>{items.map((item) => <li key={item}>{item}</li>)}</ol>;
}
