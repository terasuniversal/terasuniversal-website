import { requireRole } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";
import { toCents } from "../finance/executiveKpis";
import {
  EVIDENCE_SELECT,
  NO_EVIDENCE,
  RECONCILIATION_VIEWS,
  REGISTRATION_LEVEL_VIEWS,
  capacityView,
  isUuid,
  parseEvidence,
  type CapacityView,
  type PaymentEvidence,
  type ReconciliationView,
} from "./reconciliation";

/**
 * Staff payment reconciliation (PKG-1d-B): read-only loaders for the overview, the queue scope and the detail page.
 * Admin / Super Admin only: requireRole("admin") is the first statement of every exported function, and every read
 * uses the caller's RLS-bound session (no service role). No writes and no RPC calls. raw_response is read only through
 * the named keys in EVIDENCE_SELECT; payment_url, confirmation_token_hash, idempotency_key_hash, ic_passport_no and
 * attendee contact details are never selected.
 */

type Json = Record<string, unknown>;
const rowsOf = (data: unknown): Json[] => (Array.isArray(data) ? (data as Json[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Rows per counting query. A result that fills it is reported as not exact, never as complete. */
const SCOPE_LIMIT = 1000;
/**
 * Registration ids a view may resolve to. The ids travel back to PostgREST in an `in` filter on the URL, so the list
 * is kept short; a larger result is reported as too large (narrow with a search instead).
 */
const SCOPE_ID_LIMIT = 200;
/** Ids per evidence request (URL length). */
const EVIDENCE_CHUNK = 100;
const OPEN_STATUSES = ["pending_payment", "payment_pending"];

function logFailure(query: string, code: string | undefined) {
  // Query name and error code only: never the message body or any row data.
  console.error("reconciliation query failed", { query, code });
}

// ---------------------------------------------------------------------------------------------------------------
// Overview counts (all registrations / all attempts, not just one page).

export type OverviewResult = { ok: true; counts: Record<ReconciliationView, number | null> } | { ok: false };

export async function loadReconciliationOverview(): Promise<OverviewResult> {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const regs = () => supabase.from("public_registrations").select("id", { count: "exact", head: true });
  const attempts = () => supabase.from("public_registration_payments").select("id", { count: "exact", head: true });
  const ids = () => supabase.from("public_registration_payments").select("id").range(0, SCOPE_LIMIT - 1);

  const [paidConfirmed, paidUnconfirmed, pending, failedCancelled, late, manual, conflicts, mismatches, afterRefund] = await Promise.all([
    regs().eq("payment_status", "paid").eq("registration_status", "confirmed"),
    regs().eq("payment_status", "paid").neq("registration_status", "confirmed"),
    regs().in("payment_status", ["pending", "processing"]),
    attempts().in("status", ["failed", "cancelled"]),
    attempts().eq("raw_response->>late_success_reconciliation_required", "true"),
    attempts().eq("payment_provider", "bank_transfer").eq("status", "paid"),
    ids().not("raw_response->transaction_conflicts", "is", null),
    ids().not("raw_response->amount_mismatch", "is", null),
    ids().not("raw_response->success_after_refund", "is", null),
  ]);
  const named = { paidConfirmed, paidUnconfirmed, pending, failedCancelled, late, manual, conflicts, mismatches, afterRefund };
  for (const [name, result] of Object.entries(named)) {
    if (result.error) {
      logFailure(`overview ${name}`, result.error.code);
      return { ok: false };
    }
  }
  // One attempt can carry more than one kind of evidence: count distinct attempts. A capped list is not exact.
  const conflictLists = [conflicts, mismatches, afterRefund].map((r) => rowsOf(r.data));
  const conflictCount = conflictLists.some((l) => l.length >= SCOPE_LIMIT) ? null : new Set(conflictLists.flat().map((r) => str(r.id))).size;
  return {
    ok: true,
    counts: {
      paid_confirmed: paidConfirmed.count ?? null,
      paid_unconfirmed: paidUnconfirmed.count ?? null,
      payment_pending: pending.count ?? null,
      failed_cancelled: failedCancelled.count ?? null,
      late_success: late.count ?? null,
      manual_transfer: manual.count ?? null,
      conflict: conflictCount,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Queue scope: turns an attempt-level view or an exact search into registration ids for the list loader.

export type QueueScope = { ok: true; ids: string[] | null } | { ok: false; reason: "query_failed" | "too_large" };

export async function resolveQueueScope(view: ReconciliationView | null, search: string | null): Promise<QueueScope> {
  await requireRole("admin");
  if (view !== null && !RECONCILIATION_VIEWS.includes(view)) return { ok: true, ids: [] };
  const needView = view !== null && !REGISTRATION_LEVEL_VIEWS.includes(view);
  if (!needView && search === null) return { ok: true, ids: null };

  const supabase = await createSupabaseServerClient();
  const lists: string[][] = [];

  if (needView) {
    const base = () => supabase.from("public_registration_payments").select("registration_id").range(0, SCOPE_LIMIT - 1);
    // Attempts are capped at SCOPE_LIMIT rows; the distinct registrations they map to are capped at SCOPE_ID_LIMIT.
    const queries =
      view === "failed_cancelled"
        ? [base().in("status", ["failed", "cancelled"])]
        : view === "late_success"
          ? [base().eq("raw_response->>late_success_reconciliation_required", "true")]
          : view === "manual_transfer"
            ? [base().eq("payment_provider", "bank_transfer").eq("status", "paid")]
            : [
                base().not("raw_response->transaction_conflicts", "is", null),
                base().not("raw_response->amount_mismatch", "is", null),
                base().not("raw_response->success_after_refund", "is", null),
              ];
    const results = await Promise.all(queries);
    const ids = new Set<string>();
    for (const r of results) {
      if (r.error) {
        logFailure(`scope ${view}`, r.error.code);
        return { ok: false, reason: "query_failed" };
      }
      const rows = rowsOf(r.data);
      if (rows.length >= SCOPE_LIMIT) {
        console.error("reconciliation scope exceeded row limit", { query: `scope ${view}`, limit: SCOPE_LIMIT });
        return { ok: false, reason: "too_large" };
      }
      for (const row of rows) ids.add(str(row.registration_id));
    }
    if (ids.size > SCOPE_ID_LIMIT) {
      console.error("reconciliation scope exceeded row limit", { query: `scope ${view} registrations`, limit: SCOPE_ID_LIMIT });
      return { ok: false, reason: "too_large" };
    }
    lists.push([...ids]);
  }

  if (search !== null) {
    // Exact matches only (.eq with a whitelisted value): no filter string is built from user input.
    const [byReference, byTransaction, byBill] = await Promise.all([
      supabase.from("public_registrations").select("id").eq("registration_reference", search.toUpperCase()).range(0, 9),
      supabase.from("public_registration_payments").select("registration_id").eq("provider_transaction_id", search).range(0, 9),
      supabase.from("public_registration_payments").select("registration_id").eq("provider_bill_code", search).range(0, 9),
    ]);
    for (const [name, r] of [["search reference", byReference], ["search transaction", byTransaction], ["search bill", byBill]] as const) {
      if (r.error) {
        logFailure(name, r.error.code);
        return { ok: false, reason: "query_failed" };
      }
    }
    lists.push([
      ...new Set([
        ...rowsOf(byReference.data).map((r) => str(r.id)),
        ...rowsOf(byTransaction.data).map((r) => str(r.registration_id)),
        ...rowsOf(byBill.data).map((r) => str(r.registration_id)),
      ]),
    ]);
  }

  // Both a view and a search: registrations that satisfy both.
  const [firstList, ...rest] = lists;
  const ids = rest.reduce((acc, l) => acc.filter((id) => l.includes(id)), firstList ?? []);
  return { ok: true, ids: ids.filter(isUuid) };
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence for a set of payment attempts (used by the list loader for its page and by the detail page).

async function readEvidence(paymentIds: readonly string[]): Promise<Map<string, PaymentEvidence> | null> {
  const ids = paymentIds.filter(isUuid);
  const out = new Map<string, PaymentEvidence>();
  if (ids.length === 0) return out;
  const supabase = await createSupabaseServerClient();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += EVIDENCE_CHUNK) chunks.push(ids.slice(i, i + EVIDENCE_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => supabase.from("public_registration_payments").select(EVIDENCE_SELECT).in("id", chunk)));
  for (const res of results) {
    if (res.error) {
      logFailure("evidence", res.error.code);
      return null;
    }
    for (const row of rowsOf(res.data)) out.set(str(row.id), parseEvidence(row));
  }
  return out;
}

export async function loadPaymentEvidence(paymentIds: readonly string[]): Promise<Map<string, PaymentEvidence> | null> {
  await requireRole("admin");
  return readEvidence(paymentIds);
}

// ---------------------------------------------------------------------------------------------------------------
// Detail page.

export interface DetailAttempt {
  id: string;
  provider: string;
  status: string;
  amountCents: number | null;
  verifiedCents: number | null;
  verifiedAt: string | null;
  transactionId: string | null;
  billCode: string | null;
  providerReference: string | null;
  billCreationState: string;
  callbackReceivedAt: string | null;
  createdAt: string;
  evidence: PaymentEvidence;
}

export interface DetailAuditEntry {
  id: string;
  at: string;
  action: string;
  entity: "registration" | "attempt" | "other";
  event: string | null;
  actorEmail: string | null;
  summary: string | null;
  transactionId: string | null;
  verifiedCents: number | null;
  providerCents: number | null;
  expectedCents: number | null;
  paymentReference: string | null;
}

export interface ReconciliationDetail {
  registration: {
    id: string;
    reference: string;
    createdAt: string;
    holdExpiresAt: string | null;
    confirmedAt: string | null;
    cancelledAt: string | null;
    expiredAt: string | null;
    registrationStatus: string;
    paymentStatus: string;
    attendeeCount: number;
    amountDueCents: number | null;
    currency: string;
    scheduleId: string;
    courseId: string;
  };
  attendees: { id: string; fullName: string; company: string | null; participantId: string | null }[];
  attempts: DetailAttempt[];
  course: { title: string; code: string | null } | null;
  schedule: { id: string; startDate: string | null; endDate: string | null; venue: string | null; status: string | null; capacity: number | null; seatsTaken: number | null } | null;
  capacity: CapacityView & { activeEnrolments: number | null; otherActiveHolds: number | null };
  /** Attendee participant ids with an active enrolment in the schedule; null when the lookup failed. */
  enrolledParticipantIds: string[] | null;
  /** null when the audit query itself failed. RLS may also hide entries from an Admin without Audit/Reports module access. */
  audit: DetailAuditEntry[] | null;
}

export type DetailResult = { ok: true; detail: ReconciliationDetail } | { ok: false; reason: "not_found" | "query_failed" | "too_large" };

const ATTENDEE_LIMIT = 100; // attendee_count is capped at 100 by a CHECK constraint
/** Attempt ids are also sent in the audit `in` filter, so this stays small (a real registration has a handful). */
const ATTEMPT_LIMIT = 50;
const HOLD_LIMIT = 1000;
const AUDIT_LIMIT = 100;

export async function loadReconciliationDetail(registrationId: string, now: Date = new Date()): Promise<DetailResult> {
  await requireRole("admin");
  if (!isUuid(registrationId)) return { ok: false, reason: "not_found" };
  const supabase = await createSupabaseServerClient();

  const regRes = await supabase
    .from("public_registrations")
    .select(
      "id, registration_reference, created_at, schedule_id, course_id, attendee_count, amount_snapshot, currency, registration_status, payment_status, hold_expires_at, confirmed_at, cancelled_at, expired_at",
    )
    .eq("id", registrationId)
    .maybeSingle();
  if (regRes.error) {
    logFailure("detail registration", regRes.error.code);
    return { ok: false, reason: "query_failed" };
  }
  const r = regRes.data as Json | null;
  if (!r) return { ok: false, reason: "not_found" };
  const scheduleId = str(r.schedule_id);
  const courseId = str(r.course_id);

  const [attendeeRes, attemptRes, courseRes, scheduleRes, enrolmentRes, holdRes] = await Promise.all([
    supabase
      .from("public_registration_attendees")
      .select("id, full_name, company, participant_id")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, ATTENDEE_LIMIT),
    supabase
      .from("public_registration_payments")
      .select(
        "id, payment_provider, status, amount, verified_amount, verified_at, provider_transaction_id, provider_bill_code, provider_reference, bill_creation_state, callback_received_at, created_at",
      )
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: true })
      .range(0, ATTEMPT_LIMIT - 1),
    supabase.from("courses").select("id, title, course_code").eq("id", courseId).maybeSingle(),
    supabase.from("course_schedules").select("id, start_date, end_date, venue, status, capacity, seats_taken").eq("id", scheduleId).maybeSingle(),
    supabase
      .from("schedule_participants")
      .select("id", { count: "exact", head: true })
      .eq("schedule_id", scheduleId)
      .is("deleted_at", null)
      .neq("registration_status", "cancelled"),
    supabase
      .from("public_registrations")
      .select("attendee_count")
      .eq("schedule_id", scheduleId)
      .neq("id", registrationId)
      .in("registration_status", OPEN_STATUSES)
      .gt("hold_expires_at", now.toISOString())
      .range(0, HOLD_LIMIT - 1),
  ]);
  for (const [name, result] of [
    ["detail attendees", attendeeRes],
    ["detail attempts", attemptRes],
    ["detail course", courseRes],
    ["detail schedule", scheduleRes],
  ] as const) {
    if (result.error) {
      logFailure(name, result.error.code);
      return { ok: false, reason: "query_failed" };
    }
  }
  if (rowsOf(attemptRes.data).length >= ATTEMPT_LIMIT) {
    console.error("reconciliation query exceeded row limit", { query: "detail attempts", limit: ATTEMPT_LIMIT });
    return { ok: false, reason: "too_large" };
  }

  const attemptRows = rowsOf(attemptRes.data);
  const attemptIds = attemptRows.map((a) => str(a.id));
  const participantIds = rowsOf(attendeeRes.data).map((a) => str(a.participant_id)).filter(isUuid);
  const [evidence, auditRes, enrolledRes] = await Promise.all([
    readEvidence(attemptIds),
    supabase
      .from("audit_logs")
      .select(
        "id, created_at, action, entity_type, entity_id, actor_email, summary, event:metadata->>event, txn:metadata->>provider_transaction_id, verified_amount:metadata->>verified_amount, provider_amount:metadata->>provider_amount, expected_amount:metadata->>expected_amount, payment_reference:metadata->>payment_reference",
      )
      .in("entity_id", [registrationId, ...attemptIds])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, AUDIT_LIMIT - 1),
    participantIds.length === 0
      ? Promise.resolve({ data: [] as Json[], error: null })
      : supabase
          .from("schedule_participants")
          .select("participant_id")
          .eq("schedule_id", scheduleId)
          .in("participant_id", participantIds)
          .is("deleted_at", null)
          .neq("registration_status", "cancelled"),
  ]);
  if (evidence === null) return { ok: false, reason: "query_failed" };
  if (auditRes.error) logFailure("detail audit", auditRes.error.code);
  if (enrolledRes.error) logFailure("detail enrolled attendees", enrolledRes.error.code);

  const activeEnrolments = enrolmentRes.error ? null : (enrolmentRes.count ?? null);
  if (enrolmentRes.error) logFailure("detail enrolments", enrolmentRes.error.code);
  const holdRows = rowsOf(holdRes.data);
  const otherActiveHolds = holdRes.error || holdRows.length >= HOLD_LIMIT ? null : holdRows.reduce((sum, h) => sum + (intOrNull(h.attendee_count) ?? 0), 0);
  if (holdRes.error) logFailure("detail holds", holdRes.error.code);

  const s = scheduleRes.data as Json | null;
  const c = courseRes.data as Json | null;
  const schedule = s
    ? { id: str(s.id), startDate: strOrNull(s.start_date), endDate: strOrNull(s.end_date), venue: strOrNull(s.venue), status: strOrNull(s.status), capacity: intOrNull(s.capacity), seatsTaken: intOrNull(s.seats_taken) }
    : null;

  const detail: ReconciliationDetail = {
    registration: {
      id: str(r.id),
      reference: str(r.registration_reference),
      createdAt: str(r.created_at),
      holdExpiresAt: strOrNull(r.hold_expires_at),
      confirmedAt: strOrNull(r.confirmed_at),
      cancelledAt: strOrNull(r.cancelled_at),
      expiredAt: strOrNull(r.expired_at),
      registrationStatus: str(r.registration_status),
      paymentStatus: str(r.payment_status),
      attendeeCount: intOrNull(r.attendee_count) ?? 0,
      amountDueCents: toCents(r.amount_snapshot),
      currency: str(r.currency) || "MYR",
      scheduleId,
      courseId,
    },
    attendees: rowsOf(attendeeRes.data)
      .slice(0, ATTENDEE_LIMIT)
      .map((a) => ({ id: str(a.id), fullName: str(a.full_name), company: strOrNull(a.company), participantId: strOrNull(a.participant_id) })),
    attempts: attemptRows.map((a) => ({
      id: str(a.id),
      provider: str(a.payment_provider),
      status: str(a.status),
      amountCents: toCents(a.amount),
      verifiedCents: toCents(a.verified_amount),
      verifiedAt: strOrNull(a.verified_at),
      transactionId: strOrNull(a.provider_transaction_id),
      billCode: strOrNull(a.provider_bill_code),
      providerReference: strOrNull(a.provider_reference),
      billCreationState: str(a.bill_creation_state),
      callbackReceivedAt: strOrNull(a.callback_received_at),
      createdAt: str(a.created_at),
      evidence: evidence.get(str(a.id)) ?? NO_EVIDENCE,
    })),
    course: c ? { title: str(c.title), code: strOrNull(c.course_code) } : null,
    schedule,
    capacity: {
      ...capacityView({ capacity: schedule?.capacity ?? null, seatsTaken: schedule?.seatsTaken ?? null, activeEnrolments, otherActiveHolds }),
      activeEnrolments,
      otherActiveHolds,
    },
    enrolledParticipantIds: enrolledRes.error ? null : rowsOf(enrolledRes.data).map((e) => str(e.participant_id)),
    audit: auditRes.error
      ? null
      : rowsOf(auditRes.data).map((e) => ({
          id: String(e.id ?? ""),
          at: str(e.created_at),
          action: str(e.action),
          entity: str(e.entity_id) === registrationId ? "registration" : attemptIds.includes(str(e.entity_id)) ? "attempt" : "other",
          event: strOrNull(e.event),
          actorEmail: strOrNull(e.actor_email),
          summary: strOrNull(e.summary),
          transactionId: strOrNull(e.txn),
          verifiedCents: toCents(e.verified_amount),
          providerCents: toCents(e.provider_amount),
          expectedCents: toCents(e.expected_amount),
          paymentReference: strOrNull(e.payment_reference),
        })),
  };
  return { ok: true, detail };
}
