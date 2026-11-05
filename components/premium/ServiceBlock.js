import kit from "./premium.module.css";
import inner from "./inner.module.css";

// One service: title and description with its scope list on the left; outcome and action on the right.
export default function ServiceBlock({ id, eyebrow, title, text, items, outcome, cta }) {
  return (
    <article id={id} className={inner.twoCol} aria-labelledby={`${id}-title`}>
      <div>
        <span className={`${inner.eyebrow} ${inner.onLight}`}>{eyebrow}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{text}</p>
        <ul className={inner.tags}>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <aside className={inner.aside}>
        <p className={inner.cat}>Business outcome</p>
        <p className={inner.strong}>{outcome}</p>
        <a className={`${kit.btn} ${kit.btnNavy}`} href={cta.href}>{cta.label}</a>
      </aside>
    </article>
  );
}
