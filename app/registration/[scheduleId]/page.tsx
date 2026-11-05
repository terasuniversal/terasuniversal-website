import Link from "next/link";
import { notFound } from "next/navigation";
import Footer from "../../../components/Footer";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import PublicRegistrationFlow from "../../../components/public/PublicRegistrationFlow";
import { getPublicRegistrationSchedule } from "../../../lib/public-content";

export const dynamic = "force-dynamic";

export default async function RegistrationPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const schedule = await getPublicRegistrationSchedule(scheduleId);
  if (!schedule) notFound();

  return (
    <>
      <PremiumHeader />
      <main className="registration-page">
      <div className="container registration-container">
        <PublicRegistrationFlow schedule={schedule} />
      </div>
      </main>
      <Footer />
    </>
  );
}
