import Image from "next/image";
import MegaNav from "./MegaNav";
import MobileNav from "./MobileNav";

export default function SiteHeader({ basePath = "/" }) {
  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <a className="brand" href="/" aria-label="TERAS UNIVERSAL home">
          <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" />
        </a>
        <MegaNav />
        <MobileNav basePath={basePath} />
      </div>
    </header>
  );
}
