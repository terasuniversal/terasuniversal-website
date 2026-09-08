export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          display_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      assessments: {
        Row: {
          assessed_at: string | null
          assessment_type: string | null
          assessor_id: string | null
          competency_status: string | null
          created_at: string
          deleted_at: string | null
          id: string
          legacy_batch_id: string | null
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          max_score: number | null
          participant_id: string
          practical_result: string
          practical_score: number | null
          remarks: string | null
          result: string
          schedule_id: string | null
          score: number | null
          theory_result: string
          theory_score: number | null
          updated_at: string
        }
        Insert: {
          assessed_at?: string | null
          assessment_type?: string | null
          assessor_id?: string | null
          competency_status?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_batch_id?: string | null
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          max_score?: number | null
          participant_id: string
          practical_result?: string
          practical_score?: number | null
          remarks?: string | null
          result?: string
          schedule_id?: string | null
          score?: number | null
          theory_result?: string
          theory_score?: number | null
          updated_at?: string
        }
        Update: {
          assessed_at?: string | null
          assessment_type?: string | null
          assessor_id?: string | null
          competency_status?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_batch_id?: string | null
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          max_score?: number | null
          participant_id?: string
          practical_result?: string
          practical_score?: number | null
          remarks?: string | null
          result?: string
          schedule_id?: string | null
          score?: number | null
          theory_result?: string
          theory_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_assessor_id_fkey"
            columns: ["assessor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      assessors: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          ic_passport_no: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization: string | null
          phone: string | null
          qualification: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          ic_passport_no?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization?: string | null
          phone?: string | null
          qualification?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          ic_passport_no?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization?: string | null
          phone?: string | null
          qualification?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessors_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          attendance_status: string
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          deleted_at: string | null
          id: string
          legacy_batch_id: string | null
          participant_id: string
          present: boolean
          recorded_by: string | null
          remarks: string | null
          schedule_id: string
          session_date: string
          updated_at: string
        }
        Insert: {
          attendance_status?: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_batch_id?: string | null
          participant_id: string
          present?: boolean
          recorded_by?: string | null
          remarks?: string | null
          schedule_id: string
          session_date: string
          updated_at?: string
        }
        Update: {
          attendance_status?: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_batch_id?: string | null
          participant_id?: string
          present?: boolean
          recorded_by?: string | null
          remarks?: string | null
          schedule_id?: string
          session_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          metadata: Json
          summary: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          metadata?: Json
          summary?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          metadata?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_import_logs: {
        Row: {
          created_at: string
          created_by: string
          error_count: number
          error_summary: Json
          id: string
          imported_count: number
          row_count: number
          skipped_count: number
          source: string
          source_file_count: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          error_count?: number
          error_summary?: Json
          id?: string
          imported_count?: number
          row_count?: number
          skipped_count?: number
          source?: string
          source_file_count?: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          error_count?: number
          error_summary?: Json
          id?: string
          imported_count?: number
          row_count?: number
          skipped_count?: number
          source?: string
          source_file_count?: number
          status?: string
        }
        Relationships: []
      }
      certificate_skill_results: {
        Row: {
          area: string
          certificate_id: string
          created_at: string
          id: string
          notes: string | null
          score: number | null
          source_skill_result_id: string | null
          status: string
        }
        Insert: {
          area: string
          certificate_id: string
          created_at?: string
          id?: string
          notes?: string | null
          score?: number | null
          source_skill_result_id?: string | null
          status: string
        }
        Update: {
          area?: string
          certificate_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          score?: number | null
          source_skill_result_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificate_skill_results_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_skill_results_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "v_certificate_eligibility"
            referencedColumns: ["existing_certificate_id"]
          },
          {
            foreignKeyName: "certificate_skill_results_source_skill_result_id_fkey"
            columns: ["source_skill_result_id"]
            isOneToOne: false
            referencedRelation: "participant_skill_results"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_templates: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          orientation: string
          paper_size: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          orientation?: string
          paper_size?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          orientation?: string
          paper_size?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_verifications: {
        Row: {
          certificate_id: string | null
          certificate_number: string | null
          id: number
          ip_address: unknown
          method: string | null
          query_value: string | null
          status_returned: string | null
          user_agent: string | null
          verified_at: string
        }
        Insert: {
          certificate_id?: string | null
          certificate_number?: string | null
          id?: never
          ip_address?: unknown
          method?: string | null
          query_value?: string | null
          status_returned?: string | null
          user_agent?: string | null
          verified_at?: string
        }
        Update: {
          certificate_id?: string | null
          certificate_number?: string | null
          id?: never
          ip_address?: unknown
          method?: string | null
          query_value?: string | null
          status_returned?: string | null
          user_agent?: string | null
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificate_verifications_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_verifications_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "v_certificate_eligibility"
            referencedColumns: ["existing_certificate_id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_file_url: string | null
          certificate_no: string
          certificate_number: string | null
          course_code: string | null
          course_id: string
          course_name: string
          created_at: string
          deleted_at: string | null
          expiry_date: string | null
          holder_name: string | null
          id: string
          identity_last4: string | null
          identity_no: string | null
          instructor: string | null
          issue_date: string
          issued_by: string | null
          legacy_batch_id: string | null
          metadata: Json
          participant_id: string
          participant_name: string
          public_verification_enabled: boolean
          remarks: string | null
          schedule_id: string | null
          status: string
          template_id: string | null
          trainer_name: string | null
          training_end_date: string | null
          training_start_date: string | null
          updated_at: string
          venue: string | null
          verification_enabled: boolean
          verification_token: string | null
          verification_url: string | null
        }
        Insert: {
          certificate_file_url?: string | null
          certificate_no: string
          certificate_number?: string | null
          course_code?: string | null
          course_id: string
          course_name: string
          created_at?: string
          deleted_at?: string | null
          expiry_date?: string | null
          holder_name?: string | null
          id?: string
          identity_last4?: string | null
          identity_no?: string | null
          instructor?: string | null
          issue_date: string
          issued_by?: string | null
          legacy_batch_id?: string | null
          metadata?: Json
          participant_id: string
          participant_name: string
          public_verification_enabled?: boolean
          remarks?: string | null
          schedule_id?: string | null
          status?: string
          template_id?: string | null
          trainer_name?: string | null
          training_end_date?: string | null
          training_start_date?: string | null
          updated_at?: string
          venue?: string | null
          verification_enabled?: boolean
          verification_token?: string | null
          verification_url?: string | null
        }
        Update: {
          certificate_file_url?: string | null
          certificate_no?: string
          certificate_number?: string | null
          course_code?: string | null
          course_id?: string
          course_name?: string
          created_at?: string
          deleted_at?: string | null
          expiry_date?: string | null
          holder_name?: string | null
          id?: string
          identity_last4?: string | null
          identity_no?: string | null
          instructor?: string | null
          issue_date?: string
          issued_by?: string | null
          legacy_batch_id?: string | null
          metadata?: Json
          participant_id?: string
          participant_name?: string
          public_verification_enabled?: boolean
          remarks?: string | null
          schedule_id?: string | null
          status?: string
          template_id?: string | null
          trainer_name?: string | null
          training_end_date?: string | null
          training_start_date?: string | null
          updated_at?: string
          venue?: string | null
          verification_enabled?: boolean
          verification_token?: string | null
          verification_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_certificates_template"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "certificate_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_content: {
        Row: {
          body: Json
          content_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          featured: boolean
          id: string
          slug: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: Json
          content_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          featured?: boolean
          id?: string
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: Json
          content_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          featured?: boolean
          id?: string
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_content_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_content_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_media: {
        Row: {
          alt_text: string | null
          bucket: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          public_url: string | null
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string | null
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "cms_media_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          billing_address: string | null
          city: string | null
          company_id: string | null
          company_name: string
          company_type: string | null
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          id: string
          industry: string | null
          person_in_charge: string | null
          phone: string | null
          pic_email: string | null
          pic_phone: string | null
          pic_position: string | null
          postcode: string | null
          registration_no: string | null
          remarks: string | null
          state: string | null
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          billing_address?: string | null
          city?: string | null
          company_id?: string | null
          company_name: string
          company_type?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          person_in_charge?: string | null
          phone?: string | null
          pic_email?: string | null
          pic_phone?: string | null
          pic_position?: string | null
          postcode?: string | null
          registration_no?: string | null
          remarks?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          billing_address?: string | null
          city?: string | null
          company_id?: string | null
          company_name?: string
          company_type?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          person_in_charge?: string | null
          phone?: string | null
          pic_email?: string | null
          pic_phone?: string | null
          pic_position?: string | null
          postcode?: string | null
          registration_no?: string | null
          remarks?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profile: {
        Row: {
          about: string | null
          address: string | null
          city: string | null
          country: string | null
          email_admin: string | null
          email_training: string | null
          google_map_embed: string | null
          id: number
          legal_name: string | null
          mission: string | null
          phone: string | null
          postcode: string | null
          services: Json
          social_media: Json
          state: string | null
          tagline: string | null
          updated_at: string
          updated_by: string | null
          vision: string | null
          whatsapp: string | null
        }
        Insert: {
          about?: string | null
          address?: string | null
          city?: string | null
          country?: string | null
          email_admin?: string | null
          email_training?: string | null
          google_map_embed?: string | null
          id?: number
          legal_name?: string | null
          mission?: string | null
          phone?: string | null
          postcode?: string | null
          services?: Json
          social_media?: Json
          state?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
          vision?: string | null
          whatsapp?: string | null
        }
        Update: {
          about?: string | null
          address?: string | null
          city?: string | null
          country?: string | null
          email_admin?: string | null
          email_training?: string | null
          google_map_embed?: string | null
          id?: number
          legal_name?: string | null
          mission?: string | null
          phone?: string | null
          postcode?: string | null
          services?: Json
          social_media?: Json
          state?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
          vision?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profile_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_schedules: {
        Row: {
          capacity: number | null
          course_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_date: string
          end_time: string | null
          exam_date: string | null
          fee: number | null
          id: string
          is_published: boolean
          legacy_batch_id: string | null
          notes: string | null
          schedule_code: string | null
          seats_taken: number
          source_opportunity_id: string | null
          source_quotation_id: string | null
          start_date: string
          start_time: string | null
          status: Database["public"]["Enums"]["schedule_status"]
          trainer_name: string | null
          training_mode: string | null
          updated_at: string
          updated_by: string | null
          venue: string | null
        }
        Insert: {
          capacity?: number | null
          course_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_date: string
          end_time?: string | null
          exam_date?: string | null
          fee?: number | null
          id?: string
          is_published?: boolean
          legacy_batch_id?: string | null
          notes?: string | null
          schedule_code?: string | null
          seats_taken?: number
          source_opportunity_id?: string | null
          source_quotation_id?: string | null
          start_date: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          trainer_name?: string | null
          training_mode?: string | null
          updated_at?: string
          updated_by?: string | null
          venue?: string | null
        }
        Update: {
          capacity?: number | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_date?: string
          end_time?: string | null
          exam_date?: string | null
          fee?: number | null
          id?: string
          is_published?: boolean
          legacy_batch_id?: string | null
          notes?: string | null
          schedule_code?: string | null
          seats_taken?: number
          source_opportunity_id?: string | null
          source_quotation_id?: string | null
          start_date?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          trainer_name?: string | null
          training_mode?: string | null
          updated_at?: string
          updated_by?: string | null
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_schedules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_schedules_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_schedules_source_opportunity_id_fkey"
            columns: ["source_opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_schedules_source_quotation_id_fkey"
            columns: ["source_quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          active: boolean
          assessment_required: boolean
          attendance_min_percent: number
          category: string | null
          certificate_generation_enabled: boolean
          certificate_template_id: string | null
          certificate_type: string
          cms_status: Database["public"]["Enums"]["content_status"]
          competency_required: boolean
          course_code: string | null
          course_name: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          delivery_modes: string[]
          description: string | null
          duration: string | null
          faq: Json
          featured: boolean
          fee: number | null
          hero_image_url: string | null
          id: string
          modules: Json
          objectives: Json
          overview: string | null
          published_at: string | null
          requirements: Json
          seo_description: string | null
          seo_title: string | null
          slug: string | null
          sort_order: number
          status: string
          summary: string | null
          target_audience: Json
          title: string | null
          updated_at: string
          updated_by: string | null
          validity_months: number | null
        }
        Insert: {
          active?: boolean
          assessment_required?: boolean
          attendance_min_percent?: number
          category?: string | null
          certificate_generation_enabled?: boolean
          certificate_template_id?: string | null
          certificate_type?: string
          cms_status?: Database["public"]["Enums"]["content_status"]
          competency_required?: boolean
          course_code?: string | null
          course_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivery_modes?: string[]
          description?: string | null
          duration?: string | null
          faq?: Json
          featured?: boolean
          fee?: number | null
          hero_image_url?: string | null
          id?: string
          modules?: Json
          objectives?: Json
          overview?: string | null
          published_at?: string | null
          requirements?: Json
          seo_description?: string | null
          seo_title?: string | null
          slug?: string | null
          sort_order?: number
          status?: string
          summary?: string | null
          target_audience?: Json
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          validity_months?: number | null
        }
        Update: {
          active?: boolean
          assessment_required?: boolean
          attendance_min_percent?: number
          category?: string | null
          certificate_generation_enabled?: boolean
          certificate_template_id?: string | null
          certificate_type?: string
          cms_status?: Database["public"]["Enums"]["content_status"]
          competency_required?: boolean
          course_code?: string | null
          course_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivery_modes?: string[]
          description?: string | null
          duration?: string | null
          faq?: Json
          featured?: boolean
          fee?: number | null
          hero_image_url?: string | null
          id?: string
          modules?: Json
          objectives?: Json
          overview?: string | null
          published_at?: string | null
          requirements?: Json
          seo_description?: string | null
          seo_title?: string | null
          slug?: string | null
          sort_order?: number
          status?: string
          summary?: string | null
          target_audience?: Json
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          validity_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "courses_certificate_template_id_fkey"
            columns: ["certificate_template_id"]
            isOneToOne: false
            referencedRelation: "certificate_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      downloads: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          download_count: number
          file_size: number | null
          file_url: string | null
          id: string
          media_id: string | null
          slug: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          download_count?: number
          file_size?: number | null
          file_url?: string | null
          id?: string
          media_id?: string | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          download_count?: number
          file_size?: number | null
          file_url?: string | null
          id?: string
          media_id?: string | null
          slug?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downloads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downloads_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enquiries: {
        Row: {
          company: string | null
          created_at: string
          deleted_at: string | null
          email: string
          enquiry_type: string
          id: string
          message: string
          name: string
          phone: string
          source_page: string
          status: string
          subject: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          enquiry_type: string
          id?: string
          message: string
          name: string
          phone: string
          source_page: string
          status?: string
          subject: string
        }
        Update: {
          company?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          enquiry_type?: string
          id?: string
          message?: string
          name?: string
          phone?: string
          source_page?: string
          status?: string
          subject?: string
        }
        Relationships: []
      }
      faq_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      faqs: {
        Row: {
          answer: string
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          question: string
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answer: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          question: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answer?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          question?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faqs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "faq_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faqs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faqs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_improvement_actions: {
        Row: {
          assigned_to: string | null
          category: string | null
          closed_at: string | null
          corrective_action: string | null
          created_at: string
          created_by: string | null
          department: string | null
          description: string | null
          due_date: string | null
          id: string
          issue_id: string
          priority: string
          resolved_at: string | null
          schedule_id: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          verification_note: string | null
          verified_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          issue_id: string
          priority?: string
          resolved_at?: string | null
          schedule_id?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          verification_note?: string | null
          verified_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          issue_id?: string
          priority?: string
          resolved_at?: string | null
          schedule_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          verification_note?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_improvement_actions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_improvement_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_improvement_actions_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "feedback_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_improvement_actions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_improvement_actions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_issues: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department: string | null
          description: string | null
          id: string
          priority: string
          schedule_id: string | null
          source_feedback_id: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          id?: string
          priority?: string
          schedule_id?: string | null
          source_feedback_id?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          id?: string
          priority?: string
          schedule_id?: string | null
          source_feedback_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_issues_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_issues_source_feedback_id_fkey"
            columns: ["source_feedback_id"]
            isOneToOne: false
            referencedRelation: "participant_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_issues_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_schedule_links: {
        Row: {
          created_at: string
          created_by: string | null
          disabled_at: string | null
          id: string
          is_active: boolean
          public_token: string
          schedule_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          id?: string
          is_active?: boolean
          public_token: string
          schedule_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          id?: string
          is_active?: boolean
          public_token?: string
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_schedule_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_schedule_links_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: true
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_schedule_lookup_attempts: {
        Row: {
          attempt_count: number
          last_attempt_at: string
          request_fingerprint_hash: string
          schedule_link_id: string
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          last_attempt_at?: string
          request_fingerprint_hash: string
          schedule_link_id: string
          window_started_at: string
        }
        Update: {
          attempt_count?: number
          last_attempt_at?: string
          request_fingerprint_hash?: string
          schedule_link_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_schedule_lookup_attempts_schedule_link_id_fkey"
            columns: ["schedule_link_id"]
            isOneToOne: false
            referencedRelation: "feedback_schedule_links"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      gallery_images: {
        Row: {
          alt_text: string
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          featured: boolean
          id: string
          image_url: string
          media_id: string | null
          sort_order: number
          status: Database["public"]["Enums"]["content_status"]
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alt_text?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          featured?: boolean
          id?: string
          image_url: string
          media_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alt_text?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          featured?: boolean
          id?: string
          image_url?: string
          media_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["content_status"]
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gallery_images_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "gallery_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_images_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_images_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_images_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          description: string
          discount: number
          id: string
          invoice_id: string
          line_total: number | null
          quantity: number
          sort_order: number
          source_quotation_item_id: string | null
          unit: string
          unit_price: number
        }
        Insert: {
          description: string
          discount?: number
          id?: string
          invoice_id: string
          line_total?: number | null
          quantity: number
          sort_order?: number
          source_quotation_item_id?: string | null
          unit?: string
          unit_price?: number
        }
        Update: {
          description?: string
          discount?: number
          id?: string
          invoice_id?: string
          line_total?: number | null
          quantity?: number
          sort_order?: number
          source_quotation_item_id?: string | null
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_source_quotation_item_id_fkey"
            columns: ["source_quotation_item_id"]
            isOneToOne: false
            referencedRelation: "sales_quotation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          callback_received_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          metadata: Json
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          payment_provider: string
          payment_reference: string | null
          payment_url: string | null
          provider_bill_code: string | null
          provider_reference: string | null
          provider_transaction_id: string | null
          status: string
          updated_at: string
          verified_amount: number | null
          verified_at: string | null
        }
        Insert: {
          amount: number
          callback_received_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          metadata?: Json
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_provider: string
          payment_reference?: string | null
          payment_url?: string | null
          provider_bill_code?: string | null
          provider_reference?: string | null
          provider_transaction_id?: string | null
          status?: string
          updated_at?: string
          verified_amount?: number | null
          verified_at?: string | null
        }
        Update: {
          amount?: number
          callback_received_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          metadata?: Json
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_provider?: string
          payment_reference?: string | null
          payment_url?: string | null
          provider_bill_code?: string | null
          provider_reference?: string | null
          provider_transaction_id?: string | null
          status?: string
          updated_at?: string
          verified_amount?: number | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          balance_due: number
          billing_address: string | null
          billing_company: string | null
          billing_email: string | null
          billing_name: string
          billing_phone: string | null
          billing_registration_no: string | null
          cancelled_at: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount_amount: number
          due_date: string
          grand_total: number
          id: string
          invoice_date: string
          invoice_no: string
          issued_at: string | null
          notes: string | null
          opportunity_id: string
          paid_at: string | null
          payment_terms: string | null
          quotation_id: string
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          taxable_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_paid?: number
          balance_due?: number
          billing_address?: string | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name: string
          billing_phone?: string | null
          billing_registration_no?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date?: string
          grand_total?: number
          id?: string
          invoice_date?: string
          invoice_no?: string
          issued_at?: string | null
          notes?: string | null
          opportunity_id: string
          paid_at?: string | null
          payment_terms?: string | null
          quotation_id: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          taxable_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_paid?: number
          balance_due?: number
          billing_address?: string | null
          billing_company?: string | null
          billing_email?: string | null
          billing_name?: string
          billing_phone?: string | null
          billing_registration_no?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date?: string
          grand_total?: number
          id?: string
          invoice_date?: string
          invoice_no?: string
          issued_at?: string | null
          notes?: string | null
          opportunity_id?: string
          paid_at?: string | null
          payment_terms?: string | null
          quotation_id?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          taxable_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: true
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_course_map: {
        Row: {
          course_id: string | null
          created_at: string
          created_by: string | null
          id: string
          normalized_course_name: string
          raw_course_name: string
          source_label: string
          status: string
          updated_at: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          normalized_course_name: string
          raw_course_name: string
          source_label: string
          status?: string
          updated_at?: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          normalized_course_name?: string
          raw_course_name?: string
          source_label?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legacy_course_map_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_course_map_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_import_batches: {
        Row: {
          approved_count: number
          created_at: string
          created_by: string | null
          dry_run_at: string | null
          dry_run_hash: string | null
          error_summary: Json
          id: string
          invalid_count: number
          merged_count: number
          notes: string | null
          original_filename: string
          source_file_hash: string | null
          source_label: string
          status: string
          total_row_count: number
          updated_at: string
          valid_count: number
        }
        Insert: {
          approved_count?: number
          created_at?: string
          created_by?: string | null
          dry_run_at?: string | null
          dry_run_hash?: string | null
          error_summary?: Json
          id?: string
          invalid_count?: number
          merged_count?: number
          notes?: string | null
          original_filename: string
          source_file_hash?: string | null
          source_label: string
          status?: string
          total_row_count?: number
          updated_at?: string
          valid_count?: number
        }
        Update: {
          approved_count?: number
          created_at?: string
          created_by?: string | null
          dry_run_at?: string | null
          dry_run_hash?: string | null
          error_summary?: Json
          id?: string
          invalid_count?: number
          merged_count?: number
          notes?: string | null
          original_filename?: string
          source_file_hash?: string | null
          source_label?: string
          status?: string
          total_row_count?: number
          updated_at?: string
          valid_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_participant_staging: {
        Row: {
          batch_id: string
          created_at: string
          duplicate_conflict_reason: string | null
          id: string
          mapped_course_id: string | null
          match_status: string | null
          matched_participant_id: string | null
          merge_error: string | null
          merged_at: string | null
          normalized_course_name: string | null
          normalized_email: string | null
          normalized_ic_passport: string | null
          normalized_phone: string | null
          raw_certificate_number: string | null
          raw_company: string | null
          raw_course_name: string | null
          raw_data: Json
          raw_email: string | null
          raw_ic_passport: string | null
          raw_name: string | null
          raw_phone: string | null
          raw_status: string | null
          result_certificate_id: string | null
          result_enrollment_id: string | null
          result_participant_id: string | null
          result_schedule_id: string | null
          review_status: string
          source_row_number: number
          training_end_date: string | null
          training_start_date: string | null
          updated_at: string
          validation_error: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          duplicate_conflict_reason?: string | null
          id?: string
          mapped_course_id?: string | null
          match_status?: string | null
          matched_participant_id?: string | null
          merge_error?: string | null
          merged_at?: string | null
          normalized_course_name?: string | null
          normalized_email?: string | null
          normalized_ic_passport?: string | null
          normalized_phone?: string | null
          raw_certificate_number?: string | null
          raw_company?: string | null
          raw_course_name?: string | null
          raw_data?: Json
          raw_email?: string | null
          raw_ic_passport?: string | null
          raw_name?: string | null
          raw_phone?: string | null
          raw_status?: string | null
          result_certificate_id?: string | null
          result_enrollment_id?: string | null
          result_participant_id?: string | null
          result_schedule_id?: string | null
          review_status?: string
          source_row_number: number
          training_end_date?: string | null
          training_start_date?: string | null
          updated_at?: string
          validation_error?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          duplicate_conflict_reason?: string | null
          id?: string
          mapped_course_id?: string | null
          match_status?: string | null
          matched_participant_id?: string | null
          merge_error?: string | null
          merged_at?: string | null
          normalized_course_name?: string | null
          normalized_email?: string | null
          normalized_ic_passport?: string | null
          normalized_phone?: string | null
          raw_certificate_number?: string | null
          raw_company?: string | null
          raw_course_name?: string | null
          raw_data?: Json
          raw_email?: string | null
          raw_ic_passport?: string | null
          raw_name?: string | null
          raw_phone?: string | null
          raw_status?: string | null
          result_certificate_id?: string | null
          result_enrollment_id?: string | null
          result_participant_id?: string | null
          result_schedule_id?: string | null
          review_status?: string
          source_row_number?: number
          training_end_date?: string | null
          training_start_date?: string | null
          updated_at?: string
          validation_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legacy_participant_staging_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_mapped_course_id_fkey"
            columns: ["mapped_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_matched_participant_id_fkey"
            columns: ["matched_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_result_certificate_id_fkey"
            columns: ["result_certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_result_certificate_id_fkey"
            columns: ["result_certificate_id"]
            isOneToOne: false
            referencedRelation: "v_certificate_eligibility"
            referencedColumns: ["existing_certificate_id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_result_enrollment_id_fkey"
            columns: ["result_enrollment_id"]
            isOneToOne: false
            referencedRelation: "schedule_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_result_participant_id_fkey"
            columns: ["result_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_participant_staging_result_schedule_id_fkey"
            columns: ["result_schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_attribution_touchpoints: {
        Row: {
          campaign_id: string | null
          created_at: string
          created_by: string | null
          form_origin: string | null
          id: string
          landing_path: string | null
          lead_metadata_id: string | null
          marketing_contact_id: string | null
          occurred_at: string
          referrer_url: string | null
          source: string
          touchpoint_type: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          form_origin?: string | null
          id?: string
          landing_path?: string | null
          lead_metadata_id?: string | null
          marketing_contact_id?: string | null
          occurred_at?: string
          referrer_url?: string | null
          source: string
          touchpoint_type: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          form_origin?: string | null
          id?: string
          landing_path?: string | null
          lead_metadata_id?: string | null
          marketing_contact_id?: string | null
          occurred_at?: string
          referrer_url?: string | null
          source?: string
          touchpoint_type?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_attribution_touchpoints_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_attribution_touchpoints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_attribution_touchpoints_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_attribution_touchpoints_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
          {
            foreignKeyName: "marketing_attribution_touchpoints_marketing_contact_id_fkey"
            columns: ["marketing_contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          actual_spend: number | null
          budget: number | null
          campaign_number: string
          channel: string
          course_id: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          name: string
          notes: string | null
          objective: string | null
          owner_id: string | null
          start_date: string | null
          status: string
          updated_at: string
          updated_by: string | null
          utm_campaign: string | null
        }
        Insert: {
          actual_spend?: number | null
          budget?: number | null
          campaign_number?: string
          channel: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          utm_campaign?: string | null
        }
        Update: {
          actual_spend?: number | null
          budget?: number | null
          campaign_number?: string
          channel?: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          utm_campaign?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_contact_events: {
        Row: {
          actor_id: string | null
          campaign_id: string | null
          contact_id: string
          created_at: string
          event_type: string
          id: string
          lead_metadata_id: string | null
          note: string | null
        }
        Insert: {
          actor_id?: string | null
          campaign_id?: string | null
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          lead_metadata_id?: string | null
          note?: string | null
        }
        Update: {
          actor_id?: string | null
          campaign_id?: string | null
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          lead_metadata_id?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contact_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contact_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contact_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contact_events_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contact_events_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
        ]
      }
      marketing_contacts: {
        Row: {
          company: string | null
          consent_source: string | null
          consent_status: string
          consented_at: string | null
          contact_number: string
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string | null
          id: string
          next_follow_up_at: string | null
          owner_id: string | null
          phone: string | null
          promoted_at: string | null
          promoted_lead_metadata_id: string | null
          source: string
          source_campaign_id: string | null
          status: string
          unsubscribed_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company?: string | null
          consent_source?: string | null
          consent_status?: string
          consented_at?: string | null
          contact_number?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          next_follow_up_at?: string | null
          owner_id?: string | null
          phone?: string | null
          promoted_at?: string | null
          promoted_lead_metadata_id?: string | null
          source: string
          source_campaign_id?: string | null
          status?: string
          unsubscribed_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company?: string | null
          consent_source?: string | null
          consent_status?: string
          consented_at?: string | null
          contact_number?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          next_follow_up_at?: string | null
          owner_id?: string | null
          phone?: string | null
          promoted_at?: string | null
          promoted_lead_metadata_id?: string | null
          source?: string
          source_campaign_id?: string | null
          status?: string
          unsubscribed_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contacts_promoted_lead_metadata_id_fkey"
            columns: ["promoted_lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contacts_promoted_lead_metadata_id_fkey"
            columns: ["promoted_lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
          {
            foreignKeyName: "marketing_contacts_source_campaign_id_fkey"
            columns: ["source_campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          alt_text: string | null
          bucket: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          file_name: string
          file_size: number | null
          folder_id: string | null
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string | null
          public_url: string | null
          status: Database["public"]["Enums"]["content_status"]
          storage_path: string
          title: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name: string
          file_size?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          mime_type?: string | null
          public_url?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          storage_path: string
          title?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name?: string
          file_size?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          mime_type?: string | null
          public_url?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          storage_path?: string
          title?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          path?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      news_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      news_posts: {
        Row: {
          author_id: string | null
          body: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          excerpt: string | null
          featured: boolean
          featured_image_url: string | null
          id: string
          published_at: string | null
          scheduled_for: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          excerpt?: string | null
          featured?: boolean
          featured_image_url?: string | null
          id?: string
          published_at?: string | null
          scheduled_for?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          excerpt?: string | null
          featured?: boolean
          featured_image_url?: string | null
          id?: string
          published_at?: string | null
          scheduled_for?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "news_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_posts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "news_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_posts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_feedback: {
        Row: {
          created_at: string
          had_problem: boolean
          id: string
          improve: string | null
          liked_most: string | null
          nps: number | null
          participant_id: string
          problem_category: string | null
          problem_description: string | null
          q1_score: number | null
          q10_score: number | null
          q2_score: number | null
          q3_score: number | null
          q4_score: number | null
          q5_score: number | null
          q6_score: number | null
          q7_score: number | null
          q8_score: number | null
          q9_score: number | null
          schedule_id: string
          status: string
          submitted_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          had_problem?: boolean
          id?: string
          improve?: string | null
          liked_most?: string | null
          nps?: number | null
          participant_id: string
          problem_category?: string | null
          problem_description?: string | null
          q1_score?: number | null
          q10_score?: number | null
          q2_score?: number | null
          q3_score?: number | null
          q4_score?: number | null
          q5_score?: number | null
          q6_score?: number | null
          q7_score?: number | null
          q8_score?: number | null
          q9_score?: number | null
          schedule_id: string
          status?: string
          submitted_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          had_problem?: boolean
          id?: string
          improve?: string | null
          liked_most?: string | null
          nps?: number | null
          participant_id?: string
          problem_category?: string | null
          problem_description?: string | null
          q1_score?: number | null
          q10_score?: number | null
          q2_score?: number | null
          q3_score?: number | null
          q4_score?: number | null
          q5_score?: number | null
          q6_score?: number | null
          q7_score?: number | null
          q8_score?: number | null
          q9_score?: number | null
          schedule_id?: string
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_feedback_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_feedback_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_skill_results: {
        Row: {
          area: string
          assessed_at: string | null
          assessed_by: string | null
          created_at: string
          deleted_at: string | null
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          participant_id: string
          schedule_id: string
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          area: string
          assessed_at?: string | null
          assessed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          participant_id: string
          schedule_id: string
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          area?: string
          assessed_at?: string | null
          assessed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          participant_id?: string
          schedule_id?: string
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_skill_results_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_skill_results_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_skill_results_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participant_skill_results_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          address: string | null
          company: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          gender: string | null
          ic_passport_no: string | null
          id: string
          identity_last4: string | null
          identity_no: string | null
          legacy_batch_id: string | null
          nationality: string | null
          notes: string | null
          organization: string | null
          participant_code: string
          participant_id: string | null
          phone: string | null
          position: string | null
          registration_date: string | null
          schedule_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          gender?: string | null
          ic_passport_no?: string | null
          id?: string
          identity_last4?: string | null
          identity_no?: string | null
          legacy_batch_id?: string | null
          nationality?: string | null
          notes?: string | null
          organization?: string | null
          participant_code?: string
          participant_id?: string | null
          phone?: string | null
          position?: string | null
          registration_date?: string | null
          schedule_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          gender?: string | null
          ic_passport_no?: string | null
          id?: string
          identity_last4?: string | null
          identity_no?: string | null
          legacy_batch_id?: string | null
          nationality?: string | null
          notes?: string | null
          organization?: string | null
          participant_code?: string
          participant_id?: string | null
          phone?: string | null
          position?: string | null
          registration_date?: string | null
          schedule_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_activity_log: {
        Row: {
          action: string
          actor_name: string | null
          actor_telegram_id: number | null
          created_at: string
          id: string
          metadata: Json
          photo_id: string | null
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_telegram_id?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          photo_id?: string | null
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_telegram_id?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          photo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_activity_log_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_ai_analysis: {
        Row: {
          analysis_version: string
          composition_score: number
          created_at: string
          id: string
          input_size_bytes: number | null
          latency_ms: number | null
          model: string
          overall_score: number
          photo_id: string
          ppe_score: number | null
          professionalism_score: number
          provider: string
          provider_metadata: Json | null
          provider_request_id: string | null
          quality_flags: Json
          recommended_best_photo: boolean
          recommended_usages: Json
          sharpness_score: number
          short_reason: string
          story_impact_score: number
          subject_clarity_score: number
          training_relevance_score: number
          updated_at: string
          visual_engagement_score: number
        }
        Insert: {
          analysis_version: string
          composition_score: number
          created_at?: string
          id?: string
          input_size_bytes?: number | null
          latency_ms?: number | null
          model: string
          overall_score: number
          photo_id: string
          ppe_score?: number | null
          professionalism_score: number
          provider: string
          provider_metadata?: Json | null
          provider_request_id?: string | null
          quality_flags?: Json
          recommended_best_photo?: boolean
          recommended_usages?: Json
          sharpness_score: number
          short_reason?: string
          story_impact_score: number
          subject_clarity_score: number
          training_relevance_score: number
          updated_at?: string
          visual_engagement_score: number
        }
        Update: {
          analysis_version?: string
          composition_score?: number
          created_at?: string
          id?: string
          input_size_bytes?: number | null
          latency_ms?: number | null
          model?: string
          overall_score?: number
          photo_id?: string
          ppe_score?: number | null
          professionalism_score?: number
          provider?: string
          provider_metadata?: Json | null
          provider_request_id?: string | null
          quality_flags?: Json
          recommended_best_photo?: boolean
          recommended_usages?: Json
          sharpness_score?: number
          short_reason?: string
          story_impact_score?: number
          subject_clarity_score?: number
          training_relevance_score?: number
          updated_at?: string
          visual_engagement_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "photo_ai_analysis_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_categories: {
        Row: {
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      photo_events: {
        Row: {
          created_at: string
          event_date: string | null
          id: string
          location: string | null
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          id?: string
          location?: string | null
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_date?: string | null
          id?: string
          location?: string | null
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      photo_id_sequences: {
        Row: {
          last_value: number
          seq_date: string
        }
        Insert: {
          last_value?: number
          seq_date: string
        }
        Update: {
          last_value?: number
          seq_date?: string
        }
        Relationships: []
      }
      photo_usage_types: {
        Row: {
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      photo_usages: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          usage_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          usage_type: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          usage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_usages_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_usages_usage_type_fkey"
            columns: ["usage_type"]
            isOneToOne: false
            referencedRelation: "photo_usage_types"
            referencedColumns: ["key"]
          },
        ]
      }
      photos: {
        Row: {
          category: string | null
          created_at: string
          event_id: string | null
          id: string
          is_best_photo: boolean
          media_id: string
          notes: string | null
          photo_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          telegram_file_id: string | null
          telegram_file_unique_id: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_by_telegram_id: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_best_photo?: boolean
          media_id: string
          notes?: string | null
          photo_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          telegram_file_id?: string | null
          telegram_file_unique_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_telegram_id?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_best_photo?: boolean
          media_id?: string
          notes?: string | null
          photo_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          telegram_file_id?: string | null
          telegram_file_unique_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_telegram_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_category_fk"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "photo_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "photos_event_id_fk"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "photo_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_media_id_fk"
            columns: ["media_id"]
            isOneToOne: true
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_control_enabled: boolean
          avatar_url: string | null
          created_at: string
          department: Database["public"]["Enums"]["staff_department"] | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          last_login_at: string | null
          must_change_password: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_control_enabled?: boolean
          avatar_url?: string | null
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"] | null
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_control_enabled?: boolean
          avatar_url?: string | null
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"] | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_requests: {
        Row: {
          assigned_to: string | null
          budget: string | null
          category: string
          company_name: string
          contact_person: string
          created_at: string
          deleted_at: string | null
          email: string
          email_sent: boolean
          id: string
          industry: string
          job_title: string | null
          location: string | null
          notes: string | null
          objectives: string
          participants: number | null
          phone: string
          preferred_month: string | null
          programme: string | null
          sheets_synced: boolean
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          budget?: string | null
          category: string
          company_name: string
          contact_person: string
          created_at?: string
          deleted_at?: string | null
          email: string
          email_sent?: boolean
          id?: string
          industry: string
          job_title?: string | null
          location?: string | null
          notes?: string | null
          objectives: string
          participants?: number | null
          phone: string
          preferred_month?: string | null
          programme?: string | null
          sheets_synced?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          budget?: string | null
          category?: string
          company_name?: string
          contact_person?: string
          created_at?: string
          deleted_at?: string | null
          email?: string
          email_sent?: boolean
          id?: string
          industry?: string
          job_title?: string | null
          location?: string | null
          notes?: string | null
          objectives?: string
          participants?: number | null
          phone?: string
          preferred_month?: string | null
          programme?: string | null
          sheets_synced?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_rate_limits: {
        Row: {
          rate_key: string
          request_count: number
          window_started_at: string
        }
        Insert: {
          rate_key: string
          request_count?: number
          window_started_at?: string
        }
        Update: {
          rate_key?: string
          request_count?: number
          window_started_at?: string
        }
        Relationships: []
      }
      public_registration_attendees: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string
          ic_passport_no: string | null
          id: string
          identity_normalized: string | null
          participant_id: string | null
          phone: string | null
          registration_id: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          ic_passport_no?: string | null
          id?: string
          identity_normalized?: string | null
          participant_id?: string | null
          phone?: string | null
          registration_id: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          ic_passport_no?: string | null
          id?: string
          identity_normalized?: string | null
          participant_id?: string | null
          phone?: string | null
          registration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_registration_attendees_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_registration_attendees_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "public_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_registration_payments: {
        Row: {
          amount: number
          bill_creation_claimed_at: string | null
          bill_creation_state: string
          callback_received_at: string | null
          created_at: string
          currency: string
          id: string
          payment_provider: string
          payment_url: string | null
          provider_bill_code: string | null
          provider_reference: string | null
          provider_transaction_id: string | null
          raw_response: Json
          registration_id: string
          status: string
          updated_at: string
          verified_amount: number | null
          verified_at: string | null
        }
        Insert: {
          amount: number
          bill_creation_claimed_at?: string | null
          bill_creation_state?: string
          callback_received_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          payment_provider: string
          payment_url?: string | null
          provider_bill_code?: string | null
          provider_reference?: string | null
          provider_transaction_id?: string | null
          raw_response?: Json
          registration_id: string
          status?: string
          updated_at?: string
          verified_amount?: number | null
          verified_at?: string | null
        }
        Update: {
          amount?: number
          bill_creation_claimed_at?: string | null
          bill_creation_state?: string
          callback_received_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          payment_provider?: string
          payment_url?: string | null
          provider_bill_code?: string | null
          provider_reference?: string | null
          provider_transaction_id?: string | null
          raw_response?: Json
          registration_id?: string
          status?: string
          updated_at?: string
          verified_amount?: number | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_registration_payments_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "public_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_registrations: {
        Row: {
          amount_snapshot: number
          attendee_count: number
          cancelled_at: string | null
          confirmation_token_hash: string
          confirmed_at: string | null
          course_id: string
          created_at: string
          currency: string
          expired_at: string | null
          hold_expires_at: string | null
          id: string
          idempotency_key_hash: string
          payment_status: string
          registration_reference: string
          registration_status: string
          schedule_id: string
          updated_at: string
        }
        Insert: {
          amount_snapshot: number
          attendee_count: number
          cancelled_at?: string | null
          confirmation_token_hash: string
          confirmed_at?: string | null
          course_id: string
          created_at?: string
          currency?: string
          expired_at?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key_hash: string
          payment_status?: string
          registration_reference?: string
          registration_status?: string
          schedule_id: string
          updated_at?: string
        }
        Update: {
          amount_snapshot?: number
          attendee_count?: number
          cancelled_at?: string | null
          confirmation_token_hash?: string
          confirmed_at?: string | null
          course_id?: string
          created_at?: string
          currency?: string
          expired_at?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key_hash?: string
          payment_status?: string
          registration_reference?: string
          registration_status?: string
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_registrations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_registrations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          lead_metadata_id: string
          note: string | null
          opportunity_id: string | null
          quotation_id: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          lead_metadata_id: string
          note?: string | null
          opportunity_id?: string | null
          quotation_id?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          lead_metadata_id?: string
          note?: string | null
          opportunity_id?: string | null
          quotation_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activity_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activity_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
          {
            foreignKeyName: "sales_activity_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_activity_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_lead_attributions: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          lead_metadata_id: string
          notes: string | null
          source: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          lead_metadata_id: string
          notes?: string | null
          source: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          lead_metadata_id?: string
          notes?: string | null
          source?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_lead_attributions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_lead_attributions_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: true
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_lead_attributions_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: true
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
        ]
      }
      sales_lead_metadata: {
        Row: {
          assigned_to: string | null
          created_at: string
          follow_up_at: string | null
          id: string
          is_test: boolean
          lead_source: string
          lost_reason: string | null
          priority: string
          source_id: string
          status: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          follow_up_at?: string | null
          id?: string
          is_test?: boolean
          lead_source: string
          lost_reason?: string | null
          priority?: string
          source_id: string
          status?: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          follow_up_at?: string | null
          id?: string
          is_test?: boolean
          lead_source?: string
          lost_reason?: string | null
          priority?: string
          source_id?: string
          status?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_lead_metadata_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_opportunities: {
        Row: {
          assigned_to: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          company_id: string | null
          company_name: string | null
          contact_email: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string
          is_test: boolean
          lead_metadata_id: string
          lost_at: string | null
          lost_reason: string | null
          opportunity_no: string
          probability: number | null
          programme: string | null
          stage: string
          title: string
          updated_at: string
          won_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          company_name?: string | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          is_test?: boolean
          lead_metadata_id: string
          lost_at?: string | null
          lost_reason?: string | null
          opportunity_no?: string
          probability?: number | null
          programme?: string | null
          stage?: string
          title: string
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          company_id?: string | null
          company_name?: string | null
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          is_test?: boolean
          lead_metadata_id?: string
          lost_at?: string | null
          lost_reason?: string | null
          opportunity_no?: string
          probability?: number | null
          programme?: string | null
          stage?: string
          title?: string
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_opportunities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_opportunities_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: true
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_opportunities_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: true
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
        ]
      }
      sales_quotation_items: {
        Row: {
          description: string
          discount: number
          id: string
          line_total: number | null
          quantity: number
          quotation_id: string
          sort_order: number
          unit: string
          unit_price: number
        }
        Insert: {
          description: string
          discount?: number
          id?: string
          line_total?: number | null
          quantity?: number
          quotation_id: string
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Update: {
          description?: string
          discount?: number
          id?: string
          line_total?: number | null
          quantity?: number
          quotation_id?: string
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotations: {
        Row: {
          accepted_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount: number
          id: string
          is_test: boolean
          issue_date: string
          notes: string | null
          opportunity_id: string
          parent_quotation_id: string | null
          quotation_no: string
          rejected_at: string | null
          rejection_reason: string | null
          revision_no: number
          sent_at: string | null
          sst_applicable: boolean
          sst_rate: number
          status: string
          subtotal: number
          superseded_at: string | null
          tax: number
          terms: string | null
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          id?: string
          is_test?: boolean
          issue_date?: string
          notes?: string | null
          opportunity_id: string
          parent_quotation_id?: string | null
          quotation_no?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          revision_no?: number
          sent_at?: string | null
          sst_applicable?: boolean
          sst_rate?: number
          status?: string
          subtotal?: number
          superseded_at?: string | null
          tax?: number
          terms?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          id?: string
          is_test?: boolean
          issue_date?: string
          notes?: string | null
          opportunity_id?: string
          parent_quotation_id?: string | null
          quotation_no?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          revision_no?: number
          sent_at?: string | null
          sst_applicable?: boolean
          sst_rate?: number
          status?: string
          subtotal?: number
          superseded_at?: string | null
          tax?: number
          terms?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotations_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotations_parent_quotation_id_fkey"
            columns: ["parent_quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_at: string | null
          id: string
          lead_metadata_id: string | null
          opportunity_id: string | null
          priority: string
          quotation_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_metadata_id?: string | null
          opportunity_id?: string | null
          priority?: string
          quotation_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_metadata_id?: string | null
          opportunity_id?: string | null
          priority?: string
          quotation_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tasks_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "sales_lead_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tasks_lead_metadata_id_fkey"
            columns: ["lead_metadata_id"]
            isOneToOne: false
            referencedRelation: "v_sales_lead_inbox"
            referencedColumns: ["lead_metadata_id"]
          },
          {
            foreignKeyName: "sales_tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tasks_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_assessors: {
        Row: {
          assessor_id: string
          assigned_at: string
          assigned_by: string | null
          created_at: string
          id: string
          is_primary: boolean
          schedule_id: string
        }
        Insert: {
          assessor_id: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          schedule_id: string
        }
        Update: {
          assessor_id?: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_assessors_assessor_id_fkey"
            columns: ["assessor_id"]
            isOneToOne: false
            referencedRelation: "assessors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assessors_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assessors_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_groups: {
        Row: {
          assessor_id: string | null
          capacity: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_time: string | null
          id: string
          name: string
          schedule_id: string
          start_time: string | null
          trainer_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assessor_id?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string | null
          id?: string
          name: string
          schedule_id: string
          start_time?: string | null
          trainer_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assessor_id?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string | null
          id?: string
          name?: string
          schedule_id?: string
          start_time?: string | null
          trainer_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_groups_assessor_id_fkey"
            columns: ["assessor_id"]
            isOneToOne: false
            referencedRelation: "assessors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_groups_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_groups_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_groups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_participants: {
        Row: {
          created_at: string
          deleted_at: string | null
          enrolled_at: string
          id: string
          legacy_batch_id: string | null
          notes: string | null
          participant_id: string
          registration_status: string
          schedule_group_id: string | null
          schedule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          enrolled_at?: string
          id?: string
          legacy_batch_id?: string | null
          notes?: string | null
          participant_id: string
          registration_status?: string
          schedule_group_id?: string | null
          schedule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          enrolled_at?: string
          id?: string
          legacy_batch_id?: string | null
          notes?: string | null
          participant_id?: string
          registration_status?: string
          schedule_group_id?: string | null
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_participants_group_same_schedule_fkey"
            columns: ["schedule_group_id", "schedule_id"]
            isOneToOne: false
            referencedRelation: "schedule_groups"
            referencedColumns: ["id", "schedule_id"]
          },
          {
            foreignKeyName: "schedule_participants_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: false
            referencedRelation: "legacy_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_participants_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_participants_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_module_access: {
        Row: {
          access_level: string
          created_at: string
          created_by: string | null
          module_key: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          created_by?: string | null
          module_key: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          created_by?: string | null
          module_key?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_module_access_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_module_access_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "staff_module_catalog"
            referencedColumns: ["module_key"]
          },
          {
            foreignKeyName: "staff_module_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_module_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_module_catalog: {
        Row: {
          created_at: string
          group_key: string
          is_active: boolean
          label: string
          min_role: Database["public"]["Enums"]["user_role"]
          module_key: string
        }
        Insert: {
          created_at?: string
          group_key: string
          is_active?: boolean
          label: string
          min_role: Database["public"]["Enums"]["user_role"]
          module_key: string
        }
        Update: {
          created_at?: string
          group_key?: string
          is_active?: boolean
          label?: string
          min_role?: Database["public"]["Enums"]["user_role"]
          module_key?: string
        }
        Relationships: []
      }
      trainers: {
        Row: {
          competencies: string[]
          created_at: string
          deleted_at: string | null
          department: string | null
          email: string | null
          employment_type: string | null
          full_name: string
          ic_passport_no: string | null
          id: string
          joining_date: string | null
          phone: string | null
          position: string | null
          qualifications: string[]
          signature_image: string | null
          specialisation: string | null
          staff_no: string | null
          status: string
          trainer_id: string | null
          trainer_photo: string | null
          updated_at: string
        }
        Insert: {
          competencies?: string[]
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          email?: string | null
          employment_type?: string | null
          full_name: string
          ic_passport_no?: string | null
          id?: string
          joining_date?: string | null
          phone?: string | null
          position?: string | null
          qualifications?: string[]
          signature_image?: string | null
          specialisation?: string | null
          staff_no?: string | null
          status?: string
          trainer_id?: string | null
          trainer_photo?: string | null
          updated_at?: string
        }
        Update: {
          competencies?: string[]
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          email?: string | null
          employment_type?: string | null
          full_name?: string
          ic_passport_no?: string | null
          id?: string
          joining_date?: string | null
          phone?: string | null
          position?: string | null
          qualifications?: string[]
          signature_image?: string | null
          specialisation?: string | null
          staff_no?: string | null
          status?: string
          trainer_id?: string | null
          trainer_photo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_certificate_eligibility: {
        Row: {
          absent_days: number | null
          assessment_required: boolean | null
          assessment_row_exists: boolean | null
          assessment_satisfied: boolean | null
          attendance_days: number | null
          attendance_min_percent: number | null
          attendance_percentage: number | null
          attendance_satisfied: boolean | null
          attended_days: number | null
          calendar_expected_days: number | null
          certificate_generation_enabled: boolean | null
          certificate_template_id: string | null
          certificate_type: string | null
          competency_required: boolean | null
          competency_status: string | null
          course_code: string | null
          course_id: string | null
          course_name: string | null
          effective_expected_days: number | null
          eligible: boolean | null
          enrollment_status: string | null
          excused_days: number | null
          existing_certificate_id: string | null
          existing_certificate_number: string | null
          holder_name: string | null
          ineligibility_reason: string | null
          late_days: number | null
          participant_id: string | null
          practical_score: number | null
          present_days: number | null
          result: string | null
          schedule_code: string | null
          schedule_end_date: string | null
          schedule_id: string | null
          schedule_start_date: string | null
          schedule_status: string | null
          theory_score: number | null
          trainer_name: string | null
          venue: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_schedules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_certificate_template_id_fkey"
            columns: ["certificate_template_id"]
            isOneToOne: false
            referencedRelation: "certificate_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_participants_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_participants_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "course_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sales_lead_inbox: {
        Row: {
          assigned_to: string | null
          company: string | null
          contact_name: string | null
          created_at: string | null
          email: string | null
          follow_up_at: string | null
          is_test: boolean | null
          lead_metadata_id: string | null
          lead_source: string | null
          lost_reason: string | null
          phone: string | null
          priority: string | null
          source_id: string | null
          status: string | null
          subject: string | null
          updated_at: string | null
          won_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_lead_metadata_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_quotation: { Args: { p_quotation_id: string }; Returns: undefined }
      attach_public_registration_toyy_pay_bill: {
        Args: {
          p_attempt_id: string
          p_bill_code: string
          p_payment_url: string
        }
        Returns: Json
      }
      begin_public_registration_payment: {
        Args: {
          p_provider?: string
          p_registration_reference: string
          p_registration_secret: string
        }
        Returns: Json
      }
      cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: Json
      }
      check_public_rate_limit: {
        Args: {
          p_key: string
          p_max_attempts?: number
          p_window_seconds?: number
        }
        Returns: boolean
      }
      clear_password_change_flag: {
        Args: { p_forced?: boolean }
        Returns: undefined
      }
      convert_lead_to_opportunity: {
        Args: {
          p_estimated_value: number
          p_expected_close_date: string
          p_lead_metadata_id: string
          p_title: string
        }
        Returns: string
      }
      create_invoice_from_quotation: {
        Args: { p_quotation_id: string }
        Returns: string
      }
      create_public_registration: {
        Args: {
          p_attendees: Json
          p_idempotency_key: string
          p_registration_secret: string
          p_schedule_id: string
        }
        Returns: Json
      }
      expire_public_registrations: { Args: never; Returns: number }
      fail_public_registration_payment_setup: {
        Args: { p_attempt_id: string; p_reason: string }
        Returns: Json
      }
      feedback_anonymous_stats: {
        Args: { p_schedule_id?: string }
        Returns: {
          avg_overall: number
          nps: number
          nps_detractors: number
          nps_passives: number
          nps_promoters: number
          response_rate: number
          responses: number
          total_eligible: number
        }[]
      }
      feedback_generate_links: {
        Args: { p_schedule_id: string }
        Returns: {
          created_count: number
        }[]
      }
      feedback_get_by_token: {
        Args: { p_token: string }
        Returns: {
          already_submitted: boolean
          course_title: string
          schedule_code: string
          schedule_end: string
          schedule_start: string
          trainer_name: string
          valid: boolean
          venue: string
        }[]
      }
      feedback_reopen: { Args: { p_feedback_id: string }; Returns: boolean }
      feedback_submit: {
        Args: { p_data: Json; p_token: string }
        Returns: {
          code: string
          message: string
          ok: boolean
        }[]
      }
      finalize_public_registration_crm: {
        Args: { p_registration_id: string }
        Returns: Json
      }
      finalize_public_registration_payment_from_callback: {
        Args: {
          p_attempt_id: string
          p_bill_code: string
          p_callback_received_at: string
          p_provider_transaction_id: string
          p_raw_response: Json
          p_verified_amount: number
        }
        Returns: Json
      }
      finalize_toyyibpay_payment: {
        Args: {
          p_attempt_id: string
          p_callback_received_at?: string
          p_provider_transaction_id: string
          p_provider_transaction_time?: string
          p_raw_response: Json
          p_verified_amount: number
        }
        Returns: Json
      }
      finalize_toyyibpay_payment_from_callback: {
        Args: {
          p_attempt_id: string
          p_billcode: string
          p_callback_received_at: string
          p_provider_transaction_id: string
          p_provider_transaction_time: string
          p_raw_response: Json
          p_verified_amount: number
        }
        Returns: Json
      }
      get_active_toyyibpay_attempt: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      get_my_module_access: { Args: never; Returns: Json }
      get_public_registration_schedule: {
        Args: { p_schedule_id: string }
        Returns: {
          available_seats: number
          capacity: number
          course_id: string
          course_slug: string
          course_title: string
          delivery_mode: string
          end_date: string
          end_time: string
          fee: number
          registration_available: boolean
          schedule_code: string
          schedule_id: string
          start_date: string
          start_time: string
          status: string
          venue: string
        }[]
      }
      get_public_registration_status: {
        Args: {
          p_registration_reference: string
          p_registration_secret: string
        }
        Returns: {
          amount: number
          attendee_count: number
          course_title: string
          currency: string
          delivery_mode: string
          end_date: string
          hold_expires_at: string
          payment_status: string
          registration_reference: string
          registration_status: string
          start_date: string
          venue: string
        }[]
      }
      get_public_upcoming_schedules: {
        Args: { p_include_past?: boolean }
        Returns: {
          available_seats: number
          capacity: number
          course_id: string
          course_slug: string
          course_title: string
          delivery_mode: string
          end_date: string
          end_time: string
          schedule_id: string
          start_date: string
          start_time: string
          status: string
          venue: string
        }[]
      }
      has_module_access: { Args: { p_module_key: string }; Returns: boolean }
      has_module_access_level: {
        Args: { p_level?: string; p_module_key: string }
        Returns: boolean
      }
      issue_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      legacy_course_map_approve: {
        Args: {
          p_batch_id: string
          p_course_id: string
          p_course_map_id: string
        }
        Returns: number
      }
      legacy_import_create_batch: {
        Args: {
          p_original_filename: string
          p_source_file_hash?: string
          p_source_label: string
        }
        Returns: string
      }
      legacy_import_ingest_rows: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: number
      }
      legacy_merge_dry_run: { Args: { p_batch_id: string }; Returns: Json }
      legacy_merge_execute_row: {
        Args: { p_batch_id: string; p_row_id: string }
        Returns: Json
      }
      legacy_merge_finalize_batch: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      legacy_merge_verify_checkpoint: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      log_event: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_entity_id?: string
          p_entity_type?: string
          p_metadata?: Json
          p_summary?: string
        }
        Returns: undefined
      }
      log_event_as_service: {
        Args: {
          p_action: Database["public"]["Enums"]["audit_action"]
          p_actor_email: string
          p_actor_id: string
          p_entity_id?: string
          p_entity_type?: string
          p_metadata?: Json
          p_summary?: string
        }
        Returns: undefined
      }
      log_public_registration_payment_event: {
        Args: { p_attempt_id: string; p_detail: Json; p_event_type: string }
        Returns: Json
      }
      log_toyyibpay_callback_event: {
        Args: { p_attempt_id: string; p_detail: Json; p_event_type: string }
        Returns: Json
      }
      log_toyyibpay_conflict: {
        Args: {
          p_attempt_id: string
          p_conflict_type: string
          p_invoice_id: string
        }
        Returns: Json
      }
      log_toyyibpay_orphan_bill_event: {
        Args: {
          p_billcode: string
          p_compensation_status: string
          p_detail: string
          p_invoice_id: string
        }
        Returns: Json
      }
      mark_lead_test: {
        Args: { p_is_test: boolean; p_lead_metadata_id: string }
        Returns: undefined
      }
      mark_opportunity_lost: {
        Args: { p_opportunity_id: string; p_reason: string }
        Returns: undefined
      }
      mark_proposal_delivery_status: {
        Args: { p_email_sent: boolean; p_id: string; p_sheets_synced: boolean }
        Returns: undefined
      }
      mark_public_registration_payment_failed_from_callback: {
        Args: {
          p_attempt_id: string
          p_bill_code: string
          p_callback_received_at: string
          p_reason: string
        }
        Returns: Json
      }
      mark_toyyibpay_attempt_failed: {
        Args: {
          p_attempt_id: string
          p_callback_received_at?: string
          p_reason: string
        }
        Returns: Json
      }
      mark_toyyibpay_attempt_failed_from_callback: {
        Args: {
          p_attempt_id: string
          p_billcode: string
          p_callback_received_at: string
          p_reason: string
        }
        Returns: Json
      }
      mark_toyyibpay_attempt_superseded: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      module_access_rank: { Args: { p_level: string }; Returns: number }
      promote_marketing_contact_to_sales: {
        Args: { p_contact_id: string }
        Returns: string
      }
      record_manual_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_notes: string
          p_payment_date: string
          p_payment_method: string
          p_payment_provider: string
          p_payment_reference: string
        }
        Returns: Json
      }
      record_public_registration_payment_orphan: {
        Args: {
          p_attempt_id: string
          p_bill_code: string
          p_payment_url: string
          p_reason: string
        }
        Returns: Json
      }
      record_toyyibpay_bill: {
        Args: {
          p_amount: number
          p_attempt_id: string
          p_billcode: string
          p_invoice_id: string
          p_payment_url: string
        }
        Returns: Json
      }
      recover_public_registration_payment_claim: {
        Args: { p_attempt_id: string; p_reason: string }
        Returns: Json
      }
      reject_quotation: {
        Args: { p_quotation_id: string; p_reason: string }
        Returns: undefined
      }
      resolve_schedule_feedback_participant: {
        Args: {
          p_identity_number: string
          p_public_token: string
          p_request_fingerprint_hash: string
        }
        Returns: {
          already_submitted: boolean
          feedback_token: string
        }[]
      }
      reverse_won_opportunity: {
        Args: { p_opportunity_id: string; p_reason: string }
        Returns: undefined
      }
      schedule_group_assessor_conflicts: {
        Args: {
          p_assessor_id: string
          p_end_time: string
          p_exclude_group_id?: string
          p_schedule_id: string
          p_start_time: string
        }
        Returns: {
          group_id: string
          group_name: string
          schedule_code: string
        }[]
      }
      schedule_group_trainer_conflicts: {
        Args: {
          p_end_time: string
          p_exclude_group_id?: string
          p_schedule_id: string
          p_start_time: string
          p_trainer_id: string
        }
        Returns: {
          group_id: string
          group_name: string
          schedule_code: string
        }[]
      }
      set_must_change_password: {
        Args: { p_user_id: string; p_value: boolean }
        Returns: undefined
      }
      set_schedule_assessor: {
        Args: { p_assessor_id?: string; p_schedule_id: string }
        Returns: Json
      }
      set_staff_module_access: {
        Args: { p_modules: Json; p_user_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_proposal_request: {
        Args: {
          p_budget: string
          p_category: string
          p_company_name: string
          p_contact_person: string
          p_email: string
          p_industry: string
          p_job_title: string
          p_location: string
          p_notes: string
          p_objectives: string
          p_participants: number
          p_phone: string
          p_preferred_month: string
          p_programme: string
        }
        Returns: string
      }
      submit_public_enquiry: {
        Args: {
          p_company: string
          p_email: string
          p_enquiry_type: string
          p_message: string
          p_name: string
          p_phone: string
          p_source_page: string
          p_subject: string
        }
        Returns: string
      }
      teras_photo_next_id: { Args: never; Returns: string }
      update_staff_profile: {
        Args: {
          p_access_control_enabled?: boolean
          p_department?: Database["public"]["Enums"]["staff_department"]
          p_full_name?: string
          p_is_active?: boolean
          p_role?: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      verify_and_log: {
        Args: {
          p_ip?: string
          p_method?: string
          p_query: string
          p_ua?: string
        }
        Returns: {
          certificate_number: string
          company: string
          course_title: string
          expiry_date: string
          found: boolean
          holder_name: string
          is_valid: boolean
          issue_date: string
          participant_code_masked: string
          status: string
          training_date: string
          verified_at: string
        }[]
      }
      verify_certificate: {
        Args: { input_certificate_no: string }
        Returns: {
          certificate_no: string
          course_code: string
          course_name: string
          expiry_date: string
          issue_date: string
          participant_name: string
          status: string
          training_end_date: string
          training_start_date: string
          venue: string
        }[]
      }
      verify_certificate_by_value: {
        Args: { search_value: string }
        Returns: {
          certificate_file_url: string
          certificate_no: string
          course_name: string
          expiry_date: string
          instructor: string
          issue_date: string
          participant_name: string
          status: string
          trainer_name: string
          training_end_date: string
          training_start_date: string
          venue: string
        }[]
      }
      verify_public_registration_manual_payment: {
        Args: {
          p_amount: number
          p_notes?: string
          p_payment_reference: string
          p_registration_reference: string
          p_registration_secret: string
          p_verifier_id?: string
        }
        Returns: Json
      }
    }
    Enums: {
      audit_action:
        | "login"
        | "logout"
        | "create"
        | "update"
        | "delete"
        | "archive"
        | "restore"
        | "publish"
        | "upload"
        | "export"
        | "assign"
        | "import"
        | "staff_created"
        | "staff_updated"
        | "staff_activated"
        | "staff_deactivated"
        | "staff_role_changed"
        | "staff_department_changed"
        | "staff_module_access_changed"
        | "assessor_created"
        | "assessor_updated"
        | "assessor_activated"
        | "assessor_deactivated"
        | "assessor_assigned"
        | "assessor_unassigned"
        | "assessor_reassigned"
        | "password_changed"
      company_status: "active" | "inactive" | "prospect" | "archived"
      content_status: "draft" | "published" | "archived"
      media_kind: "image" | "pdf" | "document" | "video" | "other"
      schedule_status:
        | "open"
        | "full"
        | "in_progress"
        | "completed"
        | "cancelled"
      staff_department:
        | "management"
        | "sales"
        | "marketing"
        | "training_operations"
        | "administration"
        | "finance"
        | "hr"
      user_role:
        | "super_admin"
        | "admin"
        | "editor"
        | "trainer"
        | "client"
        | "participant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

// Compatibility aliases for application modules that import named row types.
// The underlying shapes remain generated from the staging schema above.
export type Profile = Tables<"profiles">
export type Course = Omit<
  Tables<"courses">,
  | "title"
  | "objectives"
  | "modules"
  | "target_audience"
  | "requirements"
  | "faq"
  | "delivery_modes"
  | "status"
  | "certificate_type"
> & {
  title: string
  objectives: string[]
  modules: { title: string; items?: string[] }[]
  target_audience: string[]
  requirements: string[]
  faq: { q: string; a: string }[]
  delivery_modes: CourseDeliveryMode[]
  status: ContentStatus
  certificate_type: CertificateType
}
export type Enquiry = Tables<"enquiries">
export type ProposalRequest = Tables<"proposal_requests">
export type ParticipantSkillResult = Tables<"participant_skill_results">
export type CertificateSkillResult = Tables<"certificate_skill_results">
export type MarketingCampaign = Tables<"marketing_campaigns">
export type MarketingContact = Tables<"marketing_contacts">
export type MarketingContactEvent = Tables<"marketing_contact_events">
export type SalesLeadAttribution = Tables<"sales_lead_attributions">

export type ContentStatus = Enums<"content_status">
export type UserRole = Enums<"user_role">
export type StaffDepartment = Enums<"staff_department">
export type ScheduleStatus = Enums<"schedule_status">
export type MarketingCampaignChannel = Tables<"marketing_campaigns">["channel"]
export type MarketingCampaignStatus = Tables<"marketing_campaigns">["status"]
export type MarketingContactStatus = Tables<"marketing_contacts">["status"]
export type MarketingContactSource = Tables<"marketing_contacts">["source"]
export type MarketingContactConsentStatus = Tables<"marketing_contacts">["consent_status"]
export type MarketingContactEventType = Tables<"marketing_contact_events">["event_type"]

// These application-level unions are not database enums in the staging schema.
export type ModuleAccessLevel = "view" | "edit" | "admin"
export type EnquiryStatus = Tables<"enquiries">["status"]
export type ProposalStatus = Tables<"proposal_requests">["status"]
export type CourseDeliveryMode = "public" | "in_house" | "onsite" | "online" | "hybrid"
export type CertificateType = "participation" | "completion" | "competency"
export type ParticipantSkillArea = Tables<"participant_skill_results">["area"]
export type ParticipantSkillStatus = Tables<"participant_skill_results">["status"]
export type CertificateSkillArea = Tables<"certificate_skill_results">["area"]
export type CertificateSkillStatus = Tables<"certificate_skill_results">["status"]

export const Constants = {
  public: {
    Enums: {
      audit_action: [
        "login",
        "logout",
        "create",
        "update",
        "delete",
        "archive",
        "restore",
        "publish",
        "upload",
        "export",
        "assign",
        "import",
        "staff_created",
        "staff_updated",
        "staff_activated",
        "staff_deactivated",
        "staff_role_changed",
        "staff_department_changed",
        "staff_module_access_changed",
        "assessor_created",
        "assessor_updated",
        "assessor_activated",
        "assessor_deactivated",
        "assessor_assigned",
        "assessor_unassigned",
        "assessor_reassigned",
        "password_changed",
      ],
      company_status: ["active", "inactive", "prospect", "archived"],
      content_status: ["draft", "published", "archived"],
      media_kind: ["image", "pdf", "document", "video", "other"],
      schedule_status: [
        "open",
        "full",
        "in_progress",
        "completed",
        "cancelled",
      ],
      staff_department: [
        "management",
        "sales",
        "marketing",
        "training_operations",
        "administration",
        "finance",
        "hr",
      ],
      user_role: [
        "super_admin",
        "admin",
        "editor",
        "trainer",
        "client",
        "participant",
      ],
    },
  },
} as const
