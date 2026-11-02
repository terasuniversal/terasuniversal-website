import type { createSupabaseServerClient } from "../supabase/server";
import { isWahCourse } from "./wah-failed-hold";

export const WAH_SUPER_ADMIN_CODE = "WAH_SUPER_ADMIN_REQUIRED";
export const WAH_SUPER_ADMIN_REASON = "Only the TERAS Super Admin can issue Working at Height certificates.";
export const WAH_NOT_AUTHORIZED_CODE = "WAH_ISSUANCE_NOT_AUTHORIZED";
export const WAH_NOT_AUTHORIZED_REASON = "Certificate not issued: Working at Height certificates are issued one at a time by the TERAS Super Admin.";
export const WAH_AUTHORIZATION_CODE = "WAH_AUTHORIZATION_";
export const WAH_AUTHORIZATION_REASON = "Certificate not issued: the participant did not pass the Working at Height issuance checks, or another issuance is in progress. Refresh and try again.";
export const WAH_BULK_EXCLUDED_REASON = "Working at Height certificates are issued one at a time, so they were left out of this run.";
export const WAH_HOLDER_CODE = "WAH_ALREADY_CERTIFIED";
export const WAH_HOLDER_LABEL = "Held — already holds a WAH certificate";
export const WAH_HOLDER_REASON = "Certificate not issued because this participant already holds an active Working at Height certificate.";
export const WAH_HOLDER_CHECK_ERROR = "The existing certificate check could not be completed, so no certificate was issued.";

/**
 * Participants on a WAH schedule who already hold an active WAH certificate from any
 * schedule. This only improves staff feedback; the Super Admin issuance function is the
 * enforcement point. Throws on a read failure so callers cannot treat an unknown result
 * as "nobody holds one".
 */
export async function loadWahCertificateHolderIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string,
  courseId: string | null | undefined,
): Promise<Set<string>> {
  if (!isWahCourse(courseId)) return new Set();
  const { data, error } = await supabase.rpc("wah_certificate_holders_on_schedule" as never, { p_schedule_id: scheduleId } as never);
  if (error) throw new Error(WAH_HOLDER_CHECK_ERROR);
  return new Set(((data ?? []) as unknown as { participant_id: string }[]).map((row) => row.participant_id));
}
