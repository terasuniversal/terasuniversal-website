import { parseMalaysiaDateTimeLocal } from "./malaysia-datetime-local.js";

export const TASK_QUEUE_VIEWS = ["all", "overdue", "today", "upcoming", "completed"] as const;
export type TaskQueueView = (typeof TASK_QUEUE_VIEWS)[number];
export type TaskQueueFeedback = "completed" | "rescheduled" | "updated" | "activity-warning";

export type TaskQueueContext = {
  view: TaskQueueView;
  owner: string;
  q: string | undefined;
  page: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_MESSAGES: Record<TaskQueueFeedback, string> = {
  completed: "Task completed.",
  rescheduled: "Task due date updated.",
  updated: "Task changes saved.",
  "activity-warning": "Task status changed, but its activity history could not be saved. Please report this issue.",
};

function valueOf(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export function normalizeTaskQueueContext(input: Readonly<Record<string, unknown>>): TaskQueueContext {
  const rawView = valueOf(input, "view");
  const view: TaskQueueView = TASK_QUEUE_VIEWS.includes(rawView as TaskQueueView) ? rawView as TaskQueueView : "all";
  const rawOwner = valueOf(input, "owner");
  const owner = rawOwner === "all" || rawOwner === "mine" || (rawOwner != null && UUID_PATTERN.test(rawOwner)) ? rawOwner : "mine";
  const rawQuery = valueOf(input, "q")?.trim();
  const q = rawQuery || undefined;
  const rawPage = valueOf(input, "page");
  const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  return { view, owner, q, page };
}

export function taskQueueHref(context: TaskQueueContext): string {
  const params = new URLSearchParams({ view: context.view, owner: context.owner });
  if (context.q) params.set("q", context.q);
  if (context.page > 1) params.set("page", String(context.page));
  return `/admin/sales/tasks?${params.toString()}`;
}

export function taskQueueReturnHref(context: TaskQueueContext, feedback: TaskQueueFeedback): string {
  const params = new URLSearchParams({ view: context.view, owner: context.owner });
  if (context.q) params.set("q", context.q);
  params.set("page", String(context.page));
  params.set("feedback", feedback);
  return `/admin/sales/tasks?${params.toString()}`;
}

export function taskQueueContextFromForm(formData: Pick<FormData, "get">): TaskQueueContext {
  return normalizeTaskQueueContext({
    view: formData.get("return_view"),
    owner: formData.get("return_owner"),
    q: formData.get("return_q"),
    page: formData.get("return_page"),
  });
}

export function taskActionReturnHref(
  formData: Pick<FormData, "get">,
  taskId: string,
  feedback: TaskQueueFeedback,
): string {
  if (formData.get("return_mode") === "detail" && UUID_PATTERN.test(taskId)) {
    const context = taskQueueContextFromForm(formData);
    const params = new URLSearchParams({ view: context.view, owner: context.owner, page: String(context.page), feedback });
    if (context.q) params.set("q", context.q);
    return `/admin/sales/tasks/${encodeURIComponent(taskId)}?${params.toString()}`;
  }
  return taskQueueReturnHref(taskQueueContextFromForm(formData), feedback);
}

export function parseTaskDueDateTimeLocal(value: string): string | null {
  return parseMalaysiaDateTimeLocal(value);
}

/** Render a scheduled CRM instant as a Malaysia-local datetime-local value. */
export function salesDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

/** Render a Task instant for its queue/reschedule input. */
export function taskDueDateTimeLocal(value: string | null): string {
  return salesDateTimeLocal(value);
}

export type TaskLifecycleStatus = "open" | "in_progress" | "completed" | "cancelled";
export type TaskTransitionResult = "apply" | "already_completed" | "invalid";

export function taskStatusTransition(current: TaskLifecycleStatus, next: TaskLifecycleStatus): TaskTransitionResult {
  if (current === "completed" && next === "completed") return "already_completed";
  const allowed: Record<TaskLifecycleStatus, readonly TaskLifecycleStatus[]> = {
    open: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: ["open"],
    cancelled: ["open"],
  };
  return allowed[current].includes(next) ? "apply" : "invalid";
}

export type TaskRelatedRecord = { kind: "lead" | "opportunity" | "quotation"; id: string; href: string };

export function resolveTaskRelatedRecord(task: {
  lead_metadata_id: string | null;
  opportunity_id: string | null;
  quotation_id: string | null;
}): TaskRelatedRecord | null {
  if (task.opportunity_id) {
    return { kind: "opportunity", id: task.opportunity_id, href: `/admin/sales/opportunities/${encodeURIComponent(task.opportunity_id)}` };
  }
  if (task.lead_metadata_id) {
    return { kind: "lead", id: task.lead_metadata_id, href: `/admin/sales/leads/${encodeURIComponent(task.lead_metadata_id)}` };
  }
  if (task.quotation_id) {
    return { kind: "quotation", id: task.quotation_id, href: `/admin/sales/quotations/${encodeURIComponent(task.quotation_id)}` };
  }
  return null;
}

export function taskQueueFeedbackMessage(value: string | undefined): string | null {
  return value && Object.hasOwn(FEEDBACK_MESSAGES, value) ? FEEDBACK_MESSAGES[value as TaskQueueFeedback] : null;
}
