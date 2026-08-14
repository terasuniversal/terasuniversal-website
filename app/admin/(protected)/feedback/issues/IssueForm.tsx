"use client";

import { useActionState } from "react";
import { createIssue, type FeedbackActionState } from "../actions";
import { FEEDBACK_ISSUE_PRIORITIES } from "../../../../../lib/validation/schemas";

const INITIAL: FeedbackActionState = {};

export function IssueForm({
  sourceFeedbackId,
  scheduleId,
  defaultCategory,
}: {
  sourceFeedbackId?: string | null;
  scheduleId?: string | null;
  defaultCategory?: string;
}) {
  const [state, action, pending] = useActionState(createIssue, INITIAL);

  return (
    <form action={action} className="ta-card ta-card-pad" style={{ display: "grid", gap: 10 }}>
      {state.message && <div className="ta-alert ta-alert-success">{state.message}</div>}
      {state.errors?._form && <div className="ta-alert ta-alert-error">{state.errors._form}</div>}
      {sourceFeedbackId && <input type="hidden" name="source_feedback_id" value={sourceFeedbackId} />}
      {scheduleId && <input type="hidden" name="schedule_id" value={scheduleId} />}

      <div className="ta-field">
        <label htmlFor="issue-title">Issue title *</label>
        <input id="issue-title" name="title" required defaultValue="" placeholder="e.g. Venue temperature was uncomfortable" />
        {state.errors?.title && <span className="ta-error">{state.errors.title}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div className="ta-field">
          <label htmlFor="issue-category">Category</label>
          <input id="issue-category" name="category" defaultValue={defaultCategory ?? ""} placeholder="e.g. Venue" />
        </div>
        <div className="ta-field">
          <label htmlFor="issue-department">Department</label>
          <input id="issue-department" name="department" placeholder="e.g. Operations" />
        </div>
        <div className="ta-field">
          <label htmlFor="issue-priority">Priority</label>
          <select id="issue-priority" name="priority" defaultValue="medium">
            {FEEDBACK_ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {state.errors?.priority && <span className="ta-error">{state.errors.priority}</span>}
        </div>
      </div>

      <div className="ta-field">
        <label htmlFor="issue-description">Description</label>
        <textarea id="issue-description" name="description" rows={3} />
        {state.errors?.description && <span className="ta-error">{state.errors.description}</span>}
      </div>

      <div>
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending}>{pending ? "Saving…" : "Create Issue"}</button>
      </div>
    </form>
  );
}
