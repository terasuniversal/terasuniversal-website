// Sticky "jump to section" mini-nav for the long homepage — added in response
// to feedback that the homepage feels long/flat to scroll through. Sits just
// below the main sticky header and lets a visitor skip straight to a section
// instead of scrolling past everything. Plain anchor links — no client JS
// needed since `html { scroll-behavior: smooth }` is already set sitewide.
const links = [
  ["Services", "#services"],
  ["Industries", "#industries"],
  ["Training", "#training"],
  ["Contact", "#contact"],
];

export default function JumpNav() {
  return (
    <nav className="jump-nav" aria-label="Jump to section">
      <div className="container jump-nav-inner">
        {links.map(([label, href]) => (
          <a href={href} key={href}>{label}</a>
        ))}
      </div>
    </nav>
  );
}
