import { getSupabaseClient } from "./supabase";

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

export async function findCertificateByValue(value) {
  const normalized = normalize(value);
  if (!normalized || !/^[A-Z0-9 .\/-]+$/.test(normalized)) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("verify_certificate_by_value", { search_value: normalized });
  if (error) throw error;
  return mapCertificate(Array.isArray(data) ? data[0] : data);
}
