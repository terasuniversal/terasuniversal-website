"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// The bar steps aside while the visitor reads down the page, fills a form or
// reaches the footer, so it never sits over headings, fields or footer links.
// It comes back on any upward scroll and near the top of the page.
const SCROLL_DELTA = 8;
const TOP_ZONE = 160;

export default function StickyCta() {
  const pathname = usePathname();
  const [scrollHidden, setScrollHidden] = useState(false);
  const [blockingInView, setBlockingInView] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (y < TOP_ZONE) setScrollHidden(false);
        else if (y > lastY + SCROLL_DELTA) setScrollHidden(true);
        else if (y < lastY - SCROLL_DELTA) setScrollHidden(false);
        if (Math.abs(y - lastY) > SCROLL_DELTA || y < TOP_ZONE) lastY = y;
      });
    };
    setScrollHidden(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    const targets = document.querySelectorAll("#main-content form, #main-content footer, #main-content .calendar-controls");
    setBlockingInView(false);
    if (!targets.length || !("IntersectionObserver" in window)) return undefined;
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target)));
      setBlockingInView(visible.size > 0);
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const onFocusIn = (event) => setFieldFocused(event.target instanceof HTMLElement && event.target.matches("input, textarea, select"));
    const onFocusOut = () => setFieldFocused(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  if (pathname === "/verify" || pathname?.startsWith("/verify/")) {
    return null;
  }

  const hidden = scrollHidden || blockingInView || fieldFocused;

  return (
    <aside className={hidden ? "sticky-cta is-hidden" : "sticky-cta"} aria-label="Quick contact options" inert={hidden || undefined}>
      <a className="sticky-cta-proposal" href="/request-proposal">Request Proposal</a>
      <div className="sticky-cta-mobile">
        <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer" aria-label="WhatsApp TERAS UNIVERSAL">WhatsApp</a>
        <a href="tel:+60195193834" aria-label="Call TERAS UNIVERSAL">Call</a>
        <a href="mailto:training@terasuniversal.com.my" aria-label="Email TERAS UNIVERSAL">Email</a>
      </div>
    </aside>
  );
}
