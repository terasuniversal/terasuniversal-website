"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

export default function MobileNav({ basePath = "" }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "";
  const closeMenu = () => setOpen(false);
  const link = (hash) => `${basePath}${hash}`;

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      closeMenu();
      event.currentTarget.previousElementSibling?.focus();
    }
  }

  // Marks the current page, mirroring the desktop mega-nav behaviour so the
  // mobile menu also shows visitors where they are (feedback: "menu tak
  // tunjukkan halaman mana pengunjung sedang berada"). Hash-only links
  // (homepage section anchors) never count as "the current page".
  function isActive(href) {
    const base = href.split("#")[0];
    if (!base) return false;
    if (base === "/") return pathname === "/";
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  const items = [
    { label: "About", href: link("#about") },
    { label: "Services", href: link("#services") },
    { label: "Training", href: basePath ? `${basePath}training` : "#training" },
    { label: "Industries", href: link("#industries") },
    { label: "FAQ", href: link("#faq") },
    { label: "Contact", href: link("#contact") },
    { label: "WhatsApp", href: "https://wa.me/60195193834", external: true },
    { label: "Request Proposal", href: basePath ? `${basePath}request-proposal` : "/request-proposal" },
    { label: "Verify Certificate", href: basePath ? `${basePath}verify` : "/verify" },
    { label: "Search", href: basePath ? `${basePath}search` : "/search" },
    { label: "Resources", href: basePath ? `${basePath}resources` : "/resources" },
    { label: "Training Calendar", href: basePath ? `${basePath}calendar` : "/calendar" },
    { label: "News & Insights", href: basePath ? `${basePath}insights` : "/insights" },
    { label: "FAQ Centre", href: basePath ? `${basePath}faq` : "/faq" },
    { label: "Testimonials & Stories", href: basePath ? `${basePath}stories` : "/stories" },
  ];

  return (
    <>
      <button className={`menu-button ${open ? "is-open" : ""}`} type="button" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}><span /><span /><span /></button>
      <div id="mobile-navigation" className={`mobile-menu ${open ? "open" : ""}`} role="navigation" aria-label="Mobile navigation" onKeyDown={handleKeyDown}>
        <div className="mobile-menu-heading"><span>TERAS UNIVERSAL</span><strong>Explore our services</strong></div>
        {items.map(({ label, href, external }) => {
          const active = isActive(href);
          return <a href={href} key={label} onClick={closeMenu} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{label}</a>;
        })}
        <a className="mobile-menu-cta" href={basePath ? `${basePath}request-proposal` : "/request-proposal"} onClick={closeMenu}>Request Proposal</a>
      </div>
    </>
  );
}
