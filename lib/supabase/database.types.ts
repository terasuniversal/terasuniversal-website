/**
 * Database types.
 *
 * This is a curated, hand-written subset covering the tables the reference
 * modules use. For the FULL, always-accurate type set, regenerate after any
 * migration with the Supabase CLI:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > lib/supabase/database.types.ts
 *
 * Keeping this file in the repo means TypeScript works before you run the
 * generator, and CI can regenerate it.
 */

export type ContentStatus = "draft" | "scheduled" | "published" | "archived";
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type UserRole =
  | "super_admin"
  | "admin"
  | "editor"
  | "trainer"
  | "client"
  | "participant";
export type StaffDepartment =
  | "sales"
  | "marketing"
  | "training_operations"
  | "finance"
  | "administration"
  | "management"
  | "hr";
export type ModuleAccessLevel = "view" | "edit" | "admin";
export type EnquiryStatus =
  | "new"
  | "in_review"
  | "assigned"
  | "responded"
  | "closed"
  | "archived";
export type ProposalStatus =
  | "new"
  | "in_review"
  | "assigned"
  | "quoted"
  | "won"
  | "lost"
  | "archived";
export type ScheduleStatus =
  | "open"
  | "closing_soon"
  | "full"
  | "in_progress"
  | "completed"
  | "cancelled";
export type CourseDeliveryMode =
  | "public"
  | "in_house"
  | "onsite"
  | "online"
  | "hybrid";
export type CertificateType = "participation" | "completion" | "competency";
export type ParticipantSkillArea =
  | "theory_session"
  | "practical_training"
  | "safety_awareness"
  | "practical_assessment";
export type ParticipantSkillStatus = "not_recorded" | "completed" | "passed" | "failed";
export type CertificateSkillArea =
  | "theory_session"
  | "practical_training"
  | "safety_awareness"
  | "practical_assessment"
  | "attendance_requirement";
export type CertificateSkillStatus = "not_recorded" | "completed" | "passed" | "failed" | "met" | "not_met";
export type MarketingCampaignChannel =
  | "meta_ads" | "facebook_organic" | "instagram" | "tiktok" | "google"
  | "whatsapp" | "email" | "website" | "event" | "referral" | "other";
export type MarketingCampaignStatus = "draft" | "active" | "completed" | "archived";
export type MarketingContactStatus = "new" | "nurturing" | "sales_ready" | "promoted" | "archived";
export type MarketingContactSource = "manual" | "newsletter" | "event" | "referral" | "import" | "website" | "other";
export type MarketingContactConsentStatus = "not_set" | "opted_in" | "opted_out";
export type LeadAttributionSource = "facebook" | "tiktok" | "whatsapp" | "website" | "referral" | "other";
export type MarketingContactEventType = "created" | "status_changed" | "note_added" | "campaign_linked" | "consent_changed" | "unsubscribed" | "promoted_to_sales";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: UserRole;
  department: StaffDepartment | null;
  is_active: boolean;
  access_control_enabled: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  summary: string | null;
  overview: string | null;
  objectives: string[];
  duration: string | null;
  delivery_modes: CourseDeliveryMode[];
  target_audience: string[];
  requirements: string[];
  modules: { title: string; items?: string[] }[];
  faq: { q: string; a: string }[];
  brochure_media_id: string | null;
  hero_image_url: string | null;
  fee: number | null;
  status: ContentStatus;
  featured: boolean;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[];
  published_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  certificate_type: CertificateType;
  attendance_min_percent: number;
  assessment_required: boolean;
  competency_required: boolean;
  certificate_generation_enabled: boolean;
  certificate_template_id: string | null;
}

export interface CourseCommercialProfile {
  id: string;
  course_id: string;
  standard_display_name: string;
  hrdf_display_name: string | null;
  hrdf_claimable: boolean;
  quotation_description: string;
  package_includes: Json[];
  accommodation_included_default: boolean;
  accommodation_description_default: string | null;
  meals_included_default: boolean;
  meals_description_default: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  subject: string | null;
  message: string;
  source: string | null;
  status: EnquiryStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProposalRequest {
  id: string;
  company_name: string;
  contact_person: string;
  job_title: string | null;
  email: string;
  phone: string;
  industry: string | null;
  category: string | null;
  programme: string | null;
  participants: number | null;
  location: string | null;
  preferred_month: string | null;
  budget: string | null;
  objectives: string | null;
  notes: string | null;
  status: ProposalStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ParticipantSkillResult {
  id: string;
  schedule_id: string;
  participant_id: string;
  area: ParticipantSkillArea;
  status: ParticipantSkillStatus;
  score: number | null;
  notes: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CertificateSkillResult {
  id: string;
  certificate_id: string;
  area: CertificateSkillArea;
  status: CertificateSkillStatus;
  score: number | null;
  notes: string | null;
  source_skill_result_id: string | null;
  created_at: string;
}

export interface MarketingCampaign {
  id: string;
  campaign_number: string;
  name: string;
  channel: MarketingCampaignChannel;
  status: MarketingCampaignStatus;
  objective: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  actual_spend: number | null;
  owner_id: string | null;
  course_id: string | null;
  utm_campaign: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingContact {
  id: string;
  contact_number: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: MarketingContactStatus;
  source: MarketingContactSource;
  source_campaign_id: string | null;
  consent_status: MarketingContactConsentStatus;
  consent_source: string | null;
  consented_at: string | null;
  unsubscribed_at: string | null;
  owner_id: string | null;
  promoted_lead_metadata_id: string | null;
  promoted_at: string | null;
  next_follow_up_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingContactEvent {
  id: string;
  contact_id: string;
  event_type: MarketingContactEventType;
  note: string | null;
  campaign_id: string | null;
  lead_metadata_id: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface SalesLeadAttribution {
  id: string;
  lead_metadata_id: string;
  source: LeadAttributionSource;
  campaign_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesInternalLeadSource {
  id: string;
  contact_name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  course_interest: string | null;
  notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Exact staging-generated row shape for the Sales Lead qualification fields. */
export interface SalesLeadMetadata {
  assigned_to: string | null;
  created_at: string;
  disqualification_reason: string | null;
  follow_up_at: string | null;
  id: string;
  is_test: boolean;
  lead_source: string;
  lost_reason: string | null;
  priority: string;
  qualification_changed_at: string | null;
  qualification_changed_by: string | null;
  qualification_reason: string | null;
  qualification_status: string;
  source_id: string;
  status: string;
  temperature: string | null;
  updated_at: string;
  won_at: string | null;
}

export interface SalesLeadMetadataInsert {
  assigned_to?: string | null;
  created_at?: string;
  disqualification_reason?: string | null;
  follow_up_at?: string | null;
  id?: string;
  is_test?: boolean;
  lead_source: string;
  lost_reason?: string | null;
  priority?: string;
  qualification_changed_at?: string | null;
  qualification_changed_by?: string | null;
  qualification_reason?: string | null;
  qualification_status?: string;
  source_id: string;
  status?: string;
  temperature?: string | null;
  updated_at?: string;
  won_at?: string | null;
}

export type SalesLeadMetadataUpdate = Partial<SalesLeadMetadataInsert>;

/** Exact staging-generated row shape for append-only Sales Activity metadata. */
export interface SalesActivity {
  actor_id: string | null;
  created_at: string;
  id: string;
  lead_metadata_id: string;
  metadata: Json;
  note: string | null;
  opportunity_id: string | null;
  quotation_id: string | null;
  type: string;
}

export interface SalesActivityInsert {
  actor_id?: string | null;
  created_at?: string;
  id?: string;
  lead_metadata_id: string;
  metadata?: Json;
  note?: string | null;
  opportunity_id?: string | null;
  quotation_id?: string | null;
  type: string;
}

export type SalesActivityUpdate = Partial<SalesActivityInsert>;

/**
 * Minimal Database shape so `createServerClient<Database>()` is typed. Tables
 * not listed here fall back to `any` via the index signature, so nothing
 * breaks before you run `supabase gen types`.
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile>; Relationships: [] };
      courses: { Row: Course; Insert: Partial<Course>; Update: Partial<Course>; Relationships: [] };
      course_commercial_profiles: {
        Row: CourseCommercialProfile;
        Insert: Partial<CourseCommercialProfile>;
        Update: Partial<CourseCommercialProfile>;
        Relationships: [];
      };
      enquiries: { Row: Enquiry; Insert: Partial<Enquiry>; Update: Partial<Enquiry>; Relationships: [] };
      proposal_requests: {
        Row: ProposalRequest;
        Insert: Partial<ProposalRequest>;
        Update: Partial<ProposalRequest>;
        Relationships: [];
      };
      marketing_campaigns: {
        Row: MarketingCampaign;
        Insert: Partial<MarketingCampaign>;
        Update: Partial<MarketingCampaign>;
        Relationships: [];
      };
      marketing_contacts: {
        Row: MarketingContact;
        Insert: Partial<MarketingContact>;
        Update: Partial<MarketingContact>;
        Relationships: [];
      };
      marketing_contact_events: {
        Row: MarketingContactEvent;
        Insert: Partial<MarketingContactEvent>;
        Update: Partial<MarketingContactEvent>;
        Relationships: [];
      };
      sales_lead_attributions: {
        Row: SalesLeadAttribution;
        Insert: Partial<SalesLeadAttribution>;
        Update: Partial<SalesLeadAttribution>;
        Relationships: [];
      };
      sales_internal_lead_sources: {
        Row: SalesInternalLeadSource;
        Insert: Partial<SalesInternalLeadSource>;
        Update: Partial<SalesInternalLeadSource>;
        Relationships: [];
      };
      sales_lead_metadata: {
        Row: SalesLeadMetadata;
        Insert: SalesLeadMetadataInsert;
        Update: SalesLeadMetadataUpdate;
        Relationships: [];
      };
      sales_activity: {
        Row: SalesActivity;
        Insert: SalesActivityInsert;
        Update: SalesActivityUpdate;
        Relationships: [];
      };
      participant_skill_results: {
        Row: ParticipantSkillResult;
        Insert: Partial<ParticipantSkillResult>;
        Update: Partial<ParticipantSkillResult>;
        Relationships: [];
      };
      certificate_skill_results: {
        Row: CertificateSkillResult;
        Insert: Partial<CertificateSkillResult>;
        Update: Partial<CertificateSkillResult>;
        Relationships: [];
      };
      // New operational tables are added through migrations. This fallback
      // keeps the client usable before CI regenerates the complete types.
      [key: string]: { Row: any; Insert: any; Update: any; Relationships: [] };
    };
    Views: { [key: string]: { Row: any } };
    Functions: { [key: string]: any };
    Enums: {
      user_role: UserRole;
      content_status: ContentStatus;
      enquiry_status: EnquiryStatus;
      proposal_status: ProposalStatus;
      schedule_status: ScheduleStatus;
      course_delivery_mode: CourseDeliveryMode;
    };
  };
}
