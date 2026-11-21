import Link from "next/link";
import { requireRole } from "../../../../../../lib/auth/session";
import { PageHead, ReadErrorState } from "../../../../../../components/admin/ui";
import { assessParticipant, getPolicy } from "../../../../../../lib/identity-correction/api";
import { identityCorrectionMessage } from "../../../../../../lib/identity-correction/errors";
import NewRequestForm from "./NewRequestForm";
import CertificateSearch from "./CertificateSearch";

export const metadata = { title: "New identity correction — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Step 1 finds the certificate by number (a POST Server Action, so nothing typed reaches the URL). Step 2 (?participant=...&cert=...) shows the impact assessment and the form.
// Only certificate numbers and participant UUIDs travel in the URL -- never a name or an IC/Passport number.
export default async function NewIdentityCorrectionPage({
  searchParams,
}: {
  searchParams: Promise<{ participant?: string; cert?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const policy = await getPolicy();

  const back = <Link href="/admin/certificates/identity-correction" className="ta-btn ta-btn-outline">Back to corrections</Link>;

  if (policy.error) {
    return <div><PageHead title="New identity correction" secondaryAction={back} /><ReadErrorState message={identityCorrectionMessage(policy.error)} /></div>;
  }
  if (policy.data && !policy.data.controls_ready) {
    return (
      <div>
        <PageHead title="New identity correction" secondaryAction={back} />
        <div role="status" className="ta-alert ta-alert-error">
          Corrections are switched off until the sealing key, the external audit anchor and the notification channel are configured and verified.
        </div>
      </div>
    );
  }

  // ---- step 2 -------------------------------------------------------------------------------------------
  if (sp.participant && UUID.test(sp.participant) && sp.cert) {
    const assessed = await assessParticipant(sp.participant);
    if (assessed.error || !assessed.data) {
      return <div><PageHead title="New identity correction" secondaryAction={back} /><ReadErrorState message={identityCorrectionMessage(assessed.error)} /></div>;
    }
    const a = assessed.data;
    const picked = a.certificates.find((c) => c.certificate_number === sp.cert);
    return (
      <div>
        <PageHead title="New identity correction" subtitle="Step 2 of 2: what changes, on which certificates, and why." secondaryAction={back} />
        {a.open_request_id ? (
          <div role="alert" className="ta-alert ta-alert-error">
            This participant already has an open request. <Link href={`/admin/certificates/identity-correction/${a.open_request_id}`}>Open it</Link>.
          </div>
        ) : !picked ? (
          <ReadErrorState message="That certificate does not belong to this participant. Search again." />
        ) : (
          <NewRequestForm
            participantId={a.participant_id}
            expectedCertificateNumber={picked.certificate_number}
            certificates={a.certificates}
            requiresSecondApproval={policy.data?.require_second_approver ?? false}
            waitNameHours={policy.data?.wait_name_hours ?? 24}
            waitIdentityHours={policy.data?.wait_identity_hours ?? 72}
          />
        )}
      </div>
    );
  }

  // ---- step 1 -------------------------------------------------------------------------------------------
  return (
    <div>
      <PageHead title="New identity correction" subtitle="Step 1 of 2: find the certificate by its number." secondaryAction={back} />
      <CertificateSearch />
    </div>
  );
}
