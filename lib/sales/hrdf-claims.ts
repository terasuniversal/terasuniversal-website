import type { HrdfClaimStatus } from "../supabase/database.types";

export const HRDF_CLAIM_STATUS_ORDER: HrdfClaimStatus[] = [
  "grant_pending", "grant_approved", "grant_rejected", "training_in_progress",
  "training_completed", "claim_ready", "claim_submitted", "claim_approved",
  "claim_rejected", "payment_received", "cancelled",
];

export const HRDF_CLAIM_STATUS_LABELS: Record<HrdfClaimStatus, string> = {
  grant_pending: "Grant Pending",
  grant_approved: "Grant Approved",
  grant_rejected: "Grant Rejected",
  training_in_progress: "Training In Progress",
  training_completed: "Training Completed",
  claim_ready: "Claim Ready",
  claim_submitted: "Claim Submitted",
  claim_approved: "Claim Approved",
  claim_rejected: "Claim Rejected",
  payment_received: "Payment Received",
  cancelled: "Cancelled",
};

export const HRDF_CLAIM_STATUS_FILTERS = [
  "grant_pending", "training_in_progress", "claim_ready", "claim_submitted",
  "claim_approved", "claim_rejected", "payment_received",
] as const satisfies readonly HrdfClaimStatus[];

export function hrdfClaimStatusLabel(status: string): string {
  return HRDF_CLAIM_STATUS_LABELS[status as HrdfClaimStatus] ?? status;
}
