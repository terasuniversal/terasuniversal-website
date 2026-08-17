"use client";

import { useActionState } from "react";
import { createAction, type FeedbackActionState } from "../actions";
import { FEEDBACK_ISSUE_PRIORITIES } from "../../../../../lib/validation/schemas";

const INITIAL: FeedbackActionState = {};

export function ActionForm({ issues, staff }: { issues: { id: string; title: string }[]; staff: { id: string; full_name: string }[] }) {
  const [state, action, pending] = useActionState(createAction, INITIAL);

  return (
    <form action={action} className="ta-card ta-card-pad" style={{ display: "grid", gap: 10 }}>
      {state.message && <div className="ta-alert ta-alert-success">{state.message}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="ta-field">
          <label htmlFor="action-issue">Linked issue *</label>
          <select id="action-issue" name="issue_id" required defaultValue="">
            <option value="" disabled>Select an issue</option>
            {issues.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
          {state.errors?.issue_id && <span className="ta-error">{state.errors.issue_id}</span>}
        </div>
        <div className="ta-field">
          <label htmlFor="action-assignee">Assigned to</label>
          <select id="action-assignee" name="assigned_to" defaultValue="">
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      </div>

      <div className="ta-field">
        <label htmlFor="action-title">Action title *</label>
        <input id="action-title" name="title" required placeholder="e.g. Improve venue air-conditioning for future sessions" />
        {state.errors?.title && <span className="ta-error">{state.errors.title}</span>}
      </div>

      <div className="ta-fb-fields-4">
        <div className="ta-field">
          <label htmlFor="action-category">Category</label>
          <input id="action-category" name="category" placeholder="e.g. Venue" />
        </div>
        <div className="ta-field">
          <label htmlFor="action-department">Department</label>
          <input id="action-department" name="department" placeholder="e.g. Operations" />
        </div>
        <div className="ta-field">
          <label htmlFor="action-priority">Priority</label>
          <select id="action-priority" name="priority" defaultValue="medium">
            {FEEDBACK_ISSUE_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="ta-field">
          <label htmlFor="action-due">Due date</label>
          <input id="action-due" name="due_date" type="date" />
        </div>
      </div>

      <div className="ta-field">
        <label htmlFor="action-description">Description</label>
        <textarea id="action-description" name="description" rows={3} />
      </div>

      <div>
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending}>{pending ? "Saving…" : "Create Improvement Action"}</button>
      </div>
    </form>
  );
}
