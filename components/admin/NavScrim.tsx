"use client";

/** Dark overlay shown behind the mobile sidebar; tap to close. */
export function NavScrim() {
  return (
    <div
      className="ta-scrim"
      aria-hidden="true"
      onClick={() =>
        document.querySelector(".teras-admin")?.classList.remove("nav-open")
      }
    />
  );
}
