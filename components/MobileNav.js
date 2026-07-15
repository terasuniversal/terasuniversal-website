"use client";

import { useState } from "react";

export default function MobileNav({ basePath = "" }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  const link = (hash) => `${basePath}${hash}`;

  return (
    <>
      <button className="menu-button" type="button" aria-label="Toggle navigation menu" aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
      <div className={`mobile-menu ${open ? "open" : ""}`}>
        <a href={link("#about")} onClick={closeMenu}>About</a>
        <a href={link("#services")} onClick={closeMenu}>Services</a>
        <a href={basePath ? `${basePath}training` : "#training"} onClick={closeMenu}>Training</a>
        <a href={link("#industries")} onClick={closeMenu}>Industries</a>
        <a href={link("#faq")} onClick={closeMenu}>FAQ</a>
        <a href={link("#contact")} onClick={closeMenu}>Contact</a>
        <a className="mobile-menu-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer" onClick={closeMenu}>WhatsApp</a>
      </div>
    </>
  );
}
