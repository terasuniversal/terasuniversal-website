"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { CampaignFormState } from "./actions";
import { Field, Input, Textarea, Select, fieldA11y } from "../../../../../components/admin/ui";
import { CHANNEL_LABELS } from "../../../../../lib/marketing/campaigns";
import { MARKETING_CAMPAIGN_CHANNELS } from "../../../../../lib/validation/schemas";
import type { MarketingCampaign } from "../../../../../lib/supabase/database.types";

const INITIAL: CampaignFormState = {};

/**
 * Shared create/edit form (Step 2C adds the `campaign` prop, matching
 * CourseForm's `course?` inference pattern — no separate `mode` string).
 * Status is never exposed here in either mode: creation always starts as
 * `draft` server-side, and lifecycle changes go through the dedicated
 * Activate/Complete/Archive quick actions on the detail page instead of
 * this form, mirroring OpportunityActionsPanel's "Edit" vs "Stage" split.
 */
export function CampaignForm({
  action,
  staff,
  courses,
  campaign,
}: {
  action: (prev: CampaignFormState, fd: FormData) => Promise<CampaignFormState>;
  staff: { id: string; full_name: string }[];
  courses: { id: string; label: string }[];
  campaign?: MarketingCampaign;
}) {
  const [state, formAction, pending] = useActionState<CampaignFormState, FormData>(action, INITIAL);
  const e = state.errors ?? {};
  const utmA11y = fieldA11y("utm_campaign", { hasHint: true, hasError: Boolean(e.utm_campaign) });
  const cancelHref = campaign ? `/admin/marketing/campaigns/${campaign.id}` : "/admin/marketing/campaigns";

  return (
    <form action={formAction} className="ta-form" style={{ maxWidth: 720 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}

      <div className="ta-field-row">
        <Field label="Campaign name" name="name" error={e.name} required>
          <Input id="name" name="name" defaultValue={campaign?.name ?? ""} required maxLength={160} />
        </Field>
        <Field label="Channel" name="channel" error={e.channel} required>
          <Select id="channel" name="channel" defaultValue={campaign?.channel ?? ""} required>
            <option value="" disabled>
              Select a channel
            </option>
            {MARKETING_CAMPAIGN_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Start date" name="start_date" error={e.start_date}>
          <Input id="start_date" name="start_date" type="date" defaultValue={campaign?.start_date ?? ""} />
        </Field>
        <Field label="End date" name="end_date" error={e.end_date}>
          <Input id="end_date" name="end_date" type="date" defaultValue={campaign?.end_date ?? ""} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Budget (RM)" name="budget" error={e.budget}>
          <Input id="budget" name="budget" type="number" min={0} step="0.01" defaultValue={campaign?.budget ?? ""} />
        </Field>
        <Field label="Actual spend (RM)" name="actual_spend" error={e.actual_spend}>
          <Input id="actual_spend" name="actual_spend" type="number" min={0} step="0.01" defaultValue={campaign?.actual_spend ?? ""} />
        </Field>
      </div>

      <div className="ta-field-row">
        <Field label="Owner" name="owner_id" error={e.owner_id}>
          <Select id="owner_id" name="owner_id" defaultValue={campaign?.owner_id ?? ""}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course" name="course_id" error={e.course_id}>
          <Select id="course_id" name="course_id" defaultValue={campaign?.course_id ?? ""}>
            <option value="">No specific course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="UTM campaign"
        name="utm_campaign"
        error={e.utm_campaign}
        hint="Machine-safe tag used to tie web traffic back to this campaign"
        controlId="utm_campaign"
      >
        <Input
          id="utm_campaign"
          name="utm_campaign"
          maxLength={160}
          defaultValue={campaign?.utm_campaign ?? ""}
          aria-describedby={utmA11y.describedBy}
          aria-invalid={utmA11y.invalid}
        />
      </Field>

      <Field label="Notes" name="notes" error={e.notes}>
        <Textarea id="notes" name="notes" rows={4} defaultValue={campaign?.notes ?? ""} />
      </Field>

      <div className="ta-form-actions">
        <Link href={cancelHref} className="ta-btn ta-btn-outline">
          Cancel
        </Link>
        <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>
          {pending ? "Saving…" : campaign ? "Save changes" : "Create Campaign"}
        </button>
      </div>
    </form>
  );
}
