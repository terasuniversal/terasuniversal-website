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

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: UserRole;
  is_active: boolean;
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

export interface Attendance {
  id: string;
  schedule_id: string;
  participant_id: string;
  session_date: string;
  present: boolean;
  check_in_time: string | null;
  remarks: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Assessment {
  id: string;
  schedule_id: string | null;
  participant_id: string;
  assessment_type: string | null;
  score: number | null;
  max_score: number | null;
  result: "pending" | "competent" | "not_yet_competent" | "pass" | "fail";
  assessed_by: string | null;
  assessed_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}
export interface Certificate {
  id: string;
  participant_name: string;
  course_name: string;
  certificate_no: string;
  training_start_date: string | null;
  training_end_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: "valid" | "expired" | "revoked";
  created_at: string;
  updated_at: string;
}
/**
 * Minimal Database shape so `createServerClient<Database>()` is typed. Tables
 * not listed here fall back to `any` via the index signature, so nothing
 * breaks before you run `supabase gen types`.
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: any; Insert: any; Update: any; Relationships: [] };
      courses: { Row: any; Insert: any; Update: any; Relationships: [] };
      enquiries: { Row: any; Insert: any; Update: any; Relationships: [] };
      proposal_requests: { Row: any; Insert: any; Update: any; Relationships: [] };
      attendance: { Row: any; Insert: any; Update: any; Relationships: [] };
      assessments: { Row: any; Insert: any; Update: any; Relationships: [] };
      certificates: { Row: Certificate; Insert: Partial<Certificate>; Update: Partial<Certificate>; Relationships: [] };
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
