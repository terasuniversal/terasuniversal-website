"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export default function MobileNav({ basePath = "" }) {
  // One header panel at a time: the navigation menu or, on phones, the
  // contact actions that replaced the floating bottom bar.
  const [panel, setPanel] = useState(null);
  const open = panel === "menu";
  const contactOpen = panel === "contact";
  const contactButtonRef = useRef(null);
  const contactPanelRef = useRef(null);
  const pathname = usePathname() || "";
  const closeMenu = () => setPanel(null);

  useEffect(() => { setPanel(null); }, [pathname]);

  useEffect(() => {
    if (!contactOpen) return undefined;
    const onPointerDown = (event) => {
      if (contactPanelRef.current?.contains(event.target) || contactButtonRef.current?.contains(event.target)) return;
      setPanel(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [contactOpen]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      closeMenu();
      event.currentTarget.previousElementSibling?.focus();
    }
  }

  function handleContactKeyDown(event) {
    if (event.key === "Escape" && contactOpen) {
      closeMenu();
      contactButtonRef.current?.focus();
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
    { label: "Training", href: "/training" },
    { label: "Corporate Training", href: "/corporate-training" },
    { label: "Industries", href: "/industries" },
    { label: "About TERAS", href: "/about" },
    { label: "Resources", href: "/resources" },
    { label: "Contact", href: "/contact" },
    { label: "Training Calendar", href: "/calendar" },
    { label: "Verify Certificate", href: "/verify" },
    { label: "Search", href: "/search" },
    { label: "WhatsApp", href: "https://wa.me/60195193834?text=Hi%20TERAS%2C%20saya%20ingin%20bertanya%20tentang%20latihan.", external: true },
  ];

  return (
    <>
      <button ref={contactButtonRef} className={`contact-button ${contactOpen ? "is-open" : ""}`} type="button" aria-expanded={contactOpen} aria-controls={contactOpen ? "mobile-contact" : undefined} onClick={() => setPanel(contactOpen ? null : "contact")} onKeyDown={handleContactKeyDown}>Contact</button>
      {contactOpen && (
        <div ref={contactPanelRef} id="mobile-contact" className="mobile-contact" role="group" aria-label="Contact TERAS UNIVERSAL" onKeyDown={handleContactKeyDown}>
          <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer" onClick={closeMenu}><strong>WhatsApp</strong><span>Chat with our team<span className="sr-only"> (opens in a new tab)</span></span></a>
          <a href="tel:+60195193834" onClick={closeMenu}><strong>Call</strong><span>+60 19-519 3834</span></a>
          <a href="mailto:training@terasuniversal.com.my" onClick={closeMenu}><strong>Email</strong><span>training@terasuniversal.com.my</span></a>
        </div>
      )}
      <button className={`menu-button ${open ? "is-open" : ""}`} type="button" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setPanel(open ? null : "menu")} onKeyDown={handleKeyDown}><span /><span /><span /></button>
      <div id="mobile-navigation" className={`mobile-menu ${open ? "open" : ""}`} role="navigation" aria-label="Mobile navigation" onKeyDown={handleKeyDown}>
        <div className="mobile-menu-heading"><span>TERAS UNIVERSAL</span><strong>Explore our services</strong></div>
        {items.map(({ label, href, external }) => {
          const active = isActive(href);
          return <a href={href} key={label} onClick={closeMenu} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{label}</a>;
        })}
        <a className="mobile-menu-cta" href="/request-proposal?source=mobile-nav-cta" onClick={closeMenu}>Request Corporate Training</a>
      </div>
    </>
  );
}
