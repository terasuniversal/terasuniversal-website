"use client";

import { useState } from "react";

export default function MobileNav({ basePath = "" }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  const link = (hash) => `${basePath}${hash}`;

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      closeMenu();
      event.currentTarget.previousElementSibling?.focus();
    }
  }

  return (
    <>
      <button className={`menu-button ${open ? "is-open" : ""}`} type="button" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}><span /><span /><span /></button>
      <div id="mobile-navigation" className={`mobile-menu ${open ? "open" : ""}`} role="navigation" aria-label="Mobile navigation" onKeyDown={handleKeyDown}>
        <div className="mobile-menu-heading"><span>TERAS UNIVERSAL</span><strong>Explore our services</strong></div>
        <a href={link("#about")} onClick={closeMenu}>About</a>
        <a href={link("#services")} onClick={closeMenu}>Services</a>
        <a href={basePath ? `${basePath}training` : "#training"} onClick={closeMenu}>Training</a>
        <a href={link("#industries")} onClick={closeMenu}>Industries</a>
        <a href={link("#faq")} onClick={closeMenu}>FAQ</a>
        <a href={link("#contact")} onClick={closeMenu}>Contact</a>
        <a href={basePath ? `${basePath}request-proposal` : "/request-proposal"} onClick={closeMenu}>Request Proposal</a>
        <a href={basePath ? `${basePath}verify` : "/verify"} onClick={closeMenu}>Verify Certificate</a>
        <a href={basePath ? `${basePath}search` : "/search"} onClick={closeMenu}>Search</a>
        <a href={basePath ? `${basePath}resources` : "/resources"} onClick={closeMenu}>Resources</a>
        <a href={basePath ? `${basePath}calendar` : "/calendar"} onClick={closeMenu}>Training Calendar</a>
        <a href={basePath ? `${basePath}insights` : "/insights"} onClick={closeMenu}>News &amp; Insights</a>
        <a href={basePath ? `${basePath}faq` : "/faq"} onClick={closeMenu}>FAQ Centre</a>
        <a href={basePath ? `${basePath}stories` : "/stories"} onClick={closeMenu}>Testimonials &amp; Stories</a>
        <a className="mobile-menu-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer" onClick={closeMenu}>WhatsApp</a>
      </div>
    </>
  );
}
