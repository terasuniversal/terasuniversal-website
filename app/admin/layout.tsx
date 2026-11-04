import "../globals.css"; // site-wide base; Montserrat (headings) is loaded by the root layout
import "./admin.css";
import "./admin-tailwind.css"; // shadcn/ui primitives; admin-only, see file header
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

// Admin body font. Loaded here, not in the root layout, so the public site
// never downloads it; the variable is only defined inside .teras-admin.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

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
  return <div className={`teras-admin ${inter.variable}`}>{children}</div>;
}
