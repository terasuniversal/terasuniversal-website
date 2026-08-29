import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge } from "../../../../../../components/admin/ui";
import { SOURCE_LABELS, contactDisplayName } from "../../../../../../lib/marketing/contacts";
import type { MarketingContact, MarketingContactEvent, MarketingContactStatus } from "../../../../../../lib/supabase/database.types";
import { moveContactToNurturing, markContactSalesReady, archiveContact } from "../actions";
import { ContactTimeline } from "./ContactTimeline";
import { ContactActionsPanel } from "./ContactActionsPanel";
import { PromoteToSalesPanel } from "./PromoteToSalesPanel";

export const metadata = { title: "Contact Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function formatDateTime(d: string | null) {
  return d ? new Date(d).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : null;
}

/**
 * The lifecycle quick-action set per current status, per the locked
 * transition matrix (§K of the accompanying report). `promoted` has none —
 * terminal, and this phase never creates a promoted contact anyway
 * (Phase 1B-D's job).
 */
const LIFECYCLE_ACTIONS: Record<MarketingContactStatus, { label: string; action: (id: string) => Promise<void> }[]> = {
  new: [
    { label: "Start Nurturing", action: moveContactToNurturing },
    { label: "Mark Sales Ready", action: markContactSalesReady },
    { label: "Archive", action: archiveContact },
  ],
  nurturing: [
    { label: "Mark Sales Ready", action: markContactSalesReady },
    { label: "Archive", action: archiveContact },
  ],
  sales_ready: [
    { label: "Back to Nurturing", action: moveContactToNurturing },
    { label: "Archive", action: archiveContact },
  ],
  archived: [{ label: "Reactivate (Nurturing)", action: moveContactToNurturing }],
  promoted: [],
};

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess("marketing_contacts");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: contact, error } = await supabase.from("marketing_contacts").select("*").eq("id", id).maybeSingle();
  if (error) {
    return (
      <>
        <PageHead title="Contact" subtitle="Could not load this contact." />
        <div className="ta-alert ta-alert-error">Could not load this contact. Please try again later.</div>
      </>
    );
  }
  if (!contact) notFound();
  const c = contact as MarketingContact;

  let ownerName: string | null = null;
  if (c.owner_id) {
    const { data: owner, error: ownerError } = await supabase.from("profiles").select("full_name").eq("id", c.owner_id).maybeSingle();
    if (ownerError) console.error("marketing_contacts detail: failed to load owner name", { message: ownerError.message });
    ownerName = owner?.full_name ?? null;
  }
  let campaignLabel: string | null = null;
  if (c.source_campaign_id) {
    const { data: campaign, error: campaignError } = await supabase
      .from("marketing_campaigns")
      .select("campaign_number, name")
      .eq("id", c.source_campaign_id)
      .maybeSingle();
    if (campaignError) console.error("marketing_contacts detail: failed to load source campaign", { message: campaignError.message });
    campaignLabel = campaign ? `${campaign.campaign_number} — ${campaign.name}` : null;
  }
  // Read-only display of the linked Sales Lead, if this contact was ever
  // promoted (Phase 1B-D — public.promote_marketing_contact_to_sales).
  let promotedLeadStatus: string | null = null;
  if (c.promoted_lead_metadata_id) {
    const { data: lead, error: leadError } = await supabase
      .from("sales_lead_metadata")
      .select("status")
      .eq("id", c.promoted_lead_metadata_id)
      .maybeSingle();
    if (leadError) console.error("marketing_contacts detail: failed to load promoted lead reference", { message: leadError.message });
    promotedLeadStatus = lead?.status ?? null;
  }

  const { data: eventRows, error: eventsError } = await supabase
    .from("marketing_contact_events")
    .select("*")
    .eq("contact_id", id)
    .order("created_at", { ascending: false });
  if (eventsError) console.error("marketing_contacts detail: failed to load timeline", { message: eventsError.message });
  const events = (eventRows ?? []) as MarketingContactEvent[];

  const actorIds = Array.from(new Set(events.map((e) => e.actor_id).filter((x): x is string => Boolean(x))));
  let actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actorRows, error: actorError } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    if (actorError) console.error("marketing_contacts detail: failed to load timeline actor names", { message: actorError.message });
    actorNames = new Map(((actorRows ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  }

  const lifecycleActions = LIFECYCLE_ACTIONS[c.status];
  const isPromoted = c.status === "promoted";

  return (
    <>
      <PageHead
        title={contactDisplayName(c)}
        subtitle={c.contact_number}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/marketing/contacts" className="ta-btn ta-btn-outline">
              ← Back to Contacts
            </Link>
            <Link href={`/admin/marketing/contacts/${c.id}/edit`} className="ta-btn ta-btn-primary">
              Edit Contact
            </Link>
          </div>
        }
      />

      <div className="ta-lead-meta">
        <Badge status={c.status} />
        <Badge status={c.consent_status} />
        {!isPromoted &&
          lifecycleActions.map((item) => (
            <form key={item.label} action={item.action.bind(null, c.id)}>
              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">
                {item.label}
              </button>
            </form>
          ))}
        <span className="ta-lead-meta-time">Created {formatDateTime(c.created_at)}</span>
      </div>

      <div className="ta-lead-detail-grid">
        <div className="ta-lead-detail-main">
          <Card title="Contact Information">
            <div className="ta-card-pad">
              <dl className="ta-kv">
                <Detail label="Contact Number" value={c.contact_number} />
                <Detail label="Full Name" value={c.full_name} />
                <Detail label="Email" value={c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null} />
                <Detail label="Phone" value={c.phone} />
                <Detail label="Company" value={c.company} />
                <Detail label="Status" value={<Badge status={c.status} />} />
                <Detail label="Source" value={SOURCE_LABELS[c.source]} />
                <Detail label="Source Campaign" value={campaignLabel} />
                <Detail label="Owner" value={ownerName} />
                <Detail
                  label="Next Follow-up"
                  value={isPromoted ? "No longer used — see linked Sales Lead" : formatDateTime(c.next_follow_up_at)}
                />
                <Detail label="Created" value={formatDateTime(c.created_at)} />
                <Detail label="Last Updated" value={formatDateTime(c.updated_at)} />
              </dl>
            </div>
          </Card>

          <Card title="Consent">
            <div className="ta-card-pad">
              <dl className="ta-kv">
                <Detail label="Status" value={<Badge status={c.consent_status} />} />
                <Detail label="Source" value={c.consent_source} />
                <Detail label="Consented" value={formatDateTime(c.consented_at)} />
                <Detail label="Unsubscribed" value={formatDateTime(c.unsubscribed_at)} />
              </dl>
            </div>
          </Card>

          <Card title="Promotion Status">
            <div className="ta-card-pad">
              {c.promoted_lead_metadata_id ? (
                <p style={{ margin: 0 }}>
                  Promoted to Sales{c.promoted_at ? ` on ${formatDateTime(c.promoted_at)}` : ""}.{" "}
                  {promotedLeadStatus && (
                    <>
                      Sales Lead status: <Badge status={promotedLeadStatus} />{" "}
                    </>
                  )}
                  <Link href={`/admin/sales/leads/${c.promoted_lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm" style={{ marginLeft: 8 }}>
                    View Sales Lead →
                  </Link>
                </p>
              ) : (
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>Not promoted to Sales.</p>
              )}
            </div>
          </Card>

          <ContactTimeline events={events} actorNames={actorNames} />
        </div>

        <div className="ta-lead-detail-side">
          {c.status === "sales_ready" && !c.promoted_lead_metadata_id && <PromoteToSalesPanel contactId={c.id} />}
          <ContactActionsPanel contactId={c.id} consentStatus={c.consent_status} consentSource={c.consent_source} />
        </div>
      </div>
    </>
  );
}
