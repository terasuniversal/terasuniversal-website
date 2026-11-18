import localFont from "next/font/local";

// Body face for the public premium kit (Hybrid Premium V2: Montserrat headings, Inter body). Same self-hosted file and
// settings as app/admin/layout.tsx, so nothing is downloaded at build time. A separate variable name keeps the public kit
// from depending on, or overriding, the admin shell's --font-inter. Only pages that import this module load the face.
export const publicBody = localFont({
  src: [{ path: "../../app/fonts/inter/inter-v20-latin-wght-normal.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-public-body",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Inter Fallback"],
});
