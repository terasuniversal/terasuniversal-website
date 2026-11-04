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
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [router]);
  return null;
}
