import { Card } from "../../../../../../components/admin/ui";
import { setTaskStatus } from "../actions";
import type { SalesTaskStatus } from "../../../../../../lib/sales/crm";

/**
 * Plain form-action buttons (no useActionState — setTaskStatus is a
 * fire-and-revalidate mutation with no field-level errors to surface,
 * matching softDeleteSchedule/removeParticipant's existing pattern
 * elsewhere in this codebase).
 */
export function TaskStatusActions({ taskId, status }: { taskId: string; status: SalesTaskStatus }) {
  return (
    <Card title="Status">
      <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {status === "open" && (
          <form action={setTaskStatus.bind(null, taskId, "in_progress")}>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ width: "100%" }}>
              Mark In Progress
            </button>
          </form>
        )}
        {(status === "open" || status === "in_progress") && (
          <>
            <form action={setTaskStatus.bind(null, taskId, "completed")}>
              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" style={{ width: "100%" }}>
                Complete
              </button>
            </form>
            <form action={setTaskStatus.bind(null, taskId, "cancelled")}>
              <button type="submit" className="ta-btn ta-btn-danger ta-btn-sm" style={{ width: "100%" }}>
                Cancel
              </button>
            </form>
          </>
        )}
        {(status === "completed" || status === "cancelled") && (
          <form action={setTaskStatus.bind(null, taskId, "open")}>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ width: "100%" }}>
              Reopen
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}
