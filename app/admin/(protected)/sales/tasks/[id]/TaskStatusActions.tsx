"use client";

import { useActionState } from "react";
import { Card } from "../../../../../../components/admin/ui";
import { setTaskStatus, type TaskActionState } from "../actions";
import type { SalesTaskStatus } from "../../../../../../lib/sales/crm";
import type { TaskQueueContext } from "../../../../../../lib/sales/task-queue";

const INITIAL_STATE: TaskActionState = {};

type NextStatus = "in_progress" | "completed" | "cancelled" | "open";

function StatusActionButton({
  taskId,
  nextStatus,
  label,
  className,
  context,
}: {
  taskId: string;
  nextStatus: NextStatus;
  label: string;
  className: string;
  context: TaskQueueContext;
}) {
  const [state, formAction, pending] = useActionState(setTaskStatus.bind(null, taskId, nextStatus), INITIAL_STATE);
  return (
    <form action={formAction}>
      <input type="hidden" name="return_mode" value="detail" />
      <input type="hidden" name="return_view" value={context.view} />
      <input type="hidden" name="return_owner" value={context.owner} />
      <input type="hidden" name="return_q" value={context.q ?? ""} />
      <input type="hidden" name="return_page" value={String(context.page)} />
      <button type="submit" className={className} style={{ width: "100%" }} disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {state.message && <div className="ta-alert ta-alert-error" role="alert">{state.message}</div>}
    </form>
  );
}

export function TaskStatusActions({ taskId, status, context }: { taskId: string; status: SalesTaskStatus; context: TaskQueueContext }) {
  return (
    <Card title="Status">
      <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {status === "open" && (
          <StatusActionButton taskId={taskId} nextStatus="in_progress" label="Mark In Progress" className="ta-btn ta-btn-outline ta-btn-sm" context={context} />
        )}
        {(status === "open" || status === "in_progress") && (
          <>
            <StatusActionButton taskId={taskId} nextStatus="completed" label="Complete" className="ta-btn ta-btn-primary ta-btn-sm" context={context} />
            <StatusActionButton taskId={taskId} nextStatus="cancelled" label="Cancel" className="ta-btn ta-btn-danger ta-btn-sm" context={context} />
          </>
        )}
        {(status === "completed" || status === "cancelled") && (
          <StatusActionButton taskId={taskId} nextStatus="open" label="Reopen" className="ta-btn ta-btn-outline ta-btn-sm" context={context} />
        )}
      </div>
    </Card>
  );
}
