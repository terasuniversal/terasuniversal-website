import kit from "../premium/premium.module.css";
import { publicBody } from "../premium/fonts";
import styles from "./legal.module.css";

// Renders an INTERNAL DRAFT legal document (S5B-1B Round 2). Server component, no client JavaScript.
// "[[ID: note]]" markers in the content are open owner/legal decisions: they are shown visibly as "Pending" so a
// reviewer can never mistake a gap for approved wording, and they are never filled in here.
const PENDING = /\[\[([A-Z]+(?:-\d+)?)(?::\s*([^\]]+))?\]\]/g;

function Text({ value, pendingLabel }) {
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(PENDING)) {
    if (match.index > last) parts.push(value.slice(last, match.index));
    parts.push(
      <span className={styles.pending} key={match.index}>
        <strong>{pendingLabel} {match[1]}</strong>
        {match[2] ? `: ${match[2]}` : ""}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

function Block({ block, pendingLabel }) {
  if (block.p) return <p><Text value={block.p} pendingLabel={pendingLabel} /></p>;
  if (block.list) return <ul className={styles.list}>{block.list.map((item) => <li key={item}><Text value={item} pendingLabel={pendingLabel} /></li>)}</ul>;
  if (block.rows) {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          {block.head && <thead><tr>{block.head.map((cell) => <th scope="col" key={cell}>{cell}</th>)}</tr></thead>}
          <tbody>
            {block.rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td><Text value={value} pendingLabel={pendingLabel} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

export default function LegalDocument({ doc, status }) {
  const id = (index) => `section-${index + 1}`;
  return (
    <div lang={doc.lang} className={`${kit.px} ${publicBody.variable} ${styles.page}`}>
      <div className={`${kit.wrap} ${styles.inner}`}>
        {status && <p className={styles.draft} role="note"><strong>{status}</strong></p>}
        {doc.switchLink && (
          <p className={styles.switch}>
            <a href={doc.switchLink.href} lang={doc.switchLink.lang} hrefLang={doc.switchLink.lang}>{doc.switchLink.label}</a>
          </p>
        )}
        <h1 className={styles.title}>{doc.title}</h1>
        <p className={styles.version}>{doc.version}</p>
        {doc.termsNote && <p className={styles.note}><Text value={doc.termsNote} pendingLabel={doc.pendingLabel} /></p>}
        <nav className={styles.toc} aria-labelledby={`${doc.lang}-toc-title`}>
          <h2 id={`${doc.lang}-toc-title`} className={styles.tocTitle}>{doc.tocLabel}</h2>
          <ol>
            {doc.sections.map((section, index) => <li key={section.title}><a href={`#${id(index)}`}>{index + 1}. {section.title}</a></li>)}
          </ol>
        </nav>
        {doc.sections.map((section, index) => (
          <section className={styles.section} id={id(index)} aria-labelledby={`${id(index)}-title`} key={section.title}>
            <h2 id={`${id(index)}-title`} className={styles.h2}>{index + 1}. {section.title}</h2>
            {section.blocks.map((block, blockIndex) => <Block block={block} pendingLabel={doc.pendingLabel} key={blockIndex} />)}
          </section>
        ))}
      </div>
    </div>
  );
}
