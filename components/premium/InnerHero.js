import kit from "./premium.module.css";
import inner from "./inner.module.css";

// Statement hero for inner pages: breadcrumb, eyebrow, one h1, one supporting sentence, actions and an optional
// facts column. It is typographic on purpose: the two homepage photographs are not repeated on unrelated pages.
// `crumbs` is [{ label, href? }]; the last item is the current page.
export default function InnerHero({ crumbs, eyebrow, title, lead, actions, chips, facts, titleId = "page-title" }) {
  const shownFacts = (facts || []).filter(([, value]) => Boolean(value) && !/to be confirmed/i.test(String(value)));
  return (
    <section className={inner.hero} aria-labelledby={titleId}>
      <div className={kit.wrap}>
        {crumbs?.length > 0 && (
          <nav className={inner.crumbs} aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={crumb.label}>
                  {index === crumbs.length - 1 || !crumb.href ? <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span> : <a href={crumb.href}>{crumb.label}</a>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className={`${inner.heroGrid} ${shownFacts.length ? "" : inner.heroSolo}`}>
          <div>
            {eyebrow && <span className={inner.eyebrow}>{eyebrow}</span>}
            <h1 id={titleId}>{title}</h1>
            {lead && <p className={inner.lead}>{lead}</p>}
            {actions}
            {chips?.length > 0 && <ul className={inner.heroChips} aria-label="Training strengths">{chips.map((chip) => <li key={chip}>{chip}</li>)}</ul>}
          </div>
          {shownFacts.length > 0 && (
            <dl className={inner.heroFacts}>
              {shownFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}
