import { MYT_TIME_ZONE } from "../date-time";
import { OPEN_OPPORTUNITY_STAGES, type SalesOpportunityRow, type SalesTaskRow } from "./crm";

export type OpportunityExpectedCloseState = "none" | "upcoming" | "due_soon" | "overdue";

export type OpportunityPipelineActivity = {
  opportunity_id: string | null;
  created_at: string;
};

const MYT_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: MYT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateKeyInMyt(value: Date): string {
  const parts = MYT_DATE_FORMATTER.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function shiftMytDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mytTodayKey(now: Date = new Date()): string {
  return dateKeyInMyt(now);
}

export function mytDateRangeUtc(dateKey: string, endExclusive = false): string {
  const instant = new Date(`${dateKey}T00:00:00+08:00`);
  if (endExclusive) instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString();
}

export function expectedCloseState(expectedCloseDate: string | null, now: Date = new Date()): OpportunityExpectedCloseState {
  if (!expectedCloseDate) return "none";
  const today = mytTodayKey(now);
  if (expectedCloseDate < today) return "overdue";
  return expectedCloseDate <= shiftMytDateKey(today, 7) ? "due_soon" : "upcoming";
}

export function ageDays(createdAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}

export function ageLabel(createdAt: string, now: Date = new Date()): string {
  const days = ageDays(createdAt, now);
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}

export function sinceActivityLabel(activityAt: string | null, fallbackAt: string, now: Date = new Date()): string {
  if (!activityAt) return ageDays(fallbackAt, now) === 0 ? "Today" : `${ageDays(fallbackAt, now)} day${ageDays(fallbackAt, now) === 1 ? "" : "s"} ago`;
  const days = ageDays(activityAt, now);
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} ago`;
}

function activeTask(task: Pick<SalesTaskRow, "status" | "deleted_at">): boolean {
  return task.deleted_at == null && task.status !== "completed" && task.status !== "cancelled";
}

function taskOrder(a: Pick<SalesTaskRow, "due_at" | "created_at" | "id">, b: Pick<SalesTaskRow, "due_at" | "created_at" | "id">): number {
  if (a.due_at == null && b.due_at != null) return 1;
  if (a.due_at != null && b.due_at == null) return -1;
  if (a.due_at !== b.due_at) return (a.due_at ?? "").localeCompare(b.due_at ?? "");
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
  return a.id.localeCompare(b.id);
}

export function nextOpportunityTask(tasks: SalesTaskRow[]): SalesTaskRow | null {
  return tasks.filter(activeTask).sort(taskOrder)[0] ?? null;
}

export function latestOpportunityActivity(activities: OpportunityPipelineActivity[], fallbackAt: string): string {
  return activities.reduce((latest, activity) => activity.created_at > latest ? activity.created_at : latest, fallbackAt);
}

export function hasFutureActiveTask(tasks: SalesTaskRow[], now: Date = new Date()): boolean {
  return tasks.some((task) => activeTask(task) && task.due_at != null && new Date(task.due_at) >= now);
}

export function isStalledOpportunity(
  opportunity: Pick<SalesOpportunityRow, "stage" | "created_at">,
  tasks: SalesTaskRow[],
  activities: OpportunityPipelineActivity[],
  now: Date = new Date(),
): boolean {
  if (!OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage)) return false;
  if (hasFutureActiveTask(tasks, now)) return false;
  const latest = latestOpportunityActivity(activities, opportunity.created_at);
  return now.getTime() - new Date(latest).getTime() > 7 * 86_400_000;
}

export function weightedPipelineValue(estimatedValue: number | null, probability: number | null): number {
  return Math.max(0, Number(estimatedValue ?? 0)) * Math.max(0, Math.min(100, Number(probability ?? 0))) / 100;
}

export function formatMoney(value: number | null): string {
  return value == null ? "—" : `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
