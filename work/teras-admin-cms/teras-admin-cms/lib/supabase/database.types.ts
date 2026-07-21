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

/**
 * Minimal Database shape so `createServerClient<Database>()` is typed. Tables
 * not listed here fall back to `any` via the index signature, so nothing
 * breaks before you run `supabase gen types`.
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      courses: { Row: Course; Insert: Partial<Course>; Update: Partial<Course> };
      enquiries: { Row: Enquiry; Insert: Partial<Enquiry>; Update: Partial<Enquiry> };
      proposal_requests: {
        Row: ProposalRequest;
        Insert: Partial<ProposalRequest>;
        Update: Partial<ProposalRequest>;
      };
      [key: string]: { Row: any; Insert: any; Update: any };
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
