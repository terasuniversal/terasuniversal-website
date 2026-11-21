// Server-side readers for the identity-correction RPCs (supabase/proposed-migrations/identity-correction/03 and 07).
// Not a "use server" file: these are plain helpers for Server Components, so they are not directly invocable
// as endpoints. Every caller must already have passed requireRole("super_admin"); the RPCs re-check it anyway
// and fail closed. The shapes below mirror what the RPCs return (and deliberately omit what they never return:
// sealed values, fingerprints, full IC numbers, full document hashes).
import { createSupabaseServerClient } from "../supabase/server";

export type IdentityClass = "A" | "B" | "C" | "none";
export type RequestStatus = "pending" | "applied" | "cancelled" | "rejected";
export type ChangeKind = "name" | "identity" | "combined";

export interface PolicyInfo {
  controls_ready: boolean;
  wait_name_hours: number;
  wait_identity_hours: number;
  require_second_approver: boolean;
  sealing_key_configured: boolean;
  anchor_sink_configured: boolean;
  notification_sink_configured: boolean;
}

export interface CertificateHit {
  certificate_id: string;
  certificate_number: string;
  status: string;
  course_name: string | null;
  issue_date: string | null;
  participant_id: string;
  participant_code: string | null;
  holder_name: string | null;
  identity_masked: string | null;
  identity_class: IdentityClass;
  open_request_id: string | null;
}

export interface AssessedCertificate {
  certificate_id: string;
  certificate_number: string;
  status: string;
  has_snapshot: boolean;
  identity_class: IdentityClass;
  stored_identity_present: boolean;
  public_verification_enabled: boolean;
  schedule_enrolled: boolean;
}

export interface Assessment {
  participant_id: string;
  has_ic_passport_no: boolean;
  has_identity_no: boolean;
  open_request_id: string | null;
  controls_ready: boolean;
  certificates: AssessedCertificate[];
}

export interface RequestSummary {
  id: string;
  participant_id: string;
  participant_code: string | null;
  change_kind: ChangeKind;
  status: RequestStatus;
  requested_by: string;
  requested_at: string;
  earliest_apply_at: string;
  apply_to_profile: boolean;
  certificate_count: number;
  second_approved: boolean;
  closed_at: string | null;
}

export interface RequestDetail {
  id: string;
  participant_id: string;
  participant_code: string | null;
  change_kind: ChangeKind;
  status: RequestStatus;
  requested_by: string;
  requested_at: string;
  earliest_apply_at: string;
  waiting_elapsed: boolean;
  apply_to_profile: boolean;
  reason: string;
  new_full_name: string | null;
  new_identity_masked: string | null;
  requires_second_approval: boolean;
  second_approver: string | null;
  second_approved_at: string | null;
  applied_by: string | null;
  applied_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  closure_reason: string | null;
  stale: boolean;
  can_apply: boolean;
  evidence: { type: string; reference: string; reviewed_on: string; sha256_prefix: string }[];
  certificates: {
    certificate_id: string;
    certificate_number: string;
    identity_class: IdentityClass;
    name_decision: string | null;
    identity_decision: string | null;
    decision_reason: string | null;
  }[];
}

export interface CertificateHistory {
  certificate_id: string;
  requests: {
    request_id: string;
    status: RequestStatus;
    change_kind: ChangeKind;
    requested_at: string;
    requested_by: string;
    closed_at: string | null;
    identity_class: IdentityClass;
    name_decision: string | null;
    identity_decision: string | null;
  }[];
  ledger: { seq: number; request_id: string; target: string; field: string; applied_by: string; applied_at: string }[];
}

export interface RpcResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

// The hand-written database.types.ts does not know these functions, so the call is typed here instead of
// being cast to `any` (CLAUDE.md section 4); the same `as never` pattern as the existing RPC call sites.
async function call<T>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  return { data: (data as T | null) ?? null, error: error ? { message: error.message, code: error.code } : null };
}

export const getPolicy = () => call<PolicyInfo>("identity_correction_policy", {});
export const searchCertificates = (q: string) => call<CertificateHit[]>("identity_correction_search_certificates", { p_query: q });
export const assessParticipant = (participantId: string) => call<Assessment>("identity_correction_assess", { p_participant_id: participantId });
export const listRequests = (status: RequestStatus | null) => call<RequestSummary[]>("identity_correction_list_requests", { p_status: status, p_limit: 50 });
export const getRequest = (requestId: string) => call<RequestDetail>("identity_correction_get_request", { p_request_id: requestId });
export const getCertificateHistory = (certificateId: string) => call<CertificateHistory>("identity_correction_history", { p_certificate_id: certificateId });

/** State of the certificate search (a Server Action, so the query travels in a POST body, never in the URL). */
export interface SearchState {
  query?: string;
  hits?: CertificateHit[];
  error?: string;
}
