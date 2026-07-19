export default function VerifiedEmptyState({ title, body, cta }) {
  return (
    <div className="verified-empty" role="status">
      <h3>{title}</h3>
      <p>{body}</p>
      {cta}
    </div>
  );
}
