import inner from "./inner.module.css";

// Programme facts as a ledger. Values the catalogue has not confirmed ("to be confirmed") are left out rather than shown.
export default function FactLedger({ facts }) {
  const shown = facts.filter(([, value]) => Boolean(value) && !/to be confirmed/i.test(String(value)));
  if (!shown.length) return null;
  return <dl className={inner.ledger}>{shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
