/**
 * Official certificate records.
 *
 * Add a record only after the participant, dates, course and certificate number
 * have been verified by TERAS UNIVERSAL. Keep this dataset free of sensitive
 * personal information beyond what is necessary for public verification.
 */
export const certificates = [];

export function findCertificate(records, certificateNumber) {
  const normalized = String(certificateNumber ?? "").trim().toUpperCase();
  if (!normalized) return null;

  return records.find((record) =>
    String(record.certificateNumber ?? "").trim().toUpperCase() === normalized
  ) ?? null;
}
