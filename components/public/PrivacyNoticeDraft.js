import { Fragment } from "react";

/**
 * Renders the structured copy of the Owner's privacy-notice DRAFT (data/privacyNoticeDraft.js) as plain React
 * elements. No HTML is injected. NOT LEGALLY REVIEWED. NOT APPROVED FOR PUBLICATION.
 */
function Inline({ parts }) {
  return parts.map((part, index) => {
    if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;
    if (part.br) return <br key={index} />;
    if (part.mark) return <mark key={index} className="privacy-mark">{part.mark}</mark>;
    if (part.strong) return <strong key={index}>{part.strong}</strong>;
    return null;
  });
}

function Block({ block }) {
  if (block.type === "h2") return <h2><Inline parts={block.content} /></h2>;
  if (block.type === "h3") return <h3><Inline parts={block.content} /></h3>;
  if (block.type === "p") return <p><Inline parts={block.content} /></p>;
  if (block.type === "ul") return <ul>{block.items.map((item, i) => <li key={i}><Inline parts={item} /></li>)}</ul>;
  if (block.type === "table") {
    return (
      <div className="privacy-table-wrap">
        <table>
          <thead><tr>{block.head.map((cell, i) => <th key={i} scope="col"><Inline parts={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Inline parts={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return null;
}

export default function PrivacyNoticeDraft({ sections }) {
  return sections.map((section) => (
    <section className="privacy-notice-section" lang={section.lang} key={section.lang}>
      {section.blocks.map((block, index) => <Block block={block} key={index} />)}
    </section>
  ));
}
