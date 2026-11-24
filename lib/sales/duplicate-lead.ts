/**
 * S-05: potential duplicate lead warning.
 *
 * Read-only and advisory. It never blocks, merges, deletes or overwrites a lead:
 * repeat customers and separate enquiries from the same person are legitimate.
 *
 * Privacy: candidates are read through the caller's RLS-bound client from
 * v_sales_lead_inbox, which is security_invoker (verified 2026-11-24), so a staff
 * member only ever sees leads they could already open from the Leads list. There
 * is no new endpoint: the lookup runs inside the lead detail Server Component.
 */

export type DuplicateMatchReason = "email" | "phone";

export interface DuplicateLeadCandidate {
  lead_metadata_id: string;
  contact_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  is_test: boolean;
  created_at: string;
}

export interface DuplicateLeadMatch {
  leadId: string;
  contactName: string | null;
  company: string | null;
  status: string;
  isTest: boolean;
  createdAt: string;
  reasons: DuplicateMatchReason[];
}

/** Lower-cased, trimmed address; null when it is not a plausible email. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Digits-only Malaysian-style phone key. "+60 12-345 6789", "60123456789" and
 * "012-345 6789" all become "0123456789". Returns null for fewer than 9 digits
 * (too short to identify a person safely, e.g. extensions or partial numbers).
 */
export function normalizePhone(value: string | null | undefined): string | null {
  let digits = (value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("60") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 9 ? digits : null;
}

/** Escape ILIKE wildcards so an address is matched literally (case-insensitive). */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * ILIKE pattern that finds the last 8 digits of a phone in any formatting
 * ("012-345 6789", "+6012 3456789"). Digits only, so it cannot inject filter
 * syntax. Candidates are confirmed with normalizePhone afterwards.
 */
export function phoneIlikePattern(normalized: string): string {
  return `%${normalized.slice(-8).split("").join("%")}%`;
}

/** Confirm candidates against the normalized keys; drops the lead itself and non-matches. */
export function matchDuplicateCandidates(
  target: { leadId: string; email: string | null | undefined; phone: string | null | undefined },
  candidates: readonly DuplicateLeadCandidate[],
): DuplicateLeadMatch[] {
  const email = normalizeEmail(target.email);
  const phone = normalizePhone(target.phone);
  if (!email && !phone) return [];
  const byId = new Map<string, DuplicateLeadMatch>();
  for (const c of candidates) {
    if (c.lead_metadata_id === target.leadId) continue;
    const reasons: DuplicateMatchReason[] = [];
    if (email && normalizeEmail(c.email) === email) reasons.push("email");
    if (phone && normalizePhone(c.phone) === phone) reasons.push("phone");
    if (reasons.length === 0) continue;
    const existing = byId.get(c.lead_metadata_id);
    if (existing) {
      for (const r of reasons) if (!existing.reasons.includes(r)) existing.reasons.push(r);
      continue;
    }
    byId.set(c.lead_metadata_id, {
      leadId: c.lead_metadata_id,
      contactName: c.contact_name,
      company: c.company,
      status: c.status,
      isTest: c.is_test,
      createdAt: c.created_at,
      reasons,
    });
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const DUPLICATE_CANDIDATE_LIMIT = 20;
const CANDIDATE_COLUMNS = "lead_metadata_id, contact_name, company, email, phone, status, is_test, created_at";

type QueryResult = { data: DuplicateLeadCandidate[] | null; error: { message: string } | null };
interface InboxQuery {
  select(columns: string): InboxQuery;
  ilike(column: string, pattern: string): InboxQuery;
  neq(column: string, value: string): InboxQuery;
  limit(count: number): PromiseLike<QueryResult>;
}
interface InboxClient { from(relation: "v_sales_lead_inbox"): InboxQuery }

/**
 * Look up potential duplicates for one lead. Two bounded queries (email, phone),
 * each limited to DUPLICATE_CANDIDATE_LIMIT rows, through the caller's RLS-bound
 * client. Returns `failed: true` instead of throwing so the lead page still renders.
 */
export async function findPotentialDuplicateLeads(
  supabase: InboxClient,
  target: { leadId: string; email: string | null | undefined; phone: string | null | undefined },
): Promise<{ matches: DuplicateLeadMatch[]; failed: boolean }> {
  const email = normalizeEmail(target.email);
  const phone = normalizePhone(target.phone);
  if (!email && !phone) return { matches: [], failed: false };

  const emailQuery = email
    ? supabase.from("v_sales_lead_inbox").select(CANDIDATE_COLUMNS).ilike("email", escapeIlike(email)).neq("lead_metadata_id", target.leadId).limit(DUPLICATE_CANDIDATE_LIMIT)
    : Promise.resolve<QueryResult>({ data: [], error: null });
  const phoneQuery = phone
    ? supabase.from("v_sales_lead_inbox").select(CANDIDATE_COLUMNS).ilike("phone", phoneIlikePattern(phone)).neq("lead_metadata_id", target.leadId).limit(DUPLICATE_CANDIDATE_LIMIT)
    : Promise.resolve<QueryResult>({ data: [], error: null });
  const [emailResult, phoneResult] = await Promise.all([emailQuery, phoneQuery]);
  const failed = Boolean(emailResult.error || phoneResult.error);
  const candidates = [...(emailResult.data ?? []), ...(phoneResult.data ?? [])];
  return { matches: matchDuplicateCandidates(target, candidates), failed };
}
