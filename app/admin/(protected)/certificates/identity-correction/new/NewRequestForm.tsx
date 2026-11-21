"use client";

import { useMemo, useState } from "react";
import { MutationForm } from "../../../../../../components/admin/MutationForm";
import { Card, Field, Input, Select, Textarea, Badge } from "../../../../../../components/admin/ui";
import PendingSubmitButton from "../../../../../../components/admin/PendingSubmitButton";
import { submitIdentityCorrectionRequest } from "../actions";
import type { AssessedCertificate, IdentityClass } from "../../../../../../lib/identity-correction/api";

type Kind = "name" | "identity" | "combined";
interface EvidenceRow { type: string; reference: string; sha256: string; reviewed_on: string; fileName: string }

const EVIDENCE_TYPES: [string, string][] = [
  ["national_id", "National ID (MyKad)"],
  ["passport", "Passport"],
  ["birth_certificate", "Birth certificate"],
  ["employer_letter", "Employer letter"],
  ["signed_declaration", "Signed declaration by the participant"],
  ["training_registration_form", "Training registration form"],
  ["other_official", "Other official document"],
];

const CLASS_TEXT: Record<IdentityClass, string> = {
  A: "Has an issuance snapshot. The correction updates the certificate and its snapshot together.",
  B: "Older certificate that stores its own IC/Passport number.",
  C: "Older certificate that shows the IC/Passport live from the participant profile. Changing the profile changes what it shows.",
  none: "No IC/Passport to decide on.",
};

function identityOptions(cls: IdentityClass, applyToProfile: boolean): [string, string][] {
  if (cls === "A" || cls === "B") return [["correct", "Correct this certificate"], ["leave", "Leave as issued"]];
  if (cls === "C") {
    return applyToProfile
      ? [["accept_display_change", "Let it show the new number (display changes with the profile)"], ["pin_old", "Keep the old number on this certificate"], ["materialize_new", "Store the new number on this certificate"]]
      : [["leave", "Leave as issued"], ["materialize_new", "Store the new number on this certificate"]];
  }
  return [];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function NewRequestForm({
  participantId,
  expectedCertificateNumber,
  certificates,
  requiresSecondApproval,
  waitNameHours,
  waitIdentityHours,
}: {
  participantId: string;
  expectedCertificateNumber: string;
  certificates: AssessedCertificate[];
  requiresSecondApproval: boolean;
  waitNameHours: number;
  waitIdentityHours: number;
}) {
  const [kind, setKind] = useState<Kind>("name");
  const [newName, setNewName] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [applyToProfile, setApplyToProfile] = useState(true);
  const [nameDec, setNameDec] = useState<Record<string, string>>({});
  const [idDec, setIdDec] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<EvidenceRow[]>([{ type: "national_id", reference: "", sha256: "", reviewed_on: todayIso(), fileName: "" }]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState("");

  const changesName = kind !== "identity";
  const changesIdentity = kind !== "name";
  const defaultId = (c: AssessedCertificate) => (c.identity_class === "A" || c.identity_class === "B" ? "correct" : undefined);

  const decisions = useMemo(
    () =>
      certificates.map((c) => ({
        certificate_id: c.certificate_id,
        name_decision: changesName ? nameDec[c.certificate_id] ?? "correct" : undefined,
        identity_decision: changesIdentity && c.identity_class !== "none" ? idDec[c.certificate_id] ?? defaultId(c) : undefined,
        reason: reasons[c.certificate_id]?.trim() || undefined,
      })),
    // defaultId is a pure function of its argument
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [certificates, changesName, changesIdentity, nameDec, idDec, reasons],
  );

  const classCUnset = changesIdentity && decisions.some((d, i) => certificates[i].identity_class === "C" && !d.identity_decision);
  const needsReason = (i: number) => {
    const d = decisions[i];
    return (d.name_decision && d.name_decision !== "correct") || (d.identity_decision && d.identity_decision !== "correct");
  };
  const missingReason = decisions.some((d, i) => needsReason(i) && (d.reason?.length ?? 0) < 10);

  const evidenceComplete = evidence.every((e) => e.reference.trim().length >= 3 && /^[0-9a-f]{64}$/.test(e.sha256) && e.reviewed_on);
  const valuesComplete = (!changesName || newName.trim().length > 0) && (!changesIdentity || newIdentity.trim().length > 0);
  // UX only: the Server Action and the database re-check every one of these.
  const canSubmit = valuesComplete && evidenceComplete && reason.trim().length >= 20 && confirmed && typed === expectedCertificateNumber && !classCUnset && !missingReason;

  const payload = {
    participant_id: participantId,
    change_kind: kind,
    new_full_name: changesName ? newName : "",
    new_identity: changesIdentity ? newIdentity : "",
    apply_to_profile: applyToProfile,
    reason,
    evidence: evidence.map(({ type, reference, sha256, reviewed_on }) => ({ type, reference, sha256, reviewed_on })),
    decisions,
    confirmed_same_person: confirmed,
    typed_certificate_number: typed,
  };

  const setRow = (i: number, patch: Partial<EvidenceRow>) => setEvidence((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <MutationForm action={submitIdentityCorrectionRequest} pendingLabel="Submitting…" idleLabel="Submit request">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Card title="1. What is being corrected">
        <div className="ta-grid cols-2">
          <Field label="Type of correction" name="change_kind" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="name">Name only</option>
              <option value="identity">IC / Passport only</option>
              <option value="combined">Name and IC / Passport</option>
            </Select>
          </Field>
          <Field label="Also update the participant profile" name="apply_to_profile" hint="Turn off to correct the certificates only.">
            <Select value={applyToProfile ? "yes" : "no"} onChange={(e) => { setApplyToProfile(e.target.value === "yes"); setIdDec({}); }}>
              <option value="yes">Yes — update the profile too</option>
              <option value="no">No — certificates only</option>
            </Select>
          </Field>
          {changesName && (
            <Field label="Correct full name" name="new_full_name" required hint="Exactly as it must appear on the certificate.">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} autoComplete="off" />
            </Field>
          )}
          {changesIdentity && (
            <Field label="Correct IC / Passport number" name="new_identity" required hint="6 to 20 letters or digits. It is never shown in full after submission.">
              <Input value={newIdentity} onChange={(e) => setNewIdentity(e.target.value)} maxLength={40} autoComplete="off" />
            </Field>
          )}
        </div>
        <p style={{ color: "var(--ta-muted)" }}>
          Waiting period before it can be applied: {kind === "name" ? `${waitNameHours} hours` : `${waitIdentityHours} hours`} (longer when older certificates are touched).
          {requiresSecondApproval && " A second Super Admin must also approve."}
        </p>
      </Card>

      <Card title="2. Every certificate of this participant needs a decision">
        <div className="ta-table-wrap">
          <table className="ta-table">
            <thead><tr><th>Certificate</th><th>Kind</th>{changesName && <th>Name</th>}{changesIdentity && <th>IC / Passport</th>}<th>Reason (if not the default)</th></tr></thead>
            <tbody>
              {certificates.map((c, i) => (
                <tr key={c.certificate_id}>
                  <td>{c.certificate_number}<br /><Badge status={c.status} /></td>
                  <td><strong>{c.identity_class === "none" ? "—" : `Class ${c.identity_class}`}</strong><br /><small>{CLASS_TEXT[c.identity_class]}</small></td>
                  {changesName && (
                    <td>
                      <Select aria-label={`Name decision for ${c.certificate_number}`} value={decisions[i].name_decision} onChange={(e) => setNameDec({ ...nameDec, [c.certificate_id]: e.target.value })}>
                        <option value="correct">Correct this certificate</option>
                        <option value="leave">Leave as issued</option>
                      </Select>
                    </td>
                  )}
                  {changesIdentity && (
                    <td>
                      {c.identity_class === "none" ? "Nothing to decide" : (
                        <Select aria-label={`IC decision for ${c.certificate_number}`} value={decisions[i].identity_decision ?? ""} onChange={(e) => setIdDec({ ...idDec, [c.certificate_id]: e.target.value })}>
                          {c.identity_class === "C" && <option value="">Choose…</option>}
                          {identityOptions(c.identity_class, applyToProfile).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      )}
                    </td>
                  )}
                  <td>
                    <Input aria-label={`Decision reason for ${c.certificate_number}`} value={reasons[c.certificate_id] ?? ""} onChange={(e) => setReasons({ ...reasons, [c.certificate_id]: e.target.value })} maxLength={500} placeholder={needsReason(i) ? "Required (10+ characters)" : "Optional"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {classCUnset && <p className="ta-error" role="alert">Choose how each older certificate that shows its IC/Passport live from the profile should be treated.</p>}
      </Card>

      <Card title="3. Evidence that it is the same person">
        <p style={{ color: "var(--ta-muted)" }}>
          Select the reviewed document to fingerprint it in your browser. Only the SHA-256 fingerprint, the type, the reference and the review date are sent — the file is never uploaded.
          IC/Passport changes and older certificates need two different document types, including a government document.
        </p>
        {evidence.map((row, i) => (
          <div key={i} className="ta-grid cols-2" style={{ marginBottom: 12 }}>
            <Field label="Document type" name={`ev_type_${i}`} required>
              <Select value={row.type} onChange={(e) => setRow(i, { type: e.target.value })}>
                {EVIDENCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Reference" name={`ev_ref_${i}`} required hint="Where the original is filed. Do not type the IC/Passport number here.">
              <Input value={row.reference} onChange={(e) => setRow(i, { reference: e.target.value })} maxLength={120} autoComplete="off" />
            </Field>
            <Field label="Reviewed on" name={`ev_date_${i}`} required>
              <Input type="date" value={row.reviewed_on} max={todayIso()} onChange={(e) => setRow(i, { reviewed_on: e.target.value })} />
            </Field>
            <div className="ta-field">
              <label htmlFor={`ev_file_${i}`}>Document file (fingerprinted locally)</label>
              <input
                id={`ev_file_${i}`}
                type="file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setRow(i, { sha256: await sha256Hex(file), fileName: file.name });
                }}
              />
              <small style={{ color: "var(--ta-muted)" }}>{row.sha256 ? `SHA-256 ${row.sha256.slice(0, 12)}…` : "No file selected yet"}</small>
            </div>
            {evidence.length > 1 && <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setEvidence((rows) => rows.filter((_, j) => j !== i))}>Remove document</button>}
          </div>
        ))}
        {evidence.length < 6 && (
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => setEvidence((rows) => [...rows, { type: "passport", reference: "", sha256: "", reviewed_on: todayIso(), fileName: "" }])}>+ Add another document</button>
        )}
      </Card>

      <Card title="4. Reason and confirmation">
        <Field label="Why is this correction needed?" name="reason" required hint="At least 20 characters. This is stored in the audit record.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I have reviewed the documents and confirm they show the <strong>same person</strong> who holds these certificates. This correction does not transfer a certificate to anyone else.</span>
        </label>
        <Field label={`Type the certificate number ${expectedCertificateNumber} to confirm`} name="typed_certificate_number" required>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <PendingSubmitButton className="ta-btn ta-btn-primary" pendingLabel="Submitting…" disabled={!canSubmit}>Submit request</PendingSubmitButton>
        {!canSubmit && (classCUnset || missingReason) && <p className="ta-error" role="alert" style={{ marginTop: 8 }}>{classCUnset ? "Every older certificate needs a decision." : "Add a reason (10+ characters) for each certificate that is not simply corrected."}</p>}
      </Card>
    </MutationForm>
  );
}
