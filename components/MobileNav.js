"use client";

import { useState } from "react";

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  const closeMenu = () => setOpen(false);

  return (
    <>
      <button
        className="menu-button"
        type="button"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span />
        <span />
        <span />
      </button>

      <div className={`mobile-menu ${open ? "open" : ""}`}>
        <a href="#about" onClick={closeMenu}>About</a>
        <a href="#training" onClick={closeMenu}>Training</a>
        <a href="#approach" onClick={closeMenu}>Our Approach</a>
        <a href="#contact" onClick={closeMenu}>Contact</a>
        <a
          className="mobile-menu-cta"
          href="https://wa.me/60195193834"
          target="_blank"
          rel="noreferrer"
          onClick={closeMenu}
        >
          WhatsApp
        </a>
      </div>
    </>
  );
}
