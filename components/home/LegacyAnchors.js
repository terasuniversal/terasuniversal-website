"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Anchors that pointed at homepage sections which now live elsewhere. A visitor following an old
// link such as /#industries lands on the page that now carries that content instead of at the top.
const destinations = {
  "success-metrics": "#recognition",
  about: "/about",
  industries: "/industries",
  facilities: "/about#about-facilities-title",
  gallery: "/gallery",
  projects: "/services",
  methodology: "/about#approach-title",
};

// The shared loading screen streams the page inside a hidden block, so on a direct load the browser
// tries its one fragment scroll while the target has no box. This runs once per page load, after the
// content is visible; client-side navigations are positioned by Next.js itself.
let placed = false;
let cancelPlacement = () => {};

function placeOnHash() {
  let id = "";
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
  const target = id && document.getElementById(id);
  if (!target) return;
  const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const settle = () => {
    if (Math.abs(target.getBoundingClientRect().top - offset) > 8) target.scrollIntoView({ block: "start", behavior: "instant" });
  };
  // Images and fonts above the target can still shift it; follow that for a short time, and stop at once when the visitor takes over.
  const events = ["wheel", "touchstart", "keydown", "pointerdown"];
  let observer;
  let timer;
  const stop = () => { observer?.disconnect(); clearTimeout(timer); events.forEach((name) => window.removeEventListener(name, stop)); };
  cancelPlacement = stop;
  requestAnimationFrame(() => {
    settle();
    // Same starting point for Tab as a native fragment jump: a native jump shows no ring, so neither does this.
    const addedTabindex = !target.hasAttribute("tabindex") && !target.matches("a, button, input, select, textarea, summary");
    if (addedTabindex) target.setAttribute("tabindex", "-1");
    const outline = target.style.getPropertyValue("outline");
    const priority = target.style.getPropertyPriority("outline");
    target.style.setProperty("outline", "none");
    target.addEventListener("blur", () => {
      target.style.setProperty("outline", outline, priority);
      if (addedTabindex) target.removeAttribute("tabindex");
    }, { once: true });
    target.focus({ preventScroll: true });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(settle);
      observer.observe(document.body);
    }
    timer = setTimeout(stop, 2500);
    events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
  });
}

export default function LegacyAnchors() {
  const router = useRouter();
  useEffect(() => {
    const follow = () => {
      const id = window.location.hash.slice(1);
      const target = destinations[id];
      if (!target || document.getElementById(id)) return;
      if (target.startsWith("#")) document.getElementById(target.slice(1))?.scrollIntoView();
      else router.replace(target);
    };
    follow();
    if (!placed) {
      placed = true;
      placeOnHash();
    }
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      cancelPlacement();
    };
  }, [router]);
  return null;
}
