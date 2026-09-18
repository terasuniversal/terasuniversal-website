import { MYT_TIME_ZONE } from "../date-time";

export type LeadQualificationStatus = "pending" | "qualified" | "unqualified";
export type LeadTemperature = "hot" | "warm" | "cold";

export const QUALIFICATION_STATUS_LABELS: Record<LeadQualificationStatus, string> = { pending: "Pending", qualified: "Qualified", unqualified: "Unqualified" };
export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const QUALIFICATION_REASONS = ["course_match", "budget_confirmed", "decision_maker_engaged", "training_date_fit", "company_requirement_confirmed", "repeat_client", "other"] as const;
export type QualificationReason = (typeof QUALIFICATION_REASONS)[number];
export const QUALIFICATION_REASON_LABELS: Record<QualificationReason, string> = {
  course_match: "Course match", budget_confirmed: "Budget confirmed", decision_maker_engaged: "Decision maker engaged",
  training_date_fit: "Training date fits", company_requirement_confirmed: "Company requirement confirmed", repeat_client: "Repeat client", other: "Other",
};
export const DISQUALIFICATION_REASONS = ["no_budget", "no_requirement", "wrong_course", "outside_target", "no_response", "timing_not_suitable", "duplicate", "invalid_contact", "other"] as const;
export type DisqualificationReason = (typeof DISQUALIFICATION_REASONS)[number];
export const DISQUALIFICATION_REASON_LABELS: Record<DisqualificationReason, string> = {
  no_budget: "No budget", no_requirement: "No current requirement", wrong_course: "Wrong course", outside_target: "Outside target",
  no_response: "No response", timing_not_suitable: "Timing not suitable", duplicate: "Duplicate Lead", invalid_contact: "Invalid contact", other: "Other",
};

export function qualificationLabel(value: string | null | undefined): string {
  return value && value in QUALIFICATION_STATUS_LABELS ? QUALIFICATION_STATUS_LABELS[value as LeadQualificationStatus] : "Pending";
}
export function temperatureLabel(value: string | null | undefined): string {
  return value && value in TEMPERATURE_LABELS ? TEMPERATURE_LABELS[value as LeadTemperature] : "Not set";
}
export function ageLabel(createdAt: string, now = new Date()): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "—";
  const days = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86400000));
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}
export function daysSinceActivityLabel(createdAt: string | null, now = new Date()): string {
  if (!createdAt) return "No activity";
  const activity = new Date(createdAt);
  if (Number.isNaN(activity.getTime())) return "No activity";
  const days = Math.max(0, Math.floor((now.getTime() - activity.getTime()) / 86400000));
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} ago`;
}
export function mytDateKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MYT_TIME_ZONE }).format(value);
}
