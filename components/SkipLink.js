"use client";

// W4-a NE-3 (owner-approved): #main-content wraps each page *including* its own header (every page renders its header
// inside {children}), so following the plain #main-content anchor left keyboard focus before the header navigation and
// the next Tab went back into it. On activation, focus moves to the page's <main> instead, so the next Tab starts in the
// page content. Without JavaScript the link still scrolls to #main-content as before.
export default function SkipLink() {
  const onClick = (event) => {
    const main = document.querySelector("#main-content main");
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
  };
  return (
    <a href="#main-content" className="skip-link" onClick={onClick}>
      Skip to main content
    </a>
  );
}
