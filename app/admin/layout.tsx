import "../globals.css"; // inherits fonts (Poppins/Montserrat) already set up on the site
import "./admin.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Admin — TERAS UNIVERSAL",
  robots: { index: false, follow: false }, // never index the admin area
};

/**
 * Admin root layout. Wraps everything under /admin in the `.teras-admin`
 * scope so admin.css never leaks into the public site. Auth is enforced by
 * middleware.ts + the (protected) layout, not here (login must render too).
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="teras-admin">{children}</div>;
}
