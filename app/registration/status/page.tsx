import PublicRegistrationStatus from "../../../components/public/PublicRegistrationStatus";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registration Status", robots: { index: false, follow: false } };

export default function RegistrationStatusPage() {
  return <PublicRegistrationStatus />;
}
