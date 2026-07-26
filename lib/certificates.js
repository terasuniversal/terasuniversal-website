import { getSupabaseClient } from "./supabase";

const googleVerificationEndpoint = process.env.GOOGLE_CERTIFICATE_VERIFY_URL;

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function mapCertificate(record) {
  if (!record) return null;
  return {
    participantName: record.participant_name,
    courseName: record.course_name,
    certificateNumber: record.certificate_no,
    trainingStartDate: record.training_start_date,
    trainingEndDate: record.training_end_date,
    issueDate: record.issue_date,
    expiryDate: record.expiry_date,
    venue: record.venue,
    instructor: record.instructor || record.trainer_name,
    status: record.status,
    certificateFileUrl: record.certificate_file_url,
  };
}

function mapGoogleSheetsCertificate(record) {
  if (!record) return null;
  return {
    participantName: record.participantName,
    courseName: record.courseName,
    certificateNumber: record.certificateNumber,
    trainingStartDate: record.trainingStartDate,
    trainingEndDate: record.trainingEndDate,
    issueDate: record.issueDate,
    expiryDate: record.expiryDate,
    venue: record.venue,
    instructor: record.instructor,
    status: String(record.status || "").toLowerCase(),
    certificateFileUrl: record.certificateFileUrl,
  };
}

async function findGoogleSheetsCertificate(value) {
  const url = new URL(googleVerificationEndpoint);
  url.searchParams.set("code", value);

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Certificate verification service is temporarily unavailable.");
  }

  const payload = await response.json();
  return payload?.found ? mapGoogleSheetsCertificate(payload.certificate) : null;
}

export async function findCertificateByValue(value) {
  const normalized = normalize(value);
  if (!normalized || !/^[A-Z0-9 .\/-]+$/.test(normalized)) return null;

  // Google Sheets is the certificate source of truth when this endpoint is set.
  // The endpoint is called server-side only; its URL is never sent to visitors.
  if (googleVerificationEndpoint) {
    return findGoogleSheetsCertificate(normalized);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("verify_certificate_by_value", { search_value: normalized });
  if (error) throw error;
  return mapCertificate(Array.isArray(data) ? data[0] : data);
}
