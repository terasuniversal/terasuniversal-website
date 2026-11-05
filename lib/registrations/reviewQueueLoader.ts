import { requireRole } from "../auth/session";
import { createSupabaseServerClient } from "../supabase/server";
import { toCents } from "../finance/executiveKpis";
import {
  PAGE_SIZE,
  classifyRegistration,
  pageCount,
  type AttendeeInput,
  type ClassifiedRegistration,
  type EnrolmentInput,
  type PaymentInput,
  type QueueParams,
  type RegistrationInput,
} from "./reviewQueue";

/** Rows per supporting query. A result that fills it is never shown as if it were complete. */
const ATTENDEE_LIMIT = 3000; // 25 registrations x at most 100 attendees each
const PAYMENT_LIMIT = 1000;
const ENROLMENT_LIMIT = 5000;
const OPEN_STATUSES = ["pending_payment", "payment_pending"];

export interface QueueRow {
  id: string;
  reference: string;
  createdAt: string;
  holdExpiresAt: string | null;
  registrationStatus: string;
  paymentStatus: string;
  attendeeCount: number;
  course: { title: string; code: string | null } | null;
  schedule: { id: string; startDate: string | null; endDate: string | null; venue: string | null; status: string | null } | null;
  attendees: { id: string; fullName: string; participantId: string | null }[];
  classified: ClassifiedRegistration;
}

export interface QueueSummary {
  /** Counts over ALL registrations, not just this page. */
  total: number;
  expiredHolds: number;
  paidUnconfirmed: number;
}

export type RegistrationQueueResult =
  | { ok: true; rows: QueueRow[]; page: number; totalPages: number; filteredTotal: number; summary: QueueSummary }
  | { ok: false; reason: "query_failed" | "too_large" };

type Json = Record<string, unknown>;

function rowsOf(data: unknown): Json[] {
  return Array.isArray(data) ? (data as Json[]) : [];
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Loads one page of public registrations for the Admin review queue.
 * Admin / Super Admin only: the guard is the first statement here as well as in
 * the page, and the data is read with the caller's own RLS-bound session (no
 * service role). Read-only: no writes, no RPC calls. Columns are listed
 * explicitly; raw_response, ic_passport_no, identity_normalized, email and
 * phone are never selected, and the provider transaction id is reduced to a
 * boolean before it leaves this function.
 */
export async function loadRegistrationQueue(params: QueueParams, now: Date = new Date()): Promise<RegistrationQueueResult> {
  await requireRole("admin");

  const supabase = await createSupabaseServerClient();
  const nowIso = now.toISOString();
  const listColumns =
    "id, registration_reference, created_at, schedule_id, course_id, attendee_count, amount_snapshot, registration_status, payment_status, hold_expires_at";

  const buildList = (page: number) => {
    let q = supabase.from("public_registrations").select(listColumns, { count: "exact" });
    if (params.status) q = q.eq("registration_status", params.status);
    if (params.payment) q = q.eq("payment_status", params.payment);
    if (params.attention === "expired_hold") q = q.in("registration_status", OPEN_STATUSES).lte("hold_expires_at", nowIso);
    if (params.attention === "paid_unconfirmed") q = q.eq("payment_status", "paid").neq("registration_status", "confirmed");
    const from = (page - 1) * PAGE_SIZE;
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };

  // Independent queries, started together; no await inside the array literal (CLAUDE.md section 5/13).
  const [list, totalCount, expiredCount, paidUnconfirmedCount] = await Promise.all([
    buildList(params.page),
    supabase.from("public_registrations").select("id", { count: "exact", head: true }),
    supabase.from("public_registrations").select("id", { count: "exact", head: true }).in("registration_status", OPEN_STATUSES).lte("hold_expires_at", nowIso),
    supabase.from("public_registrations").select("id", { count: "exact", head: true }).eq("payment_status", "paid").neq("registration_status", "confirmed"),
  ]);
  for (const [name, result] of [
    ["registrations", list],
    ["total", totalCount],
    ["expired holds", expiredCount],
    ["paid unconfirmed", paidUnconfirmedCount],
  ] as const) {
    if (result.error) {
      // Query name and error code only: never the message body or any row data.
      console.error("registration queue query failed", { query: name, code: result.error.code });
      return { ok: false, reason: "query_failed" };
    }
  }

  const filteredTotal = list.count ?? 0;
  const totalPages = pageCount(filteredTotal);
  let page = params.page;
  let registrations = rowsOf(list.data);
  // A page beyond the end (for example a stale link) shows the last page rather than an empty screen.
  if (registrations.length === 0 && filteredTotal > 0 && page > totalPages) {
    page = totalPages;
    const retry = await buildList(page);
    if (retry.error) {
      console.error("registration queue query failed", { query: "registrations retry", code: retry.error.code });
      return { ok: false, reason: "query_failed" };
    }
    registrations = rowsOf(retry.data);
  }

  const summary: QueueSummary = { total: totalCount.count ?? 0, expiredHolds: expiredCount.count ?? 0, paidUnconfirmed: paidUnconfirmedCount.count ?? 0 };
  if (registrations.length === 0) return { ok: true, rows: [], page, totalPages, filteredTotal, summary };

  const ids = registrations.map((r) => str(r.id));
  const courseIds = [...new Set(registrations.map((r) => str(r.course_id)))];
  const scheduleIds = [...new Set(registrations.map((r) => str(r.schedule_id)))];

  const [attendeeRes, paymentRes, courseRes, scheduleRes, enrolmentRes] = await Promise.all([
    supabase
      .from("public_registration_attendees")
      .select("id, registration_id, full_name, company, participant_id")
      .in("registration_id", ids)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, ATTENDEE_LIMIT - 1),
    supabase
      .from("public_registration_payments")
      .select("id, registration_id, payment_provider, status, amount, verified_amount, bill_creation_state, provider_transaction_id, callback_received_at")
      .in("registration_id", ids)
      .order("created_at", { ascending: true })
      .range(0, PAYMENT_LIMIT - 1),
    supabase.from("courses").select("id, title, course_code").in("id", courseIds),
    supabase.from("course_schedules").select("id, start_date, end_date, venue, status").in("id", scheduleIds),
    supabase
      .from("schedule_participants")
      .select("schedule_id, participant_id")
      .in("schedule_id", scheduleIds)
      .is("deleted_at", null)
      .neq("registration_status", "cancelled")
      .range(0, ENROLMENT_LIMIT - 1),
  ]);
  for (const [name, result, limit] of [
    ["attendees", attendeeRes, ATTENDEE_LIMIT],
    ["payments", paymentRes, PAYMENT_LIMIT],
    ["courses", courseRes, Infinity],
    ["schedules", scheduleRes, Infinity],
  ] as const) {
    if (result.error) {
      console.error("registration queue query failed", { query: name, code: result.error.code });
      return { ok: false, reason: "query_failed" };
    }
    if (rowsOf(result.data).length >= limit) {
      console.error("registration queue query exceeded row limit", { query: name, limit });
      return { ok: false, reason: "too_large" };
    }
  }
  if (enrolmentRes.error) {
    console.error("registration queue query failed", { query: "enrolments", code: enrolmentRes.error.code });
    return { ok: false, reason: "query_failed" };
  }
  // Enrolments that fill the cap are not exact: report UNKNOWN for them instead of failing the screen.
  const enrolmentRows = rowsOf(enrolmentRes.data);
  const enrolmentExact = enrolmentRows.length < ENROLMENT_LIMIT;
  const enrolledBySchedule = new Map<string, Set<string>>();
  for (const e of enrolmentRows) {
    const set = enrolledBySchedule.get(str(e.schedule_id)) ?? new Set<string>();
    set.add(str(e.participant_id));
    enrolledBySchedule.set(str(e.schedule_id), set);
  }

  const attendeesBy = new Map<string, AttendeeInput[]>();
  for (const a of rowsOf(attendeeRes.data)) {
    const item: AttendeeInput = { id: str(a.id), registration_id: str(a.registration_id), full_name: str(a.full_name), company: strOrNull(a.company), participant_id: strOrNull(a.participant_id) };
    attendeesBy.set(item.registration_id, [...(attendeesBy.get(item.registration_id) ?? []), item]);
  }
  const paymentsBy = new Map<string, PaymentInput[]>();
  for (const p of rowsOf(paymentRes.data)) {
    const item: PaymentInput = {
      id: str(p.id),
      registration_id: str(p.registration_id),
      payment_provider: str(p.payment_provider),
      status: str(p.status),
      amount_cents: toCents(p.amount),
      verified_cents: toCents(p.verified_amount),
      bill_creation_state: str(p.bill_creation_state),
      has_transaction_id: str(p.provider_transaction_id).length > 0,
      callback_received: strOrNull(p.callback_received_at) !== null,
    };
    paymentsBy.set(item.registration_id, [...(paymentsBy.get(item.registration_id) ?? []), item]);
  }
  const courseBy = new Map(rowsOf(courseRes.data).map((c) => [str(c.id), { title: str(c.title), code: strOrNull(c.course_code) }]));
  const scheduleBy = new Map(
    rowsOf(scheduleRes.data).map((s) => [str(s.id), { id: str(s.id), startDate: strOrNull(s.start_date), endDate: strOrNull(s.end_date), venue: strOrNull(s.venue), status: strOrNull(s.status) }]),
  );

  const rows: QueueRow[] = registrations.map((r) => {
    const input: RegistrationInput = {
      id: str(r.id),
      registration_reference: str(r.registration_reference),
      created_at: str(r.created_at),
      schedule_id: str(r.schedule_id),
      course_id: str(r.course_id),
      attendee_count: num(r.attendee_count),
      amount_due_cents: toCents(r.amount_snapshot),
      registration_status: str(r.registration_status),
      payment_status: str(r.payment_status),
      hold_expires_at: strOrNull(r.hold_expires_at),
    };
    const attendees = attendeesBy.get(input.id) ?? [];
    const enrolment: EnrolmentInput = { known: enrolmentExact, participantIds: enrolledBySchedule.get(input.schedule_id) ?? new Set<string>() };
    return {
      id: input.id,
      reference: input.registration_reference,
      createdAt: input.created_at,
      holdExpiresAt: input.hold_expires_at,
      registrationStatus: input.registration_status,
      paymentStatus: input.payment_status,
      attendeeCount: input.attendee_count,
      course: courseBy.get(input.course_id) ?? null,
      schedule: scheduleBy.get(input.schedule_id) ?? null,
      attendees: attendees.map((a) => ({ id: a.id, fullName: a.full_name, participantId: a.participant_id })),
      classified: classifyRegistration(input, attendees, paymentsBy.get(input.id) ?? [], enrolment, now),
    };
  });

  return { ok: true, rows, page, totalPages, filteredTotal, summary };
}
