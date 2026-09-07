import PublicRegistrationStatus from "../../../../components/public/PublicRegistrationStatus";

export const metadata = {
  title: "Registration Payment Status — TERAS UNIVERSAL",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RegistrationPaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const params = await searchParams;
  return <PublicRegistrationStatus reference={params.reference} />;
}
