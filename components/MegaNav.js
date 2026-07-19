const groups = [
  { label: "Services", links: [["Industrial Safety", "/services#safety"], ["Technical Competency", "/services#technical"], ["Industrial Consultancy", "/services#consultancy"], ["Workforce Development", "/services#workforce"]] },
  { label: "Training", links: [["All Training", "/training"], ["Compare Programmes", "/training/compare"], ["Scaffolding Competency", "/training/scaffolding-competency"], ["Working at Height", "/training/working-at-height"], ["Confined Space Safety", "/training/confined-space-safety"], ["Training Calendar", "/calendar"], ["Request Proposal", "/request-proposal"]] },
  { label: "Industries", links: [["All Industries We Serve", "/industries"], ["Oil & Gas", "/industries/oil-and-gas"], ["Construction", "/industries/construction"], ["Manufacturing", "/industries/manufacturing"], ["Power & Energy", "/industries/power-and-energy"], ["Marine & Offshore", "/industries/marine-and-offshore"], ["Government", "/industries/government"], ["GLC", "/industries/glc"]] },
  { label: "Resources", links: [["Search", "/search"], ["Resources Centre", "/resources"], ["News & Insights", "/insights"], ["Media Centre", "/media"], ["FAQ Centre", "/faq"], ["Gallery", "/gallery"]] },
  { label: "Company", links: [["About TERAS", "/about"], ["Testimonials & Stories", "/stories"], ["Careers", "/careers"], ["Verify Certificate", "/verify"], ["Contact", "/contact"]] },
];

export default function MegaNav() {
  return (
    <nav className="mega-nav" aria-label="Main navigation">
      {groups.map((group) => (
        <details className="mega-nav-group" key={group.label}>
          <summary>{group.label}</summary>
          <div className="mega-nav-panel">
            {group.links.map(([label, path]) => <a href={path} key={label}>{label}</a>)}
          </div>
        </details>
      ))}
      <a className="mega-nav-verify" href="/verify">Verify Certificate</a>
      <a className="nav-proposal" href="/request-proposal">Request Proposal</a>
      <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
    </nav>
  );
}
