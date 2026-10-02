"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { SalesTaskRow } from "../../../../../lib/sales/crm";
import { taskDueDateTimeLocal, type TaskQueueContext } from "../../../../../lib/sales/task-queue";
import { setTaskStatus, updateTask, type TaskActionState } from "./actions";

const INITIAL_STATE: TaskActionState = {};

function ReturnContextFields({ context }: { context: TaskQueueContext }) {
  return (
    <>
      <input type="hidden" name="return_mode" value="queue" />
      <input type="hidden" name="return_view" value={context.view} />
      <input type="hidden" name="return_owner" value={context.owner} />
      <input type="hidden" name="return_q" value={context.q ?? ""} />
      <input type="hidden" name="return_page" value={String(context.page)} />
    </>
  );
}

function ActionError({ message }: { message?: string }) {
  return message ? <div className="ta-alert ta-alert-error" role="alert">{message}</div> : null;
}

export function TaskQueueActions({ task, context }: { task: SalesTaskRow; context: TaskQueueContext }) {
  const formId = useId();
  const dueInputId = `task-due-${formId}`;
  const dueErrorId = `task-due-error-${formId}`;
  const [completeState, completeAction, completePending] = useActionState(
    setTaskStatus.bind(null, task.id, "completed"),
    INITIAL_STATE,
  );
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState(
    updateTask.bind(null, task.id),
    INITIAL_STATE,
  );
  const busy = completePending || reschedulePending;
  const dueError = rescheduleState.errors?.due_at;
  const dueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dueError) dueInputRef.current?.focus();
  }, [dueError]);

  if (task.status !== "open" && task.status !== "in_progress") return null;

  return (
    <div className="ta-task-actions">
      <form action={completeAction} aria-busy={completePending}>
        <ReturnContextFields context={context} />
        <button
          type="submit"
          className="ta-btn ta-btn-primary ta-btn-sm"
          disabled={busy}
          aria-label={`Complete task: ${task.title}`}
        >
          {completePending ? "Completing…" : "Complete"}
        </button>
        <ActionError message={completeState.message} />
      </form>

      <form action={rescheduleAction} aria-busy={reschedulePending}>
        <ReturnContextFields context={context} />
        <input type="hidden" name="intent" value="reschedule" />
        <label className="ta-sr-only" htmlFor={dueInputId}>
          Due date and time for {task.title}
        </label>
        <input
          id={dueInputId}
          ref={dueInputRef}
          name="due_at"
          type="datetime-local"
          step="60"
          autoComplete="off"
          defaultValue={taskDueDateTimeLocal(task.due_at)}
          required
          aria-invalid={Boolean(dueError)}
          aria-describedby={dueError ? dueErrorId : undefined}
        />
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={busy}>
          {reschedulePending ? "Saving…" : task.due_at ? "Reschedule" : "Set Due Date"}
        </button>
        {dueError && <div id={dueErrorId} className="ta-alert ta-alert-error" role="alert">{dueError}</div>}
        {!dueError && <ActionError message={rescheduleState.message} />}
      </form>
    </div>
  );
}
