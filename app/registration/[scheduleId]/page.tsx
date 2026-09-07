import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import Footer from "../../../components/Footer";
import MegaNav from "../../../components/MegaNav";
import MobileNav from "../../../components/MobileNav";
import PublicRegistrationFlow from "../../../components/public/PublicRegistrationFlow";
import { getPublicRegistrationSchedule } from "../../../lib/public-content";

export const dynamic = "force-dynamic";

export default async function RegistrationPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const schedule = await getPublicRegistrationSchedule(scheduleId);
  if (!schedule) notFound();

  return (
    <main className="registration-page">
      <header className="site-header"><div className="container nav-wrap"><Link className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></Link><MegaNav /><MobileNav basePath="/" /></div></header>
      <div className="container registration-container">
        <PublicRegistrationFlow schedule={schedule} />
      </div>
      <Footer />
    </main>
  );
}
