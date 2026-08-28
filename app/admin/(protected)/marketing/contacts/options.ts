import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { MarketingCampaign, Profile } from "../../../../../lib/supabase/database.types";

/** Active staff for the Owner dropdown/filter — same query shape as marketing/campaigns/options.ts's loadStaffOptions. */
export async function loadStaffOptions() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  if (error) {
    console.error("marketing_contacts: failed to load staff options", { message: error.message });
    return [];
  }
  const staff = (data ?? []) as unknown as Pick<Profile, "id" | "full_name">[];
  return staff.map((member) => ({ id: member.id, full_name: member.full_name ?? "Unnamed staff" }));
}

/** Non-archived campaign options for the Contact form's source_campaign_id select. */
export async function loadCampaignOptions() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("id, campaign_number, name")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("marketing_contacts: failed to load campaign options", { message: error.message });
    return [];
  }
  const campaigns = (data ?? []) as unknown as Pick<MarketingCampaign, "id" | "campaign_number" | "name">[];
  return campaigns.map((campaign) => ({ id: campaign.id, label: `${campaign.campaign_number} — ${campaign.name}` }));
}
