"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_CHANNELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_ORDER, type MarketingCampaignRow } from "../../../../../lib/marketing/crm";
import type { CampaignFormState } from "./actions";

export function CampaignForm({ action, campaign }: { action: (prev: CampaignFormState, fd: FormData) => Promise<CampaignFormState>; campaign?: MarketingCampaignRow }) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  return <form action={formAction} className="ta-form" style={{ maxWidth: 820 }}>
    {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
    <Card title="Campaign details"><div className="ta-form-pad">
      <div className="ta-field-row">
        <Field label="Campaign name" name="name" error={errors.name} required><input id="name" name="name" defaultValue={campaign?.name ?? ""} required /></Field>
        <Field label="Channel" name="channel" error={errors.channel} required><select id="channel" name="channel" defaultValue={campaign?.channel ?? "facebook_organic"}>{CAMPAIGN_CHANNELS.map((p) => <option key={p} value={p}>{CAMPAIGN_CHANNEL_LABELS[p]}</option>)}</select></Field>
      </div>
      <div className="ta-field-row">
        <Field label="Status" name="status" error={errors.status}><select id="status" name="status" defaultValue={campaign?.status ?? "draft"}>{CAMPAIGN_STATUS_ORDER.map((s) => <option key={s} value={s}>{CAMPAIGN_STATUS_LABELS[s]}</option>)}</select></Field>
        <Field label="Budget (RM)" name="budget" error={errors.budget}><input id="budget" name="budget" type="number" min="0" step="0.01" defaultValue={campaign?.budget ?? ""} /></Field>
      </div>
      <div className="ta-field-row"><Field label="Start date" name="start_date" error={errors.start_date}><input id="start_date" name="start_date" type="date" defaultValue={campaign?.start_date ?? ""} /></Field><Field label="End date" name="end_date" error={errors.end_date}><input id="end_date" name="end_date" type="date" defaultValue={campaign?.end_date ?? ""} /></Field></div>
      <Field label="Objective" name="objective" error={errors.objective}><textarea id="objective" name="objective" rows={3} defaultValue={campaign?.objective ?? ""} /></Field>
      <Field label="Notes" name="notes" error={errors.notes}><textarea id="notes" name="notes" rows={4} defaultValue={campaign?.notes ?? ""} /></Field>
    </div></Card>
    <div className="ta-form-actions"><Link href="/admin/marketing/campaigns" className="ta-btn ta-btn-outline">Cancel</Link><button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : campaign ? "Save changes" : "Create campaign"}</button></div>
  </form>;
}
