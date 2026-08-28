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

export interface MarketingCampaign {
  id: string; campaign_number: string; name: string; channel: "meta_ads" | "facebook_organic" | "instagram" | "tiktok" | "google" | "whatsapp" | "email" | "website" | "event" | "referral" | "other";
  status: "draft" | "active" | "completed" | "archived"; objective: string | null; budget: number | null;
  start_date: string | null; end_date: string | null; notes: string | null; course_id: string | null; owner_id: string | null; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}
export interface LeadAttribution {
  id: string; lead_metadata_id: string; source: "facebook" | "tiktok" | "whatsapp" | "website" | "referral" | "other"; campaign_id: string | null;
  notes: string | null; created_at: string; updated_at: string;
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
      enquiries: { Row: Enquiry; Insert: Partial<Enquiry>; Update: Partial<Enquiry>; Relationships: [] };
      proposal_requests: {
        Row: ProposalRequest;
        Insert: Partial<ProposalRequest>;
        Update: Partial<ProposalRequest>;
        Relationships: [];
      };
      marketing_campaigns: { Row: MarketingCampaign; Insert: Partial<MarketingCampaign>; Update: Partial<MarketingCampaign>; Relationships: [] };
      sales_lead_attributions: { Row: LeadAttribution; Insert: Partial<LeadAttribution>; Update: Partial<LeadAttribution>; Relationships: [] };
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
