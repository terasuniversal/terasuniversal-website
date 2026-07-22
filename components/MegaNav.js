"use client";

import { usePathname } from "next/navigation";

const groups = [
  { label: "Services", links: [["Industrial Safety", "/services#safety"], ["Technical Competency", "/services#technical"], ["Industrial Consultancy", "/services#consultancy"], ["Workforce Development", "/services#workforce"]] },
  { label: "Training", links: [["All Training", "/training"], ["Scaffolding Competency", "/training/scaffolding-competency"], ["Working at Height", "/training/working-at-height"], ["Confined Space Safety", "/training/confined-space-safety"], ["Training Calendar", "/calendar"], ["Request Proposal", "/request-proposal"]] },
  { label: "Industries", links: [["All Industries", "/industries"], ["Oil & Gas", "/industries/oil-gas"], ["Construction", "/industries/construction"], ["Manufacturing", "/industries/manufacturing"], ["Government & GLC", "/industries/government-glc"]] },
  { label: "Resources", links: [["Search", "/search"], ["Resources Centre", "/resources"], ["News & Insights", "/insights"], ["FAQ Centre", "/faq"], ["Gallery", "/gallery"]] },
  { label: "Company", links: [["About TERAS", "/about"], ["Testimonials & Stories", "/stories"], ["Verify Certificate", "/verify"], ["Contact", "/contact"]] },
];

// Marks the current page in the mega nav (feedback: "menu tak tunjukkan
// halaman mana pengunjung sedang berada"). A link is active if its path
// (ignoring any #hash) is the current page or an ancestor of it, so e.g.
// "/training" is highlighted while viewing "/training/scaffolding-competency".
function isActivePath(pathname, path) {
  const base = path.split("#")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

export default function MegaNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="mega-nav" aria-label="Main navigation">
      {groups.map((group) => {
        const groupActive = group.links.some(([, path]) => isActivePath(pathname, path));
        return (
          <details className="mega-nav-group" key={group.label}>
            <summary className={groupActive ? "is-active" : undefined} aria-current={groupActive ? "true" : undefined}>{group.label}</summary>
            <div className="mega-nav-panel">
              {group.links.map(([label, path]) => {
                const active = isActivePath(pathname, path);
                return (
                  <a href={path} key={label} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>{label}</a>
                );
              })}
            </div>
          </details>
        );
      })}
      <a className="mega-nav-verify" href="/verify">Verify Certificate</a>
      <a className="nav-proposal" href="/request-proposal">Request Proposal</a>
      <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
    </nav>
  );
}
