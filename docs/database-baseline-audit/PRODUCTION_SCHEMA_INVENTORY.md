# PRODUCTION SCHEMA INVENTORY

Audited: 2026-08-16 (UTC), Supabase project `iagzkrzeuawaxvacqprk` (TERAS Certificate Verification, ap-southeast-1).
Method: read-only `supabase db query --linked` against Postgres 17.6 catalog. Production was not modified.

## Counts
- Tables (public+app): **51**
- Views: **2**
- Functions/RPCs: **78**
- Triggers: **48**
- RLS policies: **109**
- Extensions: **7**
- Enum/domain types: **6**
- Sequences (non-system): **8**

## Extensions
- `citext` v1.6 in schema `extensions` (owner supabase_admin)
- `pg_stat_statements` v1.11 in schema `extensions` (owner postgres)
- `pg_trgm` v1.6 in schema `public` (owner supabase_admin)
- `pgcrypto` v1.3 in schema `extensions` (owner postgres)
- `plpgsql` v1.0 in schema `pg_catalog` (owner supabase_admin)
- `supabase_vault` v0.3.1 in schema `vault` (owner supabase_admin)
- `uuid-ossp` v1.1 in schema `extensions` (owner postgres)

## Enum / domain types
- `public.audit_action` (enum): login, logout, create, update, delete, archive, restore, publish, upload, export, assign, import
- `public.company_status` (enum): active, inactive, prospect, archived
- `public.content_status` (enum): draft, published, archived
- `public.media_kind` (enum): image, pdf, document, video, other
- `public.schedule_status` (enum): open, full, in_progress, completed, cancelled
- `public.user_role` (enum): super_admin, admin, editor, trainer, client, participant

## Tables (columns, constraints, indexes, RLS, grants)

### public.admin_users

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| user_id | uuid | NO |  | NEVER |
| display_name | text | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] admin_users_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- [PRIMARY KEY] admin_users_pkey: PRIMARY KEY (user_id)

Indexes:
- admin_users_pkey (unique=True): `CREATE UNIQUE INDEX admin_users_pkey ON public.admin_users USING btree (user_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.assessments

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | YES |  | NEVER |
| participant_id | uuid | NO |  | NEVER |
| assessment_type | text | YES |  | NEVER |
| score | numeric | YES |  | NEVER |
| max_score | numeric | YES | 100 | NEVER |
| result | text | NO | 'pending'::text | NEVER |
| assessed_at | date | YES |  | NEVER |
| remarks | text | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| theory_score | numeric | YES |  | NEVER |
| practical_score | numeric | YES |  | NEVER |
| competency_status | text | YES |  | NEVER |
| locked | boolean | NO | false | NEVER |
| locked_at | timestamp with time zone | YES |  | NEVER |
| locked_by | uuid | YES |  | NEVER |
| assessor_id | uuid | YES |  | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] assessments_competency_status_check: CHECK (((competency_status IS NULL) OR (competency_status = ANY (ARRAY['pending_review'::text, 'competent'::text, 'not_yet_competent'::text]))))
- [CHECK] assessments_result_check: CHECK ((result = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text])))
- [FOREIGN KEY] assessments_assessor_id_fkey: FOREIGN KEY (assessor_id) REFERENCES profiles(id)
- [FOREIGN KEY] assessments_locked_by_fkey: FOREIGN KEY (locked_by) REFERENCES profiles(id)
- [FOREIGN KEY] assessments_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
- [FOREIGN KEY] assessments_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL
- [PRIMARY KEY] assessments_pkey: PRIMARY KEY (id)
- [UNIQUE] assessments_schedule_participant_key: UNIQUE (schedule_id, participant_id)

Indexes:
- assessments_participant_idx (unique=False): `CREATE INDEX assessments_participant_idx ON public.assessments USING btree (participant_id) WHERE (deleted_at IS NULL)`
- assessments_pkey (unique=True): `CREATE UNIQUE INDEX assessments_pkey ON public.assessments USING btree (id)`
- assessments_schedule_idx (unique=False): `CREATE INDEX assessments_schedule_idx ON public.assessments USING btree (schedule_id) WHERE (deleted_at IS NULL)`
- assessments_schedule_participant_key (unique=True): `CREATE UNIQUE INDEX assessments_schedule_participant_key ON public.assessments USING btree (schedule_id, participant_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.attendance

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | NO |  | NEVER |
| participant_id | uuid | NO |  | NEVER |
| session_date | date | NO |  | NEVER |
| present | boolean | NO | false | NEVER |
| remarks | text | YES |  | NEVER |
| recorded_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| attendance_status | text | NO | 'absent'::text | NEVER |
| check_in_time | timestamp with time zone | YES |  | NEVER |
| check_out_time | timestamp with time zone | YES |  | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] attendance_status_check: CHECK ((attendance_status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text])))
- [FOREIGN KEY] attendance_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
- [FOREIGN KEY] attendance_recorded_by_fkey: FOREIGN KEY (recorded_by) REFERENCES profiles(id)
- [FOREIGN KEY] attendance_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE CASCADE
- [PRIMARY KEY] attendance_pkey: PRIMARY KEY (id)
- [UNIQUE] attendance_schedule_participant_session_key: UNIQUE (schedule_id, participant_id, session_date)

Indexes:
- attendance_participant_idx (unique=False): `CREATE INDEX attendance_participant_idx ON public.attendance USING btree (participant_id) WHERE (deleted_at IS NULL)`
- attendance_pkey (unique=True): `CREATE UNIQUE INDEX attendance_pkey ON public.attendance USING btree (id)`
- attendance_schedule_idx (unique=False): `CREATE INDEX attendance_schedule_idx ON public.attendance USING btree (schedule_id) WHERE (deleted_at IS NULL)`
- attendance_schedule_participant_session_key (unique=True): `CREATE UNIQUE INDEX attendance_schedule_participant_session_key ON public.attendance USING btree (schedule_id, participant_id, session_date)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.audit_logs

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | bigint | NO |  | NEVER |
| actor_id | uuid | YES |  | NEVER |
| actor_email | text | YES |  | NEVER |
| action | USER-DEFINED | NO |  | NEVER |
| entity_type | text | YES |  | NEVER |
| entity_id | text | YES |  | NEVER |
| summary | text | YES |  | NEVER |
| metadata | jsonb | NO | '{}'::jsonb | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] audit_logs_actor_id_fkey: FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL
- [PRIMARY KEY] audit_logs_pkey: PRIMARY KEY (id)

Indexes:
- audit_logs_pkey (unique=True): `CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)`
- idx_audit_actor (unique=False): `CREATE INDEX idx_audit_actor ON public.audit_logs USING btree (actor_id)`
- idx_audit_created (unique=False): `CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at DESC)`
- idx_audit_entity (unique=False): `CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.certificate_import_logs

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| created_by | uuid | NO |  | NEVER |
| source | text | NO | 'csv'::text | NEVER |
| source_file_count | integer | NO | 0 | NEVER |
| row_count | integer | NO | 0 | NEVER |
| imported_count | integer | NO | 0 | NEVER |
| skipped_count | integer | NO | 0 | NEVER |
| error_count | integer | NO | 0 | NEVER |
| status | text | NO | 'completed'::text | NEVER |
| error_summary | jsonb | NO | '[]'::jsonb | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] certificate_import_logs_source_check: CHECK ((source = ANY (ARRAY['csv'::text, 'pdf'::text])))
- [CHECK] certificate_import_logs_status_check: CHECK ((status = ANY (ARRAY['completed'::text, 'partial'::text, 'failed'::text])))
- [FOREIGN KEY] certificate_import_logs_created_by_fkey: FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT
- [PRIMARY KEY] certificate_import_logs_pkey: PRIMARY KEY (id)

Indexes:
- certificate_import_logs_created_by_idx (unique=False): `CREATE INDEX certificate_import_logs_created_by_idx ON public.certificate_import_logs USING btree (created_by)`
- certificate_import_logs_pkey (unique=True): `CREATE UNIQUE INDEX certificate_import_logs_pkey ON public.certificate_import_logs USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.certificate_skill_results

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| certificate_id | uuid | NO |  | NEVER |
| area | text | NO |  | NEVER |
| status | text | NO |  | NEVER |
| score | numeric | YES |  | NEVER |
| notes | text | YES |  | NEVER |
| source_skill_result_id | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] certificate_skill_results_area_check: CHECK ((area = ANY (ARRAY['theory_session'::text, 'practical_training'::text, 'safety_awareness'::text, 'practical_assessment'::text, 'attendance_requirement'::text])))
- [CHECK] certificate_skill_results_area_status_check: CHECK ((((area = 'theory_session'::text) AND (status = ANY (ARRAY['not_recorded'::text, 'completed'::text]))) OR ((area = 'practical_training'::text) AND (status = ANY (ARRAY['not_recorded'::text, 'completed'::text]))) OR ((area = 'safety_awareness'::text) AND (status = ANY (ARRAY['not_recorded'::text, 'completed'::text]))) OR ((area = 'practical_assessment'::text) AND (status = ANY (ARRAY['not_recorded'::text, 'passed'::text, 'failed'::text]))) OR ((area = 'attendance_requirement'::text) AND (status = ANY (ARRAY['not_recorded'::text, 'met'::text, 'not_met'::text])))))
- [FOREIGN KEY] certificate_skill_results_certificate_id_fkey: FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE
- [FOREIGN KEY] certificate_skill_results_source_skill_result_id_fkey: FOREIGN KEY (source_skill_result_id) REFERENCES participant_skill_results(id) ON DELETE SET NULL
- [PRIMARY KEY] certificate_skill_results_pkey: PRIMARY KEY (id)
- [UNIQUE] certificate_skill_results_certificate_area_key: UNIQUE (certificate_id, area)

Indexes:
- certificate_skill_results_certificate_area_key (unique=True): `CREATE UNIQUE INDEX certificate_skill_results_certificate_area_key ON public.certificate_skill_results USING btree (certificate_id, area)`
- certificate_skill_results_pkey (unique=True): `CREATE UNIQUE INDEX certificate_skill_results_pkey ON public.certificate_skill_results USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.certificate_templates

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| description | text | YES |  | NEVER |
| orientation | text | NO | 'landscape'::text | NEVER |
| paper_size | text | NO | 'A4'::text | NEVER |
| config | jsonb | NO | '{}'::jsonb | NEVER |
| is_active | boolean | NO | true | NEVER |
| is_default | boolean | NO | false | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] certificate_templates_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] certificate_templates_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] certificate_templates_pkey: PRIMARY KEY (id)

Indexes:
- certificate_templates_pkey (unique=True): `CREATE UNIQUE INDEX certificate_templates_pkey ON public.certificate_templates USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.certificate_verifications

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | bigint | NO |  | NEVER |
| certificate_id | uuid | YES |  | NEVER |
| certificate_number | text | YES |  | NEVER |
| method | text | YES |  | NEVER |
| query_value | text | YES |  | NEVER |
| status_returned | text | YES |  | NEVER |
| ip_address | inet | YES |  | NEVER |
| user_agent | text | YES |  | NEVER |
| verified_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] certificate_verifications_certificate_id_fkey: FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE SET NULL
- [PRIMARY KEY] certificate_verifications_pkey: PRIMARY KEY (id)

Indexes:
- certificate_verifications_pkey (unique=True): `CREATE UNIQUE INDEX certificate_verifications_pkey ON public.certificate_verifications USING btree (id)`
- idx_cert_verif_cert (unique=False): `CREATE INDEX idx_cert_verif_cert ON public.certificate_verifications USING btree (certificate_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.certificates

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| certificate_no | text | NO |  | NEVER |
| participant_name | text | NO |  | NEVER |
| identity_last4 | text | YES |  | NEVER |
| course_name | text | NO |  | NEVER |
| course_code | text | YES |  | NEVER |
| training_start_date | date | YES |  | NEVER |
| training_end_date | date | YES |  | NEVER |
| issue_date | date | NO |  | NEVER |
| expiry_date | date | YES |  | NEVER |
| status | text | NO | 'valid'::text | NEVER |
| trainer_name | text | YES |  | NEVER |
| venue | text | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| participant_id | uuid | NO |  | NEVER |
| course_id | uuid | NO |  | NEVER |
| metadata | jsonb | NO | '{}'::jsonb | NEVER |
| identity_no | text | YES |  | NEVER |
| instructor | text | YES |  | NEVER |
| certificate_file_url | text | YES |  | NEVER |
| public_verification_enabled | boolean | NO | true | NEVER |
| certificate_number | text | YES |  | NEVER |
| holder_name | text | YES |  | NEVER |
| template_id | uuid | YES |  | NEVER |
| verification_token | text | YES |  | NEVER |
| verification_url | text | YES |  | NEVER |
| verification_enabled | boolean | NO | true | NEVER |
| issued_by | uuid | YES |  | NEVER |
| remarks | text | YES |  | NEVER |
| schedule_id | uuid | YES |  | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] certificates_status_check: CHECK ((status = ANY (ARRAY['valid'::text, 'expired'::text, 'revoked'::text, 'draft'::text, 'issued'::text, 'archived'::text])))
- [FOREIGN KEY] certificates_course_id_fkey: FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
- [FOREIGN KEY] certificates_issued_by_fkey: FOREIGN KEY (issued_by) REFERENCES profiles(id)
- [FOREIGN KEY] certificates_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE RESTRICT
- [FOREIGN KEY] certificates_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL
- [FOREIGN KEY] fk_certificates_template: FOREIGN KEY (template_id) REFERENCES certificate_templates(id) ON DELETE SET NULL
- [PRIMARY KEY] certificates_pkey: PRIMARY KEY (id)
- [UNIQUE] certificates_certificate_no_key: UNIQUE (certificate_no)

Indexes:
- certificates_active_schedule_participant_uniq (unique=True): `CREATE UNIQUE INDEX certificates_active_schedule_participant_uniq ON public.certificates USING btree (schedule_id, participant_id) WHERE ((deleted_at IS NULL) AND (status <> 'revoked'::text) AND (schedule_id IS NOT NULL))`
- certificates_certificate_no_key (unique=True): `CREATE UNIQUE INDEX certificates_certificate_no_key ON public.certificates USING btree (certificate_no)`
- certificates_certificate_no_upper_idx (unique=False): `CREATE INDEX certificates_certificate_no_upper_idx ON public.certificates USING btree (upper(certificate_no))`
- certificates_course_id_idx (unique=False): `CREATE INDEX certificates_course_id_idx ON public.certificates USING btree (course_id)`
- certificates_identity_no_idx (unique=False): `CREATE INDEX certificates_identity_no_idx ON public.certificates USING btree (identity_no)`
- certificates_participant_id_idx (unique=False): `CREATE INDEX certificates_participant_id_idx ON public.certificates USING btree (participant_id)`
- certificates_pkey (unique=True): `CREATE UNIQUE INDEX certificates_pkey ON public.certificates USING btree (id)`
- certificates_schedule_idx (unique=False): `CREATE INDEX certificates_schedule_idx ON public.certificates USING btree (schedule_id) WHERE (deleted_at IS NULL)`
- idx_certificates_live (unique=False): `CREATE INDEX idx_certificates_live ON public.certificates USING btree (status) WHERE (deleted_at IS NULL)`
- uq_certificates_number (unique=True): `CREATE UNIQUE INDEX uq_certificates_number ON public.certificates USING btree (certificate_number) WHERE (certificate_number IS NOT NULL)`
- uq_certificates_verification_token (unique=True): `CREATE UNIQUE INDEX uq_certificates_verification_token ON public.certificates USING btree (verification_token) WHERE (verification_token IS NOT NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.cms_content

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| content_type | text | NO |  | NEVER |
| slug | text | YES |  | NEVER |
| title | text | YES |  | NEVER |
| body | jsonb | NO | '{}'::jsonb | NEVER |
| status | USER-DEFINED | NO | 'draft'::content_status | NEVER |
| featured | boolean | NO | false | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] cms_content_content_type_check: CHECK ((content_type = ANY (ARRAY['news'::text, 'faq'::text, 'testimonial'::text, 'download'::text, 'gallery'::text, 'company'::text, 'setting'::text])))
- [FOREIGN KEY] cms_content_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] cms_content_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] cms_content_pkey: PRIMARY KEY (id)
- [UNIQUE] cms_content_content_type_slug_key: UNIQUE (content_type, slug)

Indexes:
- cms_content_content_type_slug_key (unique=True): `CREATE UNIQUE INDEX cms_content_content_type_slug_key ON public.cms_content USING btree (content_type, slug)`
- cms_content_live_idx (unique=False): `CREATE INDEX cms_content_live_idx ON public.cms_content USING btree (content_type, status, sort_order) WHERE (deleted_at IS NULL)`
- cms_content_pkey (unique=True): `CREATE UNIQUE INDEX cms_content_pkey ON public.cms_content USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.cms_media

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| bucket | text | NO | 'media'::text | NEVER |
| storage_path | text | NO |  | NEVER |
| file_name | text | NO |  | NEVER |
| mime_type | text | YES |  | NEVER |
| file_size | bigint | YES |  | NEVER |
| public_url | text | YES |  | NEVER |
| alt_text | text | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] cms_media_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [PRIMARY KEY] cms_media_pkey: PRIMARY KEY (id)
- [UNIQUE] cms_media_bucket_storage_path_key: UNIQUE (bucket, storage_path)

Indexes:
- cms_media_bucket_storage_path_key (unique=True): `CREATE UNIQUE INDEX cms_media_bucket_storage_path_key ON public.cms_media USING btree (bucket, storage_path)`
- cms_media_pkey (unique=True): `CREATE UNIQUE INDEX cms_media_pkey ON public.cms_media USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.companies

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| company_id | text | YES |  | NEVER |
| company_name | text | NO |  | NEVER |
| registration_no | text | YES |  | NEVER |
| industry | text | YES |  | NEVER |
| company_type | text | YES |  | NEVER |
| address | text | YES |  | NEVER |
| postcode | text | YES |  | NEVER |
| city | text | YES |  | NEVER |
| state | text | YES |  | NEVER |
| country | text | YES | 'Malaysia'::text | NEVER |
| phone | text | YES |  | NEVER |
| email | text | YES |  | NEVER |
| website | text | YES |  | NEVER |
| person_in_charge | text | YES |  | NEVER |
| pic_position | text | YES |  | NEVER |
| pic_phone | text | YES |  | NEVER |
| pic_email | text | YES |  | NEVER |
| billing_address | text | YES |  | NEVER |
| status | USER-DEFINED | NO | 'active'::company_status | NEVER |
| remarks | text | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] companies_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] companies_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] companies_pkey: PRIMARY KEY (id)
- [UNIQUE] companies_company_id_key: UNIQUE (company_id)

Indexes:
- companies_company_id_key (unique=True): `CREATE UNIQUE INDEX companies_company_id_key ON public.companies USING btree (company_id)`
- companies_pkey (unique=True): `CREATE UNIQUE INDEX companies_pkey ON public.companies USING btree (id)`
- idx_companies_name (unique=False): `CREATE INDEX idx_companies_name ON public.companies USING btree (lower(company_name))`
- idx_companies_status (unique=False): `CREATE INDEX idx_companies_status ON public.companies USING btree (status) WHERE (deleted_at IS NULL)`
- uq_companies_company_id (unique=True): `CREATE UNIQUE INDEX uq_companies_company_id ON public.companies USING btree (company_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.company_profile

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | integer | NO | 1 | NEVER |
| legal_name | text | YES |  | NEVER |
| tagline | text | YES |  | NEVER |
| about | text | YES |  | NEVER |
| vision | text | YES |  | NEVER |
| mission | text | YES |  | NEVER |
| services | jsonb | NO | '[]'::jsonb | NEVER |
| phone | text | YES |  | NEVER |
| email_training | text | YES |  | NEVER |
| email_admin | text | YES |  | NEVER |
| address | text | YES |  | NEVER |
| city | text | YES |  | NEVER |
| state | text | YES |  | NEVER |
| postcode | text | YES |  | NEVER |
| country | text | YES | 'Malaysia'::text | NEVER |
| google_map_embed | text | YES |  | NEVER |
| whatsapp | text | YES |  | NEVER |
| social_media | jsonb | NO | '{}'::jsonb | NEVER |
| updated_by | uuid | YES |  | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] company_profile_id_check: CHECK ((id = 1))
- [FOREIGN KEY] company_profile_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] company_profile_pkey: PRIMARY KEY (id)

Indexes:
- company_profile_pkey (unique=True): `CREATE UNIQUE INDEX company_profile_pkey ON public.company_profile USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.course_schedules

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| course_id | uuid | NO |  | NEVER |
| trainer_name | text | YES |  | NEVER |
| venue | text | YES |  | NEVER |
| start_date | date | NO |  | NEVER |
| end_date | date | NO |  | NEVER |
| capacity | integer | NO | 0 | NEVER |
| seats_taken | integer | NO | 0 | NEVER |
| status | USER-DEFINED | NO | 'open'::schedule_status | NEVER |
| notes | text | YES |  | NEVER |
| is_published | boolean | NO | true | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |
| schedule_code | text | YES |  | NEVER |
| training_mode | text | YES |  | NEVER |
| start_time | time without time zone | YES |  | NEVER |
| end_time | time without time zone | YES |  | NEVER |
| source_opportunity_id | uuid | YES |  | NEVER |
| source_quotation_id | uuid | YES |  | NEVER |
| exam_date | date | YES |  | NEVER |

Constraints:
- [CHECK] course_schedules_capacity_check: CHECK ((capacity >= 0))
- [CHECK] course_schedules_check: CHECK (((seats_taken >= 0) AND (seats_taken <= capacity)))
- [CHECK] course_schedules_check1: CHECK ((end_date >= start_date))
- [FOREIGN KEY] course_schedules_course_id_fkey: FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT
- [FOREIGN KEY] course_schedules_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] course_schedules_source_opportunity_id_fkey: FOREIGN KEY (source_opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL
- [FOREIGN KEY] course_schedules_source_quotation_id_fkey: FOREIGN KEY (source_quotation_id) REFERENCES sales_quotations(id) ON DELETE SET NULL
- [FOREIGN KEY] course_schedules_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] course_schedules_pkey: PRIMARY KEY (id)

Indexes:
- course_schedules_course_idx (unique=False): `CREATE INDEX course_schedules_course_idx ON public.course_schedules USING btree (course_id) WHERE (deleted_at IS NULL)`
- course_schedules_pkey (unique=True): `CREATE UNIQUE INDEX course_schedules_pkey ON public.course_schedules USING btree (id)`
- course_schedules_schedule_code_key (unique=True): `CREATE UNIQUE INDEX course_schedules_schedule_code_key ON public.course_schedules USING btree (schedule_code) WHERE (schedule_code IS NOT NULL)`
- course_schedules_source_opportunity_unique (unique=True): `CREATE UNIQUE INDEX course_schedules_source_opportunity_unique ON public.course_schedules USING btree (source_opportunity_id) WHERE ((source_opportunity_id IS NOT NULL) AND (deleted_at IS NULL))`
- course_schedules_source_quotation_id_idx (unique=False): `CREATE INDEX course_schedules_source_quotation_id_idx ON public.course_schedules USING btree (source_quotation_id) WHERE (source_quotation_id IS NOT NULL)`
- course_schedules_start_idx (unique=False): `CREATE INDEX course_schedules_start_idx ON public.course_schedules USING btree (start_date) WHERE (deleted_at IS NULL)`
- course_schedules_status_idx (unique=False): `CREATE INDEX course_schedules_status_idx ON public.course_schedules USING btree (status) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.courses

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| course_code | text | YES |  | NEVER |
| course_name | text | YES |  | NEVER |
| description | text | YES |  | NEVER |
| validity_months | integer | YES |  | NEVER |
| active | boolean | NO | true | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| title | text | YES |  | NEVER |
| slug | text | YES |  | NEVER |
| category | text | YES |  | NEVER |
| summary | text | YES |  | NEVER |
| overview | text | YES |  | NEVER |
| duration | text | YES |  | NEVER |
| objectives | jsonb | NO | '[]'::jsonb | NEVER |
| target_audience | jsonb | NO | '[]'::jsonb | NEVER |
| requirements | jsonb | NO | '[]'::jsonb | NEVER |
| modules | jsonb | NO | '[]'::jsonb | NEVER |
| faq | jsonb | NO | '[]'::jsonb | NEVER |
| hero_image_url | text | YES |  | NEVER |
| fee | numeric | YES |  | NEVER |
| cms_status | USER-DEFINED | NO | 'draft'::content_status | NEVER |
| featured | boolean | NO | false | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| delivery_modes | ARRAY | NO | '{}'::text[] | NEVER |
| status | text | NO | 'draft'::text | NEVER |
| seo_title | text | YES |  | NEVER |
| seo_description | text | YES |  | NEVER |
| published_at | timestamp with time zone | YES |  | NEVER |
| certificate_type | text | NO | 'completion'::text | NEVER |
| attendance_min_percent | numeric | NO | 100 | NEVER |
| assessment_required | boolean | NO | false | NEVER |
| competency_required | boolean | NO | false | NEVER |
| certificate_generation_enabled | boolean | NO | false | NEVER |
| certificate_template_id | uuid | YES |  | NEVER |

Constraints:
- [CHECK] courses_attendance_min_percent_check: CHECK (((attendance_min_percent >= (0)::numeric) AND (attendance_min_percent <= (100)::numeric)))
- [CHECK] courses_certificate_type_check: CHECK ((certificate_type = ANY (ARRAY['participation'::text, 'completion'::text, 'competency'::text])))
- [CHECK] courses_competency_requires_assessment_check: CHECK (((NOT competency_required) OR assessment_required))
- [CHECK] courses_status_check: CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
- [CHECK] courses_validity_months_check: CHECK (((validity_months IS NULL) OR (validity_months >= 0)))
- [FOREIGN KEY] courses_certificate_template_id_fkey: FOREIGN KEY (certificate_template_id) REFERENCES certificate_templates(id) ON DELETE SET NULL
- [FOREIGN KEY] courses_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] courses_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] courses_pkey: PRIMARY KEY (id)
- [UNIQUE] courses_course_code_key: UNIQUE (course_code)

Indexes:
- courses_active_slug_unique (unique=True): `CREATE UNIQUE INDEX courses_active_slug_unique ON public.courses USING btree (lower(TRIM(BOTH FROM slug))) WHERE ((deleted_at IS NULL) AND (status <> 'archived'::text) AND (slug IS NOT NULL) AND (TRIM(BOTH FROM slug) <> ''::text))`
- courses_certificate_template_id_idx (unique=False): `CREATE INDEX courses_certificate_template_id_idx ON public.courses USING btree (certificate_template_id) WHERE (certificate_template_id IS NOT NULL)`
- courses_cms_slug_idx (unique=False): `CREATE INDEX courses_cms_slug_idx ON public.courses USING btree (slug) WHERE (slug IS NOT NULL)`
- courses_course_code_key (unique=True): `CREATE UNIQUE INDEX courses_course_code_key ON public.courses USING btree (course_code)`
- courses_course_name_idx (unique=False): `CREATE INDEX courses_course_name_idx ON public.courses USING btree (lower(course_name))`
- courses_pkey (unique=True): `CREATE UNIQUE INDEX courses_pkey ON public.courses USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.downloads

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| title | text | NO |  | NEVER |
| slug | text | YES |  | NEVER |
| description | text | YES |  | NEVER |
| category | text | YES |  | NEVER |
| media_id | uuid | YES |  | NEVER |
| file_url | text | YES |  | NEVER |
| file_size | bigint | YES |  | NEVER |
| download_count | integer | NO | 0 | NEVER |
| status | USER-DEFINED | NO | 'published'::content_status | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] downloads_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] downloads_media_id_fkey: FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
- [FOREIGN KEY] downloads_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] downloads_pkey: PRIMARY KEY (id)
- [UNIQUE] downloads_slug_key: UNIQUE (slug)

Indexes:
- downloads_pkey (unique=True): `CREATE UNIQUE INDEX downloads_pkey ON public.downloads USING btree (id)`
- downloads_slug_key (unique=True): `CREATE UNIQUE INDEX downloads_slug_key ON public.downloads USING btree (slug)`
- idx_downloads_live (unique=False): `CREATE INDEX idx_downloads_live ON public.downloads USING btree (category) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.enquiries

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| company | text | YES |  | NEVER |
| email | text | NO |  | NEVER |
| phone | text | NO |  | NEVER |
| enquiry_type | text | NO |  | NEVER |
| subject | text | NO |  | NEVER |
| message | text | NO |  | NEVER |
| source_page | text | NO |  | NEVER |
| status | text | NO | 'new'::text | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] enquiries_company_check: CHECK (((company IS NULL) OR (char_length(company) <= 160)))
- [CHECK] enquiries_email_check: CHECK (((char_length(email) >= 3) AND (char_length(email) <= 254)))
- [CHECK] enquiries_enquiry_type_check: CHECK ((enquiry_type = ANY (ARRAY['Corporate'::text, 'Individual'::text, 'Government'::text, 'Training'::text])))
- [CHECK] enquiries_message_check: CHECK (((char_length(message) >= 1) AND (char_length(message) <= 3000)))
- [CHECK] enquiries_name_check: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
- [CHECK] enquiries_phone_check: CHECK (((char_length(phone) >= 1) AND (char_length(phone) <= 40)))
- [CHECK] enquiries_source_page_check: CHECK ((source_page = ANY (ARRAY['homepage'::text, 'contact_page'::text])))
- [CHECK] enquiries_status_check: CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'closed'::text])))
- [CHECK] enquiries_subject_check: CHECK (((char_length(subject) >= 1) AND (char_length(subject) <= 160)))
- [PRIMARY KEY] enquiries_pkey: PRIMARY KEY (id)

Indexes:
- enquiries_created_at_idx (unique=False): `CREATE INDEX enquiries_created_at_idx ON public.enquiries USING btree (created_at DESC)`
- enquiries_email_created_at_idx (unique=False): `CREATE INDEX enquiries_email_created_at_idx ON public.enquiries USING btree (email, created_at DESC)`
- enquiries_pkey (unique=True): `CREATE UNIQUE INDEX enquiries_pkey ON public.enquiries USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->SELECT; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.faq_categories

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| slug | text | NO |  | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [PRIMARY KEY] faq_categories_pkey: PRIMARY KEY (id)
- [UNIQUE] faq_categories_slug_key: UNIQUE (slug)

Indexes:
- faq_categories_pkey (unique=True): `CREATE UNIQUE INDEX faq_categories_pkey ON public.faq_categories USING btree (id)`
- faq_categories_slug_key (unique=True): `CREATE UNIQUE INDEX faq_categories_slug_key ON public.faq_categories USING btree (slug)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.faqs

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| question | text | NO |  | NEVER |
| answer | text | NO |  | NEVER |
| category_id | uuid | YES |  | NEVER |
| status | USER-DEFINED | NO | 'published'::content_status | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] faqs_category_id_fkey: FOREIGN KEY (category_id) REFERENCES faq_categories(id) ON DELETE SET NULL
- [FOREIGN KEY] faqs_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] faqs_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] faqs_pkey: PRIMARY KEY (id)

Indexes:
- faqs_pkey (unique=True): `CREATE UNIQUE INDEX faqs_pkey ON public.faqs USING btree (id)`
- idx_faqs_live (unique=False): `CREATE INDEX idx_faqs_live ON public.faqs USING btree (sort_order) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.feedback_improvement_actions

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| issue_id | uuid | NO |  | NEVER |
| schedule_id | uuid | YES |  | NEVER |
| category | text | YES |  | NEVER |
| department | text | YES |  | NEVER |
| title | text | NO |  | NEVER |
| description | text | YES |  | NEVER |
| priority | text | NO | 'medium'::text | NEVER |
| status | text | NO | 'open'::text | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| due_date | date | YES |  | NEVER |
| corrective_action | text | YES |  | NEVER |
| verification_note | text | YES |  | NEVER |
| resolved_at | timestamp with time zone | YES |  | NEVER |
| verified_at | timestamp with time zone | YES |  | NEVER |
| closed_at | timestamp with time zone | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] feedback_improvement_actions_category_check: CHECK ((char_length(category) <= 120))
- [CHECK] feedback_improvement_actions_corrective_action_check: CHECK ((char_length(corrective_action) <= 4000))
- [CHECK] feedback_improvement_actions_department_check: CHECK ((char_length(department) <= 160))
- [CHECK] feedback_improvement_actions_description_check: CHECK ((char_length(description) <= 4000))
- [CHECK] feedback_improvement_actions_priority_check: CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
- [CHECK] feedback_improvement_actions_status_check: CHECK ((status = ANY (ARRAY['open'::text, 'assigned'::text, 'in_progress'::text, 'resolved'::text, 'verified'::text, 'closed'::text])))
- [CHECK] feedback_improvement_actions_title_check: CHECK (((char_length(title) >= 3) AND (char_length(title) <= 240)))
- [CHECK] feedback_improvement_actions_verification_note_check: CHECK ((char_length(verification_note) <= 4000))
- [FOREIGN KEY] feedback_improvement_actions_assigned_to_fkey: FOREIGN KEY (assigned_to) REFERENCES profiles(id)
- [FOREIGN KEY] feedback_improvement_actions_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] feedback_improvement_actions_issue_id_fkey: FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE
- [FOREIGN KEY] feedback_improvement_actions_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL
- [FOREIGN KEY] feedback_improvement_actions_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] feedback_improvement_actions_pkey: PRIMARY KEY (id)

Indexes:
- feedback_actions_assigned_idx (unique=False): `CREATE INDEX feedback_actions_assigned_idx ON public.feedback_improvement_actions USING btree (assigned_to) WHERE (assigned_to IS NOT NULL)`
- feedback_actions_issue_idx (unique=False): `CREATE INDEX feedback_actions_issue_idx ON public.feedback_improvement_actions USING btree (issue_id)`
- feedback_actions_schedule_idx (unique=False): `CREATE INDEX feedback_actions_schedule_idx ON public.feedback_improvement_actions USING btree (schedule_id)`
- feedback_actions_status_idx (unique=False): `CREATE INDEX feedback_actions_status_idx ON public.feedback_improvement_actions USING btree (status)`
- feedback_improvement_actions_pkey (unique=True): `CREATE UNIQUE INDEX feedback_improvement_actions_pkey ON public.feedback_improvement_actions USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.feedback_issues

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| source_feedback_id | uuid | YES |  | NEVER |
| schedule_id | uuid | YES |  | NEVER |
| category | text | YES |  | NEVER |
| department | text | YES |  | NEVER |
| title | text | NO |  | NEVER |
| description | text | YES |  | NEVER |
| priority | text | NO | 'medium'::text | NEVER |
| status | text | NO | 'open'::text | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] feedback_issues_category_check: CHECK ((char_length(category) <= 120))
- [CHECK] feedback_issues_department_check: CHECK ((char_length(department) <= 160))
- [CHECK] feedback_issues_description_check: CHECK ((char_length(description) <= 4000))
- [CHECK] feedback_issues_priority_check: CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
- [CHECK] feedback_issues_status_check: CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
- [CHECK] feedback_issues_title_check: CHECK (((char_length(title) >= 3) AND (char_length(title) <= 240)))
- [FOREIGN KEY] feedback_issues_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] feedback_issues_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL
- [FOREIGN KEY] feedback_issues_source_feedback_id_fkey: FOREIGN KEY (source_feedback_id) REFERENCES participant_feedback(id) ON DELETE SET NULL
- [FOREIGN KEY] feedback_issues_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] feedback_issues_pkey: PRIMARY KEY (id)

Indexes:
- feedback_issues_pkey (unique=True): `CREATE UNIQUE INDEX feedback_issues_pkey ON public.feedback_issues USING btree (id)`
- feedback_issues_schedule_idx (unique=False): `CREATE INDEX feedback_issues_schedule_idx ON public.feedback_issues USING btree (schedule_id) WHERE (deleted_at IS NULL)`
- feedback_issues_source_idx (unique=False): `CREATE INDEX feedback_issues_source_idx ON public.feedback_issues USING btree (source_feedback_id) WHERE (deleted_at IS NULL)`
- feedback_issues_status_idx (unique=False): `CREATE INDEX feedback_issues_status_idx ON public.feedback_issues USING btree (status) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.feedback_schedule_links

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | NO |  | NEVER |
| public_token | text | NO |  | NEVER |
| is_active | boolean | NO | true | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| created_by | uuid | YES |  | NEVER |
| disabled_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] feedback_schedule_links_disabled_state: CHECK (((is_active AND (disabled_at IS NULL)) OR ((NOT is_active) AND (disabled_at IS NOT NULL))))
- [CHECK] feedback_schedule_links_public_token_format: CHECK ((public_token ~ '^[A-Za-z0-9_-]{32,128}$'::text))
- [FOREIGN KEY] feedback_schedule_links_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- [FOREIGN KEY] feedback_schedule_links_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE CASCADE
- [PRIMARY KEY] feedback_schedule_links_pkey: PRIMARY KEY (id)
- [UNIQUE] feedback_schedule_links_public_token_unique: UNIQUE (public_token)
- [UNIQUE] feedback_schedule_links_schedule_unique: UNIQUE (schedule_id)

Indexes:
- feedback_schedule_links_pkey (unique=True): `CREATE UNIQUE INDEX feedback_schedule_links_pkey ON public.feedback_schedule_links USING btree (id)`
- feedback_schedule_links_public_token_unique (unique=True): `CREATE UNIQUE INDEX feedback_schedule_links_public_token_unique ON public.feedback_schedule_links USING btree (public_token)`
- feedback_schedule_links_schedule_unique (unique=True): `CREATE UNIQUE INDEX feedback_schedule_links_schedule_unique ON public.feedback_schedule_links USING btree (schedule_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.feedback_schedule_lookup_attempts

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| schedule_link_id | uuid | NO |  | NEVER |
| request_fingerprint_hash | text | NO |  | NEVER |
| window_started_at | timestamp with time zone | NO |  | NEVER |
| attempt_count | integer | NO | 1 | NEVER |
| last_attempt_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] feedback_schedule_lookup_attempts_attempt_count_check: CHECK (((attempt_count >= 1) AND (attempt_count <= 5)))
- [CHECK] feedback_schedule_lookup_attempts_fingerprint_format: CHECK ((request_fingerprint_hash ~ '^[0-9a-f]{64}$'::text))
- [FOREIGN KEY] feedback_schedule_lookup_attempts_schedule_link_id_fkey: FOREIGN KEY (schedule_link_id) REFERENCES feedback_schedule_links(id) ON DELETE CASCADE
- [PRIMARY KEY] feedback_schedule_lookup_attempts_pkey: PRIMARY KEY (schedule_link_id, request_fingerprint_hash, window_started_at)

Indexes:
- feedback_schedule_lookup_attempts_pkey (unique=True): `CREATE UNIQUE INDEX feedback_schedule_lookup_attempts_pkey ON public.feedback_schedule_lookup_attempts USING btree (schedule_link_id, request_fingerprint_hash, window_started_at)`
- feedback_schedule_lookup_attempts_retention_idx (unique=False): `CREATE INDEX feedback_schedule_lookup_attempts_retention_idx ON public.feedback_schedule_lookup_attempts USING btree (last_attempt_at)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.gallery_categories

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| slug | text | NO |  | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [PRIMARY KEY] gallery_categories_pkey: PRIMARY KEY (id)
- [UNIQUE] gallery_categories_slug_key: UNIQUE (slug)

Indexes:
- gallery_categories_pkey (unique=True): `CREATE UNIQUE INDEX gallery_categories_pkey ON public.gallery_categories USING btree (id)`
- gallery_categories_slug_key (unique=True): `CREATE UNIQUE INDEX gallery_categories_slug_key ON public.gallery_categories USING btree (slug)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.gallery_images

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| title | text | YES |  | NEVER |
| alt_text | text | NO | ''::text | NEVER |
| media_id | uuid | YES |  | NEVER |
| image_url | text | NO |  | NEVER |
| category_id | uuid | YES |  | NEVER |
| featured | boolean | NO | false | NEVER |
| status | USER-DEFINED | NO | 'published'::content_status | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] gallery_images_category_id_fkey: FOREIGN KEY (category_id) REFERENCES gallery_categories(id) ON DELETE SET NULL
- [FOREIGN KEY] gallery_images_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] gallery_images_media_id_fkey: FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
- [FOREIGN KEY] gallery_images_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] gallery_images_pkey: PRIMARY KEY (id)

Indexes:
- gallery_images_pkey (unique=True): `CREATE UNIQUE INDEX gallery_images_pkey ON public.gallery_images USING btree (id)`
- idx_gallery_live (unique=False): `CREATE INDEX idx_gallery_live ON public.gallery_images USING btree (sort_order) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.media

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| folder_id | uuid | YES |  | NEVER |
| kind | USER-DEFINED | NO | 'image'::media_kind | NEVER |
| bucket | text | NO | 'media'::text | NEVER |
| storage_path | text | NO |  | NEVER |
| public_url | text | YES |  | NEVER |
| file_name | text | NO |  | NEVER |
| mime_type | text | YES |  | NEVER |
| file_size | bigint | YES |  | NEVER |
| width | integer | YES |  | NEVER |
| height | integer | YES |  | NEVER |
| alt_text | text | YES |  | NEVER |
| title | text | YES |  | NEVER |
| status | USER-DEFINED | NO | 'published'::content_status | NEVER |
| created_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] media_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] media_folder_id_fkey: FOREIGN KEY (folder_id) REFERENCES media_folders(id) ON DELETE SET NULL
- [PRIMARY KEY] media_pkey: PRIMARY KEY (id)
- [UNIQUE] media_bucket_storage_path_key: UNIQUE (bucket, storage_path)

Indexes:
- idx_media_live (unique=False): `CREATE INDEX idx_media_live ON public.media USING btree (created_at DESC) WHERE (deleted_at IS NULL)`
- media_bucket_storage_path_key (unique=True): `CREATE UNIQUE INDEX media_bucket_storage_path_key ON public.media USING btree (bucket, storage_path)`
- media_pkey (unique=True): `CREATE UNIQUE INDEX media_pkey ON public.media USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.media_folders

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| parent_id | uuid | YES |  | NEVER |
| path | text | NO | '/'::text | NEVER |
| created_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] media_folders_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] media_folders_parent_id_fkey: FOREIGN KEY (parent_id) REFERENCES media_folders(id) ON DELETE CASCADE
- [PRIMARY KEY] media_folders_pkey: PRIMARY KEY (id)
- [UNIQUE] media_folders_parent_id_name_key: UNIQUE (parent_id, name)

Indexes:
- media_folders_parent_id_name_key (unique=True): `CREATE UNIQUE INDEX media_folders_parent_id_name_key ON public.media_folders USING btree (parent_id, name)`
- media_folders_pkey (unique=True): `CREATE UNIQUE INDEX media_folders_pkey ON public.media_folders USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.news_categories

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| slug | text | NO |  | NEVER |
| sort_order | integer | NO | 0 | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [PRIMARY KEY] news_categories_pkey: PRIMARY KEY (id)
- [UNIQUE] news_categories_slug_key: UNIQUE (slug)

Indexes:
- news_categories_pkey (unique=True): `CREATE UNIQUE INDEX news_categories_pkey ON public.news_categories USING btree (id)`
- news_categories_slug_key (unique=True): `CREATE UNIQUE INDEX news_categories_slug_key ON public.news_categories USING btree (slug)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.news_posts

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| title | text | NO |  | NEVER |
| slug | text | NO |  | NEVER |
| excerpt | text | YES |  | NEVER |
| body | text | YES |  | NEVER |
| category_id | uuid | YES |  | NEVER |
| featured_image_url | text | YES |  | NEVER |
| featured | boolean | NO | false | NEVER |
| status | USER-DEFINED | NO | 'draft'::content_status | NEVER |
| scheduled_for | timestamp with time zone | YES |  | NEVER |
| published_at | timestamp with time zone | YES |  | NEVER |
| seo_title | text | YES |  | NEVER |
| seo_description | text | YES |  | NEVER |
| author_id | uuid | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [FOREIGN KEY] news_posts_author_id_fkey: FOREIGN KEY (author_id) REFERENCES profiles(id)
- [FOREIGN KEY] news_posts_category_id_fkey: FOREIGN KEY (category_id) REFERENCES news_categories(id) ON DELETE SET NULL
- [FOREIGN KEY] news_posts_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] news_posts_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] news_posts_pkey: PRIMARY KEY (id)
- [UNIQUE] news_posts_slug_key: UNIQUE (slug)

Indexes:
- idx_news_live (unique=False): `CREATE INDEX idx_news_live ON public.news_posts USING btree (updated_at DESC) WHERE (deleted_at IS NULL)`
- news_posts_pkey (unique=True): `CREATE UNIQUE INDEX news_posts_pkey ON public.news_posts USING btree (id)`
- news_posts_slug_key (unique=True): `CREATE UNIQUE INDEX news_posts_slug_key ON public.news_posts USING btree (slug)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.participant_feedback

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | NO |  | NEVER |
| participant_id | uuid | NO |  | NEVER |
| token | text | NO |  | NEVER |
| status | text | NO | 'pending'::text | NEVER |
| q1_score | smallint | YES |  | NEVER |
| q2_score | smallint | YES |  | NEVER |
| q3_score | smallint | YES |  | NEVER |
| q4_score | smallint | YES |  | NEVER |
| q5_score | smallint | YES |  | NEVER |
| q6_score | smallint | YES |  | NEVER |
| q7_score | smallint | YES |  | NEVER |
| q8_score | smallint | YES |  | NEVER |
| q9_score | smallint | YES |  | NEVER |
| q10_score | smallint | YES |  | NEVER |
| nps | smallint | YES |  | NEVER |
| liked_most | text | YES |  | NEVER |
| improve | text | YES |  | NEVER |
| had_problem | boolean | NO | false | NEVER |
| problem_category | text | YES |  | NEVER |
| problem_description | text | YES |  | NEVER |
| submitted_at | timestamp with time zone | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] participant_feedback_improve_check: CHECK ((char_length(improve) <= 2000))
- [CHECK] participant_feedback_liked_most_check: CHECK ((char_length(liked_most) <= 2000))
- [CHECK] participant_feedback_nps_check: CHECK (((nps >= 0) AND (nps <= 10)))
- [CHECK] participant_feedback_problem_category_check: CHECK (((problem_category = ANY (ARRAY['registration'::text, 'trainer'::text, 'training_material'::text, 'practical_equipment'::text, 'venue'::text, 'food_refreshment'::text, 'schedule'::text, 'assessment_examination'::text, 'certificate'::text, 'staff_service'::text, 'others'::text])) OR (problem_category IS NULL)))
- [CHECK] participant_feedback_problem_description_check: CHECK ((char_length(problem_description) <= 2000))
- [CHECK] participant_feedback_q10_score_check: CHECK (((q10_score >= 1) AND (q10_score <= 5)))
- [CHECK] participant_feedback_q1_score_check: CHECK (((q1_score >= 1) AND (q1_score <= 5)))
- [CHECK] participant_feedback_q2_score_check: CHECK (((q2_score >= 1) AND (q2_score <= 5)))
- [CHECK] participant_feedback_q3_score_check: CHECK (((q3_score >= 1) AND (q3_score <= 5)))
- [CHECK] participant_feedback_q4_score_check: CHECK (((q4_score >= 1) AND (q4_score <= 5)))
- [CHECK] participant_feedback_q5_score_check: CHECK (((q5_score >= 1) AND (q5_score <= 5)))
- [CHECK] participant_feedback_q6_score_check: CHECK (((q6_score >= 1) AND (q6_score <= 5)))
- [CHECK] participant_feedback_q7_score_check: CHECK (((q7_score >= 1) AND (q7_score <= 5)))
- [CHECK] participant_feedback_q8_score_check: CHECK (((q8_score >= 1) AND (q8_score <= 5)))
- [CHECK] participant_feedback_q9_score_check: CHECK (((q9_score >= 1) AND (q9_score <= 5)))
- [CHECK] participant_feedback_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text])))
- [FOREIGN KEY] participant_feedback_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
- [FOREIGN KEY] participant_feedback_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE CASCADE
- [PRIMARY KEY] participant_feedback_pkey: PRIMARY KEY (id)
- [UNIQUE] participant_feedback_one_per_enrollment: UNIQUE (schedule_id, participant_id)

Indexes:
- participant_feedback_one_per_enrollment (unique=True): `CREATE UNIQUE INDEX participant_feedback_one_per_enrollment ON public.participant_feedback USING btree (schedule_id, participant_id)`
- participant_feedback_participant_idx (unique=False): `CREATE INDEX participant_feedback_participant_idx ON public.participant_feedback USING btree (participant_id)`
- participant_feedback_pkey (unique=True): `CREATE UNIQUE INDEX participant_feedback_pkey ON public.participant_feedback USING btree (id)`
- participant_feedback_schedule_idx (unique=False): `CREATE INDEX participant_feedback_schedule_idx ON public.participant_feedback USING btree (schedule_id)`
- participant_feedback_status_idx (unique=False): `CREATE INDEX participant_feedback_status_idx ON public.participant_feedback USING btree (status)`
- participant_feedback_submitted_idx (unique=False): `CREATE INDEX participant_feedback_submitted_idx ON public.participant_feedback USING btree (submitted_at) WHERE (submitted_at IS NOT NULL)`
- participant_feedback_token_unique (unique=True): `CREATE UNIQUE INDEX participant_feedback_token_unique ON public.participant_feedback USING btree (token)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->SELECT; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.participant_skill_results

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | NO |  | NEVER |
| participant_id | uuid | NO |  | NEVER |
| area | text | NO |  | NEVER |
| status | text | NO | 'not_recorded'::text | NEVER |
| score | numeric | YES |  | NEVER |
| notes | text | YES |  | NEVER |
| assessed_by | uuid | YES |  | NEVER |
| assessed_at | timestamp with time zone | YES |  | NEVER |
| locked | boolean | NO | false | NEVER |
| locked_at | timestamp with time zone | YES |  | NEVER |
| locked_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] participant_skill_results_area_check: CHECK ((area = ANY (ARRAY['theory_session'::text, 'practical_training'::text, 'safety_awareness'::text, 'practical_assessment'::text])))
- [CHECK] participant_skill_results_status_check: CHECK ((status = ANY (ARRAY['not_recorded'::text, 'completed'::text, 'passed'::text, 'failed'::text])))
- [FOREIGN KEY] participant_skill_results_assessed_by_fkey: FOREIGN KEY (assessed_by) REFERENCES profiles(id)
- [FOREIGN KEY] participant_skill_results_locked_by_fkey: FOREIGN KEY (locked_by) REFERENCES profiles(id)
- [FOREIGN KEY] participant_skill_results_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
- [FOREIGN KEY] participant_skill_results_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE CASCADE
- [PRIMARY KEY] participant_skill_results_pkey: PRIMARY KEY (id)
- [UNIQUE] participant_skill_results_schedule_participant_area_key: UNIQUE (schedule_id, participant_id, area)

Indexes:
- participant_skill_results_pkey (unique=True): `CREATE UNIQUE INDEX participant_skill_results_pkey ON public.participant_skill_results USING btree (id)`
- participant_skill_results_schedule_participant_area_key (unique=True): `CREATE UNIQUE INDEX participant_skill_results_schedule_participant_area_key ON public.participant_skill_results USING btree (schedule_id, participant_id, area)`
- participant_skill_results_schedule_participant_idx (unique=False): `CREATE INDEX participant_skill_results_schedule_participant_idx ON public.participant_skill_results USING btree (schedule_id, participant_id) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.participants

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| participant_code | text | NO | ('TRS-P-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8))) | NEVER |
| full_name | text | NO |  | NEVER |
| identity_no | text | YES |  | NEVER |
| identity_last4 | text | YES |  | NEVER |
| email | text | YES |  | NEVER |
| phone | text | YES |  | NEVER |
| organization | text | YES |  | NEVER |
| position | text | YES |  | NEVER |
| address | text | YES |  | NEVER |
| notes | text | YES |  | NEVER |
| status | text | NO | 'active'::text | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| schedule_id | uuid | YES |  | NEVER |
| company | text | YES |  | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| updated_by | uuid | YES |  | NEVER |
| participant_id | text | YES |  | NEVER |
| ic_passport_no | text | YES |  | NEVER |
| nationality | text | YES | 'Malaysian'::text | NEVER |
| gender | text | YES |  | NEVER |
| date_of_birth | date | YES |  | NEVER |
| registration_date | date | YES | CURRENT_DATE | NEVER |
| emergency_contact_name | text | YES |  | NEVER |
| emergency_contact_phone | text | YES |  | NEVER |
| company_id | uuid | YES |  | NEVER |

Constraints:
- [CHECK] participants_status_check: CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'registered'::text, 'confirmed'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text])))
- [FOREIGN KEY] participants_company_id_fkey: FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
- [FOREIGN KEY] participants_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] participants_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL
- [FOREIGN KEY] participants_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES profiles(id)
- [PRIMARY KEY] participants_pkey: PRIMARY KEY (id)
- [UNIQUE] participants_participant_code_key: UNIQUE (participant_code)

Indexes:
- idx_participants_company_id (unique=False): `CREATE INDEX idx_participants_company_id ON public.participants USING btree (company_id) WHERE (deleted_at IS NULL)`
- participants_active_email_unique (unique=True): `CREATE UNIQUE INDEX participants_active_email_unique ON public.participants USING btree (lower(email)) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL) AND (btrim(email) <> ''::text))`
- participants_active_ic_passport_unique (unique=True): `CREATE UNIQUE INDEX participants_active_ic_passport_unique ON public.participants USING btree (upper(regexp_replace(ic_passport_no, '[^0-9A-Za-z]'::text, ''::text, 'g'::text))) WHERE ((deleted_at IS NULL) AND (ic_passport_no IS NOT NULL) AND (btrim(ic_passport_no) <> ''::text))`
- participants_active_identity_unique (unique=True): `CREATE UNIQUE INDEX participants_active_identity_unique ON public.participants USING btree (regexp_replace(identity_no, '[^0-9A-Za-z]'::text, ''::text, 'g'::text)) WHERE ((deleted_at IS NULL) AND (identity_no IS NOT NULL) AND (btrim(identity_no) <> ''::text))`
- participants_full_name_idx (unique=False): `CREATE INDEX participants_full_name_idx ON public.participants USING btree (lower(full_name))`
- participants_identity_last4_idx (unique=False): `CREATE INDEX participants_identity_last4_idx ON public.participants USING btree (identity_last4)`
- participants_organization_idx (unique=False): `CREATE INDEX participants_organization_idx ON public.participants USING btree (organization)`
- participants_participant_code_key (unique=True): `CREATE UNIQUE INDEX participants_participant_code_key ON public.participants USING btree (participant_code)`
- participants_pkey (unique=True): `CREATE UNIQUE INDEX participants_pkey ON public.participants USING btree (id)`
- participants_schedule_idx (unique=False): `CREATE INDEX participants_schedule_idx ON public.participants USING btree (schedule_id) WHERE (deleted_at IS NULL)`
- uq_participants_participant_id (unique=True): `CREATE UNIQUE INDEX uq_participants_participant_id ON public.participants USING btree (participant_id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_activity_log

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| photo_id | uuid | YES |  | NEVER |
| action | text | NO |  | NEVER |
| actor_name | text | YES |  | NEVER |
| actor_telegram_id | bigint | YES |  | NEVER |
| metadata | jsonb | NO | '{}'::jsonb | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] photo_activity_log_action_check: CHECK ((action = ANY (ARRAY['upload'::text, 'approve'::text, 'reject'::text, 'event_change'::text, 'category_change'::text, 'usage_add'::text, 'usage_remove'::text, 'best_photo_on'::text, 'best_photo_off'::text, 'notes_change'::text])))
- [FOREIGN KEY] photo_activity_log_photo_id_fkey: FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE SET NULL
- [PRIMARY KEY] photo_activity_log_pkey: PRIMARY KEY (id)

Indexes:
- photo_activity_log_photo_id_idx (unique=False): `CREATE INDEX photo_activity_log_photo_id_idx ON public.photo_activity_log USING btree (photo_id)`
- photo_activity_log_pkey (unique=True): `CREATE UNIQUE INDEX photo_activity_log_pkey ON public.photo_activity_log USING btree (id)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_ai_analysis

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| photo_id | uuid | NO |  | NEVER |
| provider | text | NO |  | NEVER |
| model | text | NO |  | NEVER |
| analysis_version | text | NO |  | NEVER |
| overall_score | numeric | NO |  | NEVER |
| sharpness_score | numeric | NO |  | NEVER |
| composition_score | numeric | NO |  | NEVER |
| subject_clarity_score | numeric | NO |  | NEVER |
| training_relevance_score | numeric | NO |  | NEVER |
| professionalism_score | numeric | NO |  | NEVER |
| story_impact_score | numeric | NO |  | NEVER |
| visual_engagement_score | numeric | NO |  | NEVER |
| ppe_score | numeric | YES |  | NEVER |
| recommended_best_photo | boolean | NO | false | NEVER |
| recommended_usages | jsonb | NO | '[]'::jsonb | NEVER |
| quality_flags | jsonb | NO | '[]'::jsonb | NEVER |
| short_reason | text | NO | ''::text | NEVER |
| latency_ms | integer | YES |  | NEVER |
| input_size_bytes | bigint | YES |  | NEVER |
| provider_request_id | text | YES |  | NEVER |
| provider_metadata | jsonb | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] photo_ai_analysis_composition_score_check: CHECK (((composition_score >= (0)::numeric) AND (composition_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_overall_score_check: CHECK (((overall_score >= (0)::numeric) AND (overall_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_ppe_score_check: CHECK (((ppe_score IS NULL) OR ((ppe_score >= (0)::numeric) AND (ppe_score <= (100)::numeric))))
- [CHECK] photo_ai_analysis_professionalism_score_check: CHECK (((professionalism_score >= (0)::numeric) AND (professionalism_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_provider_metadata_check: CHECK (((provider_metadata IS NULL) OR (jsonb_typeof(provider_metadata) = 'object'::text)))
- [CHECK] photo_ai_analysis_quality_flags_check: CHECK ((jsonb_typeof(quality_flags) = 'array'::text))
- [CHECK] photo_ai_analysis_recommended_usages_check: CHECK ((jsonb_typeof(recommended_usages) = 'array'::text))
- [CHECK] photo_ai_analysis_sharpness_score_check: CHECK (((sharpness_score >= (0)::numeric) AND (sharpness_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_story_impact_score_check: CHECK (((story_impact_score >= (0)::numeric) AND (story_impact_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_subject_clarity_score_check: CHECK (((subject_clarity_score >= (0)::numeric) AND (subject_clarity_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_training_relevance_score_check: CHECK (((training_relevance_score >= (0)::numeric) AND (training_relevance_score <= (100)::numeric)))
- [CHECK] photo_ai_analysis_visual_engagement_score_check: CHECK (((visual_engagement_score >= (0)::numeric) AND (visual_engagement_score <= (100)::numeric)))
- [FOREIGN KEY] photo_ai_analysis_photo_id_fkey: FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
- [PRIMARY KEY] photo_ai_analysis_pkey: PRIMARY KEY (id)
- [UNIQUE] photo_ai_analysis_identity_unique: UNIQUE (photo_id, provider, model, analysis_version)

Indexes:
- photo_ai_analysis_identity_unique (unique=True): `CREATE UNIQUE INDEX photo_ai_analysis_identity_unique ON public.photo_ai_analysis USING btree (photo_id, provider, model, analysis_version)`
- photo_ai_analysis_photo_created_idx (unique=False): `CREATE INDEX photo_ai_analysis_photo_created_idx ON public.photo_ai_analysis USING btree (photo_id, created_at DESC)`
- photo_ai_analysis_pkey (unique=True): `CREATE UNIQUE INDEX photo_ai_analysis_pkey ON public.photo_ai_analysis USING btree (id)`
- photo_ai_analysis_rank_idx (unique=False): `CREATE INDEX photo_ai_analysis_rank_idx ON public.photo_ai_analysis USING btree (provider, model, analysis_version, overall_score DESC)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_categories

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| key | text | NO |  | NEVER |
| label | text | NO |  | NEVER |
| sort_order | integer | NO | 0 | NEVER |

Constraints:
- [PRIMARY KEY] photo_categories_pkey: PRIMARY KEY (key)

Indexes:
- photo_categories_pkey (unique=True): `CREATE UNIQUE INDEX photo_categories_pkey ON public.photo_categories USING btree (key)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_events

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| name | text | NO |  | NEVER |
| slug | text | NO |  | NEVER |
| event_date | date | YES |  | NEVER |
| location | text | YES |  | NEVER |
| status | text | NO | 'active'::text | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] photo_events_status_check: CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])))
- [PRIMARY KEY] photo_events_pkey: PRIMARY KEY (id)
- [UNIQUE] photo_events_slug_unique: UNIQUE (slug)

Indexes:
- photo_events_pkey (unique=True): `CREATE UNIQUE INDEX photo_events_pkey ON public.photo_events USING btree (id)`
- photo_events_slug_unique (unique=True): `CREATE UNIQUE INDEX photo_events_slug_unique ON public.photo_events USING btree (slug)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_id_sequences

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| seq_date | date | NO |  | NEVER |
| last_value | bigint | NO | 0 | NEVER |

Constraints:
- [PRIMARY KEY] photo_id_sequences_pkey: PRIMARY KEY (seq_date)

Indexes:
- photo_id_sequences_pkey (unique=True): `CREATE UNIQUE INDEX photo_id_sequences_pkey ON public.photo_id_sequences USING btree (seq_date)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_usage_types

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| key | text | NO |  | NEVER |
| label | text | NO |  | NEVER |
| sort_order | integer | NO | 0 | NEVER |

Constraints:
- [PRIMARY KEY] photo_usage_types_pkey: PRIMARY KEY (key)

Indexes:
- photo_usage_types_pkey (unique=True): `CREATE UNIQUE INDEX photo_usage_types_pkey ON public.photo_usage_types USING btree (key)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photo_usages

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| photo_id | uuid | NO |  | NEVER |
| usage_type | text | NO |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] photo_usages_photo_id_fkey: FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
- [FOREIGN KEY] photo_usages_usage_type_fkey: FOREIGN KEY (usage_type) REFERENCES photo_usage_types(key) ON DELETE RESTRICT
- [PRIMARY KEY] photo_usages_pkey: PRIMARY KEY (id)
- [UNIQUE] photo_usages_photo_usage_unique: UNIQUE (photo_id, usage_type)

Indexes:
- photo_usages_photo_usage_unique (unique=True): `CREATE UNIQUE INDEX photo_usages_photo_usage_unique ON public.photo_usages USING btree (photo_id, usage_type)`
- photo_usages_pkey (unique=True): `CREATE UNIQUE INDEX photo_usages_pkey ON public.photo_usages USING btree (id)`
- photo_usages_usage_type_idx (unique=False): `CREATE INDEX photo_usages_usage_type_idx ON public.photo_usages USING btree (usage_type)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.photos

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| media_id | uuid | NO |  | NEVER |
| photo_id | text | NO |  | NEVER |
| telegram_file_id | text | YES |  | NEVER |
| telegram_file_unique_id | text | YES |  | NEVER |
| event_id | uuid | YES |  | NEVER |
| category | text | YES |  | NEVER |
| status | text | NO | 'pending'::text | NEVER |
| is_best_photo | boolean | NO | false | NEVER |
| uploaded_by | text | YES |  | NEVER |
| uploaded_by_telegram_id | bigint | YES |  | NEVER |
| uploaded_at | timestamp with time zone | NO | now() | NEVER |
| reviewed_by | text | YES |  | NEVER |
| reviewed_at | timestamp with time zone | YES |  | NEVER |
| notes | text | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] photos_best_photo_requires_approved_check: CHECK (((NOT is_best_photo) OR (status = 'approved'::text)))
- [CHECK] photos_photo_id_format_check: CHECK ((photo_id ~ '^TERAS-PH-[0-9]{8}-[0-9]{4}$'::text))
- [CHECK] photos_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
- [FOREIGN KEY] photos_category_fk: FOREIGN KEY (category) REFERENCES photo_categories(key) ON DELETE RESTRICT
- [FOREIGN KEY] photos_event_id_fk: FOREIGN KEY (event_id) REFERENCES photo_events(id) ON DELETE SET NULL
- [FOREIGN KEY] photos_media_id_fk: FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT
- [PRIMARY KEY] photos_pkey: PRIMARY KEY (id)
- [UNIQUE] photos_media_id_unique: UNIQUE (media_id)
- [UNIQUE] photos_photo_id_unique: UNIQUE (photo_id)
- [UNIQUE] photos_telegram_file_unique_id_unique: UNIQUE (telegram_file_unique_id)

Indexes:
- photos_category_idx (unique=False): `CREATE INDEX photos_category_idx ON public.photos USING btree (category)`
- photos_event_id_idx (unique=False): `CREATE INDEX photos_event_id_idx ON public.photos USING btree (event_id)`
- photos_is_best_photo_idx (unique=False): `CREATE INDEX photos_is_best_photo_idx ON public.photos USING btree (is_best_photo) WHERE is_best_photo`
- photos_media_id_unique (unique=True): `CREATE UNIQUE INDEX photos_media_id_unique ON public.photos USING btree (media_id)`
- photos_photo_id_unique (unique=True): `CREATE UNIQUE INDEX photos_photo_id_unique ON public.photos USING btree (photo_id)`
- photos_pkey (unique=True): `CREATE UNIQUE INDEX photos_pkey ON public.photos USING btree (id)`
- photos_status_uploaded_at_idx (unique=False): `CREATE INDEX photos_status_uploaded_at_idx ON public.photos USING btree (status, uploaded_at)`
- photos_telegram_file_unique_id_unique (unique=True): `CREATE UNIQUE INDEX photos_telegram_file_unique_id_unique ON public.photos USING btree (telegram_file_unique_id)`

RLS enabled: True; RLS forced: True; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.profiles

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO |  | NEVER |
| email | USER-DEFINED | NO |  | NEVER |
| full_name | text | YES |  | NEVER |
| phone | text | YES |  | NEVER |
| avatar_url | text | YES |  | NEVER |
| job_title | text | YES |  | NEVER |
| role | USER-DEFINED | NO | 'editor'::user_role | NEVER |
| is_active | boolean | NO | true | NEVER |
| last_login_at | timestamp with time zone | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [FOREIGN KEY] profiles_id_fkey: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
- [PRIMARY KEY] profiles_pkey: PRIMARY KEY (id)
- [UNIQUE] profiles_email_key: UNIQUE (email)

Indexes:
- profiles_email_key (unique=True): `CREATE UNIQUE INDEX profiles_email_key ON public.profiles USING btree (email)`
- profiles_pkey (unique=True): `CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: anon->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.proposal_requests

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| company_name | text | NO |  | NEVER |
| contact_person | text | NO |  | NEVER |
| job_title | text | YES |  | NEVER |
| email | text | NO |  | NEVER |
| phone | text | NO |  | NEVER |
| industry | text | NO |  | NEVER |
| category | text | NO |  | NEVER |
| programme | text | YES |  | NEVER |
| participants | integer | YES |  | NEVER |
| location | text | YES |  | NEVER |
| preferred_month | text | YES |  | NEVER |
| budget | text | YES |  | NEVER |
| objectives | text | NO |  | NEVER |
| notes | text | YES |  | NEVER |
| status | text | NO | 'new'::text | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| email_sent | boolean | NO | false | NEVER |
| sheets_synced | boolean | NO | false | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] proposal_requests_budget_check: CHECK (((budget IS NULL) OR (char_length(budget) <= 80)))
- [CHECK] proposal_requests_category_check: CHECK ((category = ANY (ARRAY['Industrial Safety'::text, 'Technical Competency'::text, 'Industrial Consultancy'::text, 'Workforce Development'::text])))
- [CHECK] proposal_requests_company_name_check: CHECK (((char_length(company_name) >= 1) AND (char_length(company_name) <= 160)))
- [CHECK] proposal_requests_contact_person_check: CHECK (((char_length(contact_person) >= 1) AND (char_length(contact_person) <= 120)))
- [CHECK] proposal_requests_email_check: CHECK (((char_length(email) >= 3) AND (char_length(email) <= 254)))
- [CHECK] proposal_requests_industry_check: CHECK ((industry = ANY (ARRAY['Oil & Gas'::text, 'Petrochemical'::text, 'Construction'::text, 'Manufacturing'::text, 'Marine & Offshore'::text, 'Power & Utilities'::text, 'Government & GLC'::text, 'Others'::text])))
- [CHECK] proposal_requests_job_title_check: CHECK (((job_title IS NULL) OR (char_length(job_title) <= 120)))
- [CHECK] proposal_requests_location_check: CHECK (((location IS NULL) OR (char_length(location) <= 160)))
- [CHECK] proposal_requests_notes_check: CHECK (((notes IS NULL) OR (char_length(notes) <= 3000)))
- [CHECK] proposal_requests_objectives_check: CHECK (((char_length(objectives) >= 1) AND (char_length(objectives) <= 3000)))
- [CHECK] proposal_requests_participants_check: CHECK (((participants IS NULL) OR ((participants >= 1) AND (participants <= 1000000))))
- [CHECK] proposal_requests_phone_check: CHECK (((char_length(phone) >= 1) AND (char_length(phone) <= 40)))
- [CHECK] proposal_requests_preferred_month_check: CHECK (((preferred_month IS NULL) OR (char_length(preferred_month) <= 7)))
- [CHECK] proposal_requests_programme_check: CHECK (((programme IS NULL) OR (char_length(programme) <= 160)))
- [CHECK] proposal_requests_status_check: CHECK ((status = ANY (ARRAY['new'::text, 'in_review'::text, 'assigned'::text, 'quoted'::text, 'won'::text, 'lost'::text, 'archived'::text])))
- [FOREIGN KEY] proposal_requests_assigned_to_fkey: FOREIGN KEY (assigned_to) REFERENCES profiles(id)
- [PRIMARY KEY] proposal_requests_pkey: PRIMARY KEY (id)

Indexes:
- proposal_requests_created_at_idx (unique=False): `CREATE INDEX proposal_requests_created_at_idx ON public.proposal_requests USING btree (created_at DESC)`
- proposal_requests_email_created_at_idx (unique=False): `CREATE INDEX proposal_requests_email_created_at_idx ON public.proposal_requests USING btree (email, created_at DESC)`
- proposal_requests_pkey (unique=True): `CREATE UNIQUE INDEX proposal_requests_pkey ON public.proposal_requests USING btree (id)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_activity

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| lead_metadata_id | uuid | NO |  | NEVER |
| type | text | NO |  | NEVER |
| note | text | YES |  | NEVER |
| actor_id | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| opportunity_id | uuid | YES |  | NEVER |
| quotation_id | uuid | YES |  | NEVER |

Constraints:
- [CHECK] sales_activity_note_check: CHECK (((note IS NULL) OR (char_length(note) <= 3000)))
- [CHECK] sales_activity_type_check: CHECK ((type = ANY (ARRAY['lead_created'::text, 'status_changed'::text, 'assigned'::text, 'followup_scheduled'::text, 'note_added'::text, 'proposal_sent'::text, 'won'::text, 'lost'::text, 'opportunity_created'::text, 'quotation_created'::text, 'quotation_sent'::text, 'quotation_revised'::text, 'quotation_accepted'::text, 'quotation_rejected'::text, 'opportunity_won'::text, 'opportunity_lost'::text, 'training_handoff_created'::text, 'company_linked'::text, 'company_created'::text, 'task_created'::text, 'task_completed'::text, 'task_reopened'::text, 'task_cancelled'::text])))
- [FOREIGN KEY] sales_activity_actor_id_fkey: FOREIGN KEY (actor_id) REFERENCES profiles(id)
- [FOREIGN KEY] sales_activity_lead_metadata_id_fkey: FOREIGN KEY (lead_metadata_id) REFERENCES sales_lead_metadata(id) ON DELETE CASCADE
- [FOREIGN KEY] sales_activity_opportunity_id_fkey: FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id)
- [FOREIGN KEY] sales_activity_quotation_id_fkey: FOREIGN KEY (quotation_id) REFERENCES sales_quotations(id)
- [PRIMARY KEY] sales_activity_pkey: PRIMARY KEY (id)

Indexes:
- sales_activity_lead_metadata_id_idx (unique=False): `CREATE INDEX sales_activity_lead_metadata_id_idx ON public.sales_activity USING btree (lead_metadata_id, created_at DESC)`
- sales_activity_opportunity_id_idx (unique=False): `CREATE INDEX sales_activity_opportunity_id_idx ON public.sales_activity USING btree (opportunity_id, created_at DESC)`
- sales_activity_pkey (unique=True): `CREATE UNIQUE INDEX sales_activity_pkey ON public.sales_activity USING btree (id)`
- sales_activity_quotation_id_idx (unique=False): `CREATE INDEX sales_activity_quotation_id_idx ON public.sales_activity USING btree (quotation_id, created_at DESC)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_lead_metadata

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| lead_source | text | NO |  | NEVER |
| source_id | uuid | NO |  | NEVER |
| status | text | NO | 'new'::text | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| follow_up_at | timestamp with time zone | YES |  | NEVER |
| priority | text | NO | 'medium'::text | NEVER |
| lost_reason | text | YES |  | NEVER |
| won_at | timestamp with time zone | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |

Constraints:
- [CHECK] sales_lead_metadata_lead_source_check: CHECK ((lead_source = ANY (ARRAY['enquiry'::text, 'proposal_request'::text])))
- [CHECK] sales_lead_metadata_lost_reason_check: CHECK (((lost_reason IS NULL) OR (lost_reason = ANY (ARRAY['price'::text, 'no_budget'::text, 'no_response'::text, 'timing'::text, 'competitor'::text, 'requirement_changed'::text, 'duplicate'::text, 'other'::text]))))
- [CHECK] sales_lead_metadata_priority_check: CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
- [CHECK] sales_lead_metadata_status_check: CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'proposal_sent'::text, 'negotiation'::text, 'won'::text, 'lost'::text, 'archived'::text])))
- [FOREIGN KEY] sales_lead_metadata_assigned_to_fkey: FOREIGN KEY (assigned_to) REFERENCES profiles(id)
- [PRIMARY KEY] sales_lead_metadata_pkey: PRIMARY KEY (id)
- [UNIQUE] sales_lead_metadata_lead_source_source_id_key: UNIQUE (lead_source, source_id)

Indexes:
- sales_lead_metadata_assigned_to_idx (unique=False): `CREATE INDEX sales_lead_metadata_assigned_to_idx ON public.sales_lead_metadata USING btree (assigned_to)`
- sales_lead_metadata_created_at_idx (unique=False): `CREATE INDEX sales_lead_metadata_created_at_idx ON public.sales_lead_metadata USING btree (created_at DESC)`
- sales_lead_metadata_follow_up_at_idx (unique=False): `CREATE INDEX sales_lead_metadata_follow_up_at_idx ON public.sales_lead_metadata USING btree (follow_up_at)`
- sales_lead_metadata_lead_source_source_id_key (unique=True): `CREATE UNIQUE INDEX sales_lead_metadata_lead_source_source_id_key ON public.sales_lead_metadata USING btree (lead_source, source_id)`
- sales_lead_metadata_pkey (unique=True): `CREATE UNIQUE INDEX sales_lead_metadata_pkey ON public.sales_lead_metadata USING btree (id)`
- sales_lead_metadata_status_idx (unique=False): `CREATE INDEX sales_lead_metadata_status_idx ON public.sales_lead_metadata USING btree (status)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_opportunities

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| lead_metadata_id | uuid | NO |  | NEVER |
| opportunity_no | text | NO | app.next_opportunity_number() | NEVER |
| company_name | text | YES |  | NEVER |
| contact_person | text | YES |  | NEVER |
| contact_email | text | YES |  | NEVER |
| contact_phone | text | YES |  | NEVER |
| title | text | NO |  | NEVER |
| programme | text | YES |  | NEVER |
| stage | text | NO | 'qualified'::text | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| expected_close_date | date | YES |  | NEVER |
| probability | integer | YES |  | NEVER |
| estimated_value | numeric | YES |  | NEVER |
| lost_reason | text | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| won_at | timestamp with time zone | YES |  | NEVER |
| lost_at | timestamp with time zone | YES |  | NEVER |
| company_id | uuid | YES |  | NEVER |

Constraints:
- [CHECK] sales_opportunities_estimated_value_check: CHECK (((estimated_value IS NULL) OR (estimated_value >= (0)::numeric)))
- [CHECK] sales_opportunities_lost_reason_check: CHECK (((lost_reason IS NULL) OR (lost_reason = ANY (ARRAY['price'::text, 'no_budget'::text, 'no_response'::text, 'timing'::text, 'competitor'::text, 'requirement_changed'::text, 'duplicate'::text, 'other'::text]))))
- [CHECK] sales_opportunities_probability_check: CHECK (((probability IS NULL) OR ((probability >= 0) AND (probability <= 100))))
- [CHECK] sales_opportunities_stage_check: CHECK ((stage = ANY (ARRAY['new'::text, 'qualified'::text, 'quotation'::text, 'negotiation'::text, 'won'::text, 'lost'::text, 'archived'::text])))
- [FOREIGN KEY] sales_opportunities_assigned_to_fkey: FOREIGN KEY (assigned_to) REFERENCES profiles(id)
- [FOREIGN KEY] sales_opportunities_company_id_fkey: FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
- [FOREIGN KEY] sales_opportunities_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] sales_opportunities_lead_metadata_id_fkey: FOREIGN KEY (lead_metadata_id) REFERENCES sales_lead_metadata(id)
- [PRIMARY KEY] sales_opportunities_pkey: PRIMARY KEY (id)
- [UNIQUE] sales_opportunities_lead_metadata_id_key: UNIQUE (lead_metadata_id)
- [UNIQUE] sales_opportunities_opportunity_no_key: UNIQUE (opportunity_no)

Indexes:
- sales_opportunities_assigned_to_idx (unique=False): `CREATE INDEX sales_opportunities_assigned_to_idx ON public.sales_opportunities USING btree (assigned_to)`
- sales_opportunities_company_id_idx (unique=False): `CREATE INDEX sales_opportunities_company_id_idx ON public.sales_opportunities USING btree (company_id) WHERE (company_id IS NOT NULL)`
- sales_opportunities_created_at_idx (unique=False): `CREATE INDEX sales_opportunities_created_at_idx ON public.sales_opportunities USING btree (created_at DESC)`
- sales_opportunities_lead_metadata_id_key (unique=True): `CREATE UNIQUE INDEX sales_opportunities_lead_metadata_id_key ON public.sales_opportunities USING btree (lead_metadata_id)`
- sales_opportunities_opportunity_no_key (unique=True): `CREATE UNIQUE INDEX sales_opportunities_opportunity_no_key ON public.sales_opportunities USING btree (opportunity_no)`
- sales_opportunities_pkey (unique=True): `CREATE UNIQUE INDEX sales_opportunities_pkey ON public.sales_opportunities USING btree (id)`
- sales_opportunities_stage_idx (unique=False): `CREATE INDEX sales_opportunities_stage_idx ON public.sales_opportunities USING btree (stage)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_quotation_items

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| quotation_id | uuid | NO |  | NEVER |
| description | text | NO |  | NEVER |
| quantity | numeric | NO | 1 | NEVER |
| unit | text | NO | 'pax'::text | NEVER |
| unit_price | numeric | NO | 0 | NEVER |
| discount | numeric | NO | 0 | NEVER |
| line_total | numeric | YES |  | ALWAYS |
| sort_order | integer | NO | 0 | NEVER |

Constraints:
- [CHECK] sales_quotation_items_description_check: CHECK (((char_length(description) >= 1) AND (char_length(description) <= 500)))
- [CHECK] sales_quotation_items_discount_check: CHECK ((discount >= (0)::numeric))
- [CHECK] sales_quotation_items_quantity_check: CHECK ((quantity > (0)::numeric))
- [CHECK] sales_quotation_items_unit_check: CHECK ((unit = ANY (ARRAY['pax'::text, 'session'::text, 'day'::text, 'lot'::text, 'unit'::text])))
- [CHECK] sales_quotation_items_unit_price_check: CHECK ((unit_price >= (0)::numeric))
- [FOREIGN KEY] sales_quotation_items_quotation_id_fkey: FOREIGN KEY (quotation_id) REFERENCES sales_quotations(id) ON DELETE CASCADE
- [PRIMARY KEY] sales_quotation_items_pkey: PRIMARY KEY (id)

Indexes:
- sales_quotation_items_pkey (unique=True): `CREATE UNIQUE INDEX sales_quotation_items_pkey ON public.sales_quotation_items USING btree (id)`
- sales_quotation_items_quotation_id_idx (unique=False): `CREATE INDEX sales_quotation_items_quotation_id_idx ON public.sales_quotation_items USING btree (quotation_id, sort_order)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_quotations

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| opportunity_id | uuid | NO |  | NEVER |
| quotation_no | text | NO | app.next_quotation_number() | NEVER |
| revision_no | integer | NO | 0 | NEVER |
| parent_quotation_id | uuid | YES |  | NEVER |
| status | text | NO | 'draft'::text | NEVER |
| issue_date | date | NO | CURRENT_DATE | NEVER |
| valid_until | date | YES |  | NEVER |
| currency | text | NO | 'MYR'::text | NEVER |
| subtotal | numeric | NO | 0 | NEVER |
| discount | numeric | NO | 0 | NEVER |
| sst_applicable | boolean | NO | false | NEVER |
| sst_rate | numeric | NO | 0 | NEVER |
| tax | numeric | NO | 0 | NEVER |
| total | numeric | NO | 0 | NEVER |
| terms | text | YES |  | NEVER |
| notes | text | YES |  | NEVER |
| rejection_reason | text | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| sent_at | timestamp with time zone | YES |  | NEVER |
| accepted_at | timestamp with time zone | YES |  | NEVER |
| rejected_at | timestamp with time zone | YES |  | NEVER |
| superseded_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] sales_quotations_discount_check: CHECK ((discount >= (0)::numeric))
- [CHECK] sales_quotations_status_check: CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text, 'superseded'::text])))
- [FOREIGN KEY] sales_quotations_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id)
- [FOREIGN KEY] sales_quotations_opportunity_id_fkey: FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id)
- [FOREIGN KEY] sales_quotations_parent_quotation_id_fkey: FOREIGN KEY (parent_quotation_id) REFERENCES sales_quotations(id)
- [PRIMARY KEY] sales_quotations_pkey: PRIMARY KEY (id)
- [UNIQUE] sales_quotations_quotation_no_revision_no_key: UNIQUE (quotation_no, revision_no)

Indexes:
- sales_quotations_opportunity_id_idx (unique=False): `CREATE INDEX sales_quotations_opportunity_id_idx ON public.sales_quotations USING btree (opportunity_id)`
- sales_quotations_parent_idx (unique=False): `CREATE INDEX sales_quotations_parent_idx ON public.sales_quotations USING btree (parent_quotation_id)`
- sales_quotations_pkey (unique=True): `CREATE UNIQUE INDEX sales_quotations_pkey ON public.sales_quotations USING btree (id)`
- sales_quotations_quotation_no_revision_no_key (unique=True): `CREATE UNIQUE INDEX sales_quotations_quotation_no_revision_no_key ON public.sales_quotations USING btree (quotation_no, revision_no)`
- sales_quotations_status_idx (unique=False): `CREATE INDEX sales_quotations_status_idx ON public.sales_quotations USING btree (status)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.sales_tasks

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| title | text | NO |  | NEVER |
| description | text | YES |  | NEVER |
| status | text | NO | 'open'::text | NEVER |
| priority | text | NO | 'medium'::text | NEVER |
| due_at | timestamp with time zone | YES |  | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| lead_metadata_id | uuid | YES |  | NEVER |
| opportunity_id | uuid | YES |  | NEVER |
| quotation_id | uuid | YES |  | NEVER |
| created_by | uuid | YES |  | NEVER |
| completed_at | timestamp with time zone | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] sales_tasks_priority_check: CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
- [CHECK] sales_tasks_status_check: CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
- [FOREIGN KEY] sales_tasks_assigned_to_fkey: FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL
- [FOREIGN KEY] sales_tasks_created_by_fkey: FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- [FOREIGN KEY] sales_tasks_lead_metadata_id_fkey: FOREIGN KEY (lead_metadata_id) REFERENCES sales_lead_metadata(id) ON DELETE SET NULL
- [FOREIGN KEY] sales_tasks_opportunity_id_fkey: FOREIGN KEY (opportunity_id) REFERENCES sales_opportunities(id) ON DELETE SET NULL
- [FOREIGN KEY] sales_tasks_quotation_id_fkey: FOREIGN KEY (quotation_id) REFERENCES sales_quotations(id) ON DELETE SET NULL
- [PRIMARY KEY] sales_tasks_pkey: PRIMARY KEY (id)

Indexes:
- sales_tasks_assigned_to_idx (unique=False): `CREATE INDEX sales_tasks_assigned_to_idx ON public.sales_tasks USING btree (assigned_to) WHERE (deleted_at IS NULL)`
- sales_tasks_due_at_idx (unique=False): `CREATE INDEX sales_tasks_due_at_idx ON public.sales_tasks USING btree (due_at) WHERE (deleted_at IS NULL)`
- sales_tasks_lead_metadata_id_idx (unique=False): `CREATE INDEX sales_tasks_lead_metadata_id_idx ON public.sales_tasks USING btree (lead_metadata_id) WHERE (lead_metadata_id IS NOT NULL)`
- sales_tasks_opportunity_id_idx (unique=False): `CREATE INDEX sales_tasks_opportunity_id_idx ON public.sales_tasks USING btree (opportunity_id) WHERE (opportunity_id IS NOT NULL)`
- sales_tasks_pkey (unique=True): `CREATE UNIQUE INDEX sales_tasks_pkey ON public.sales_tasks USING btree (id)`
- sales_tasks_quotation_id_idx (unique=False): `CREATE INDEX sales_tasks_quotation_id_idx ON public.sales_tasks USING btree (quotation_id) WHERE (quotation_id IS NOT NULL)`
- sales_tasks_status_idx (unique=False): `CREATE INDEX sales_tasks_status_idx ON public.sales_tasks USING btree (status) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->INSERT,SELECT,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.schedule_participants

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | NEVER |
| schedule_id | uuid | NO |  | NEVER |
| participant_id | uuid | NO |  | NEVER |
| registration_status | text | NO | 'registered'::text | NEVER |
| enrolled_at | timestamp with time zone | NO | now() | NEVER |
| notes | text | YES |  | NEVER |
| created_at | timestamp with time zone | NO | now() | NEVER |
| updated_at | timestamp with time zone | NO | now() | NEVER |
| deleted_at | timestamp with time zone | YES |  | NEVER |

Constraints:
- [CHECK] schedule_participants_registration_status_check: CHECK ((registration_status = ANY (ARRAY['registered'::text, 'confirmed'::text, 'cancelled'::text, 'completed'::text])))
- [FOREIGN KEY] schedule_participants_participant_id_fkey: FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
- [FOREIGN KEY] schedule_participants_schedule_id_fkey: FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE CASCADE
- [PRIMARY KEY] schedule_participants_pkey: PRIMARY KEY (id)

Indexes:
- schedule_participants_active_unique (unique=True): `CREATE UNIQUE INDEX schedule_participants_active_unique ON public.schedule_participants USING btree (schedule_id, participant_id) WHERE ((deleted_at IS NULL) AND (registration_status <> 'cancelled'::text))`
- schedule_participants_participant_idx (unique=False): `CREATE INDEX schedule_participants_participant_idx ON public.schedule_participants USING btree (participant_id) WHERE (deleted_at IS NULL)`
- schedule_participants_pkey (unique=True): `CREATE UNIQUE INDEX schedule_participants_pkey ON public.schedule_participants USING btree (id)`
- schedule_participants_schedule_idx (unique=False): `CREATE INDEX schedule_participants_schedule_idx ON public.schedule_participants USING btree (schedule_id) WHERE (deleted_at IS NULL)`

RLS enabled: True; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.v_certificate_eligibility

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| schedule_id | uuid | YES |  | NEVER |
| schedule_code | text | YES |  | NEVER |
| participant_id | uuid | YES |  | NEVER |
| course_id | uuid | YES |  | NEVER |
| course_name | text | YES |  | NEVER |
| course_code | text | YES |  | NEVER |
| holder_name | text | YES |  | NEVER |
| enrollment_status | text | YES |  | NEVER |
| schedule_status | text | YES |  | NEVER |
| schedule_start_date | date | YES |  | NEVER |
| schedule_end_date | date | YES |  | NEVER |
| venue | text | YES |  | NEVER |
| trainer_name | text | YES |  | NEVER |
| calendar_expected_days | integer | YES |  | NEVER |
| attendance_days | bigint | YES |  | NEVER |
| present_days | bigint | YES |  | NEVER |
| late_days | bigint | YES |  | NEVER |
| absent_days | bigint | YES |  | NEVER |
| excused_days | bigint | YES |  | NEVER |
| effective_expected_days | bigint | YES |  | NEVER |
| attended_days | bigint | YES |  | NEVER |
| attendance_percentage | numeric | YES |  | NEVER |
| attendance_min_percent | numeric | YES |  | NEVER |
| attendance_satisfied | boolean | YES |  | NEVER |
| certificate_type | text | YES |  | NEVER |
| assessment_required | boolean | YES |  | NEVER |
| competency_required | boolean | YES |  | NEVER |
| assessment_row_exists | boolean | YES |  | NEVER |
| result | text | YES |  | NEVER |
| competency_status | text | YES |  | NEVER |
| theory_score | numeric | YES |  | NEVER |
| practical_score | numeric | YES |  | NEVER |
| assessment_satisfied | boolean | YES |  | NEVER |
| existing_certificate_id | uuid | YES |  | NEVER |
| existing_certificate_number | text | YES |  | NEVER |
| eligible | boolean | YES |  | NEVER |
| ineligibility_reason | text | YES |  | NEVER |
| certificate_generation_enabled | boolean | YES |  | NEVER |
| certificate_template_id | uuid | YES |  | NEVER |

RLS enabled: False; RLS forced: False; owner: postgres
Grants: authenticated->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

### public.v_sales_lead_inbox

| col | type | null | default | gen/ident |
|---|---|---|---|---|
| lead_metadata_id | uuid | YES |  | NEVER |
| lead_source | text | YES |  | NEVER |
| source_id | uuid | YES |  | NEVER |
| status | text | YES |  | NEVER |
| assigned_to | uuid | YES |  | NEVER |
| follow_up_at | timestamp with time zone | YES |  | NEVER |
| priority | text | YES |  | NEVER |
| lost_reason | text | YES |  | NEVER |
| won_at | timestamp with time zone | YES |  | NEVER |
| created_at | timestamp with time zone | YES |  | NEVER |
| updated_at | timestamp with time zone | YES |  | NEVER |
| contact_name | text | YES |  | NEVER |
| company | text | YES |  | NEVER |
| email | text | YES |  | NEVER |
| phone | text | YES |  | NEVER |
| subject | text | YES |  | NEVER |

RLS enabled: False; RLS forced: False; owner: postgres
Grants: authenticated->SELECT; postgres->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE; service_role->DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

## Views

### public.v_certificate_eligibility
reloptions: ['security_invoker=true']

```sql
 WITH enrollment AS (
         SELECT schedule_participants.schedule_id,
            schedule_participants.participant_id,
            schedule_participants.registration_status AS enrollment_status
           FROM schedule_participants
          WHERE (schedule_participants.deleted_at IS NULL)
        ), attendance_agg AS (
         SELECT attendance.schedule_id,
            attendance.participant_id,
            count(*) FILTER (WHERE (attendance.attendance_status = 'present'::text)) AS present_days,
            count(*) FILTER (WHERE (attendance.attendance_status = 'late'::text)) AS late_days,
            count(*) FILTER (WHERE (attendance.attendance_status = 'absent'::text)) AS absent_days,
            count(*) FILTER (WHERE (attendance.attendance_status = 'excused'::text)) AS excused_days,
            count(DISTINCT attendance.session_date) AS attendance_days
           FROM attendance
          WHERE (attendance.deleted_at IS NULL)
          GROUP BY attendance.schedule_id, attendance.participant_id
        ), assessment_row AS (
         SELECT assessments.schedule_id,
            assessments.participant_id,
            assessments.result,
            assessments.competency_status,
            assessments.theory_score,
            assessments.practical_score
           FROM assessments
          WHERE (assessments.deleted_at IS NULL)
        ), existing_cert AS (
         SELECT DISTINCT ON (certificates.schedule_id, certificates.participant_id) certificates.schedule_id,
            certificates.participant_id,
            certificates.id AS certificate_id,
            certificates.certificate_number
           FROM certificates
          WHERE ((certificates.deleted_at IS NULL) AND (certificates.schedule_id IS NOT NULL) AND (certificates.status <> 'revoked'::text))
          ORDER BY certificates.schedule_id, certificates.participant_id, certificates.created_at DESC
        ), joined AS (
         SELECT e.schedule_id,
            cs.schedule_code,
            e.participant_id,
            cs.course_id,
            COALESCE(co.title, co.course_name) AS course_name,
            co.course_code,
            p.full_name AS holder_name,
            e.enrollment_status,
            (cs.status)::text AS schedule_status,
            cs.start_date AS schedule_start_date,
            cs.end_date AS schedule_end_date,
            cs.venue,
            cs.trainer_name,
            COALESCE(att.present_days, (0)::bigint) AS present_days,
            COALESCE(att.late_days, (0)::bigint) AS late_days,
            COALESCE(att.absent_days, (0)::bigint) AS absent_days,
            COALESCE(att.excused_days, (0)::bigint) AS excused_days,
            COALESCE(att.attendance_days, (0)::bigint) AS attendance_days,
            co.certificate_type,
            co.attendance_min_percent,
            co.assessment_required,
            co.competency_required,
            co.certificate_generation_enabled,
            co.certificate_template_id,
            (ar.schedule_id IS NOT NULL) AS assessment_row_exists,
            ar.result,
            ar.competency_status,
            ar.theory_score,
            ar.practical_score,
            ec.certificate_id AS existing_certificate_id,
            ec.certificate_number AS existing_certificate_number,
            ((cs.end_date - cs.start_date) + 1) AS calendar_expected_days
           FROM ((((((enrollment e
             JOIN course_schedules cs ON (((cs.id = e.schedule_id) AND (cs.deleted_at IS NULL))))
             JOIN courses co ON ((co.id = cs.course_id)))
             JOIN participants p ON ((p.id = e.participant_id)))
             LEFT JOIN attendance_agg att ON (((att.schedule_id = e.schedule_id) AND (att.participant_id = e.participant_id))))
             LEFT JOIN assessment_row ar ON (((ar.schedule_id = e.schedule_id) AND (ar.participant_id = e.participant_id))))
             LEFT JOIN existing_cert ec ON (((ec.schedule_id = e.schedule_id) AND (ec.participant_id = e.participant_id))))
        ), computed AS (
         SELECT j.schedule_id,
            j.schedule_code,
            j.participant_id,
            j.course_id,
            j.course_name,
            j.course_code,
            j.holder_name,
            j.enrollment_status,
            j.schedule_status,
            j.schedule_start_date,
            j.schedule_end_date,
            j.venue,
            j.trainer_name,
            j.present_days,
            j.late_days,
            j.absent_days,
            j.excused_days,
            j.attendance_days,
            j.certificate_type,
            j.attendance_min_percent,
            j.assessment_required,
            j.competency_required,
            j.certificate_generation_enabled,
            j.certificate_template_id,
            j.assessment_row_exists,
            j.result,
            j.competency_status,
            j.theory_score,
            j.practical_score,
            j.existing_certificate_id,
            j.existing_certificate_number,
            j.calendar_expected_days,
            GREATEST((j.calendar_expected_days - j.excused_days), (0)::bigint) AS effective_expected_days,
            (j.present_days + j.late_days) AS attended_days
           FROM joined j
        ), metrics AS (
         SELECT c.schedule_id,
            c.schedule_code,
            c.participant_id,
            c.course_id,
            c.course_name,
            c.course_code,
            c.holder_name,
            c.enrollment_status,
            c.schedule_status,
            c.schedule_start_date,
            c.schedule_end_date,
            c.venue,
            c.trainer_name,
            c.present_days,
            c.late_days,
            c.absent_days,
            c.excused_days,
            c.attendance_days,
            c.certificate_type,
            c.attendance_min_percent,
            c.assessment_required,
            c.competency_required,
            c.certificate_generation_enabled,
            c.certificate_template_id,
            c.assessment_row_exists,
            c.result,
            c.competency_status,
            c.theory_score,
            c.practical_score,
            c.existing_certificate_id,
            c.existing_certificate_number,
            c.calendar_expected_days,
            c.effective_expected_days,
            c.attended_days,
                CASE
                    WHEN (c.effective_expected_days <= 0) THEN (100)::numeric
                    ELSE round((((c.attended_days)::numeric * 100.0) / (c.effective_expected_days)::numeric), 2)
                END AS attendance_percentage
           FROM computed c
        ), final AS (
         SELECT m.schedule_id,
            m.schedule_code,
            m.participant_id,
            m.course_id,
            m.course_name,
            m.course_code,
            m.holder_name,
            m.enrollment_status,
            m.schedule_status,
            m.schedule_start_date,
            m.schedule_end_date,
            m.venue,
            m.trainer_name,
            m.present_days,
            m.late_days,
            m.absent_days,
            m.excused_days,
            m.attendance_days,
            m.certificate_type,
            m.attendance_min_percent,
            m.assessment_required,
            m.competency_required,
            m.certificate_generation_enabled,
            m.certificate_template_id,
            m.assessment_row_exists,
            m.result,
            m.competency_status,
            m.theory_score,
            m.practical_score,
            m.existing_certificate_id,
            m.existing_certificate_number,
            m.calendar_expected_days,
            m.effective_expected_days,
            m.attended_days,
            m.attendance_percentage,
            (m.attendance_percentage >= m.attendance_min_percent) AS attendance_satisfied,
                CASE
                    WHEN (NOT m.assessment_required) THEN true
                    WHEN (NOT m.assessment_row_exists) THEN false
                    WHEN (m.result IS DISTINCT FROM 'pass'::text) THEN false
                    WHEN (m.competency_required AND (COALESCE(m.competency_status, ''::text) <> 'competent'::text)) THEN false
                    ELSE true
                END AS assessment_satisfied
           FROM metrics m
        )
 SELECT schedule_id,
    schedule_code,
    participant_id,
    course_id,
    course_name,
    course_code,
    holder_name,
    enrollment_status,
    schedule_status,
    schedule_start_date,
    schedule_end_date,
    venue,
    trainer_name,
    calendar_expected_days,
    attendance_days,
    present_days,
    late_days,
    absent_days,
    excused_days,
    effective_expected_days,
    attended_days,
    attendance_percentage,
    attendance_min_percent,
    attendance_satisfied,
    certificate_type,
    assessment_required,
    competency_required,
    assessment_row_exists,
    result,
    competency_status,
    theory_score,
    practical_score,
    assessment_satisfied,
    existing_certificate_id,
    existing_certificate_number,
    (certificate_generation_enabled AND (certificate_template_id IS NOT NULL) AND (enrollment_status <> 'cancelled'::text) AND (schedule_status = 'completed'::text) AND attendance_satisfied AND assessment_satisfied AND (existing_certificate_id IS NULL)) AS eligible,
        CASE
            WHEN (NOT certificate_generation_enabled) THEN 'certificate_generation_disabled'::text
            WHEN (certificate_template_id IS NULL) THEN 'certificate_template_not_configured'::text
            WHEN (enrollment_status = 'cancelled'::text) THEN 'enrollment_cancelled'::text
            WHEN (schedule_status <> 'completed'::text) THEN 'schedule_not_completed'::text
            WHEN (NOT attendance_satisfied) THEN 'attendance_not_met'::text
            WHEN (assessment_required AND (NOT assessment_row_exists)) THEN 'assessment_missing'::text
            WHEN (assessment_required AND (result IS DISTINCT FROM 'pass'::text)) THEN 'assessment_not_passed'::text
            WHEN (assessment_required AND competency_required AND (COALESCE(competency_status, ''::text) <> 'competent'::text)) THEN 'competency_not_met'::text
            WHEN (existing_certificate_id IS NOT NULL) THEN 'certificate_already_exists'::text
            ELSE NULL::text
        END AS ineligibility_reason,
    certificate_generation_enabled,
    certificate_template_id
   FROM final f;
```

### public.v_sales_lead_inbox
reloptions: ['security_invoker=true']

```sql
 SELECT m.id AS lead_metadata_id,
    m.lead_source,
    m.source_id,
    m.status,
    m.assigned_to,
    m.follow_up_at,
    m.priority,
    m.lost_reason,
    m.won_at,
    m.created_at,
    m.updated_at,
        CASE
            WHEN (m.lead_source = 'enquiry'::text) THEN e.name
            ELSE p.contact_person
        END AS contact_name,
        CASE
            WHEN (m.lead_source = 'enquiry'::text) THEN e.company
            ELSE p.company_name
        END AS company,
        CASE
            WHEN (m.lead_source = 'enquiry'::text) THEN e.email
            ELSE p.email
        END AS email,
        CASE
            WHEN (m.lead_source = 'enquiry'::text) THEN e.phone
            ELSE p.phone
        END AS phone,
        CASE
            WHEN (m.lead_source = 'enquiry'::text) THEN e.subject
            ELSE COALESCE(p.programme, p.category)
        END AS subject
   FROM ((sales_lead_metadata m
     LEFT JOIN enquiries e ON (((m.lead_source = 'enquiry'::text) AND (e.id = m.source_id))))
     LEFT JOIN proposal_requests p ON (((m.lead_source = 'proposal_request'::text) AND (p.id = m.source_id))));
```

## Functions / RPCs
- `app.audit_trigger()` -> trigger | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=None
- `app.certificates_before_insert()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.create_sales_lead_metadata()` -> trigger | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=None
- `app.current_role()` -> user_role | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.duplicate_certificate_with_skill_snapshot(p_source_certificate_id uuid)` -> TABLE(id uuid, verification_token text) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public, app, extensions'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.feedback_action_transition_guard()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.feedback_issue_transition_guard()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.gen_company_id()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.gen_participant_id()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.gen_schedule_code()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=public, app'] | ACL=None
- `app.handle_new_user()` -> trigger | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public, auth'] | ACL=['postgres=X/postgres']
- `app.has_min_role(min_role user_role)` -> boolean | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.is_active()` -> boolean | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.is_admin()` -> boolean | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.is_admin_or_trainer()` -> boolean | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=None
- `app.is_editor()` -> boolean | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.is_super_admin()` -> boolean | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.issue_certificate_with_skill_snapshot(p_schedule_id uuid, p_participant_id uuid, p_certificate_number text)` -> TABLE(id uuid, verification_token text) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public, app, extensions'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres']
- `app.log_event(p_action audit_action, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb)` -> void | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `app.next_opportunity_number()` -> text | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=app'] | ACL=None
- `app.next_quotation_number()` -> text | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=app'] | ACL=None
- `app.set_updated_at()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.stamp_actor()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=None | ACL=None
- `app.sync_attendance_present()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=public, app'] | ACL=None
- `app.sync_schedule_seats()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=public, app'] | ACL=None
- `public.accept_quotation(p_quotation_id uuid)` -> void | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.convert_lead_to_opportunity(p_lead_metadata_id uuid, p_title text, p_expected_close_date date, p_estimated_value numeric)` -> uuid | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.feedback_anonymous_stats(p_schedule_id uuid)` -> TABLE(total_eligible bigint, responses bigint, response_rate numeric, avg_overall numeric, nps_promoters numeric, nps_passives numeric, nps_detractors numeric, nps numeric) | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.feedback_generate_links(p_schedule_id uuid)` -> TABLE(created_count bigint) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.feedback_get_by_token(p_token text)` -> TABLE(valid boolean, already_submitted boolean, course_title text, schedule_code text, schedule_start date, schedule_end date, venue text, trainer_name text) | 13619 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.feedback_reopen(p_feedback_id uuid)` -> boolean | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.feedback_submit(p_token text, p_data jsonb)` -> TABLE(ok boolean, code text, message text) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.get_public_upcoming_schedules(p_include_past boolean)` -> TABLE(schedule_id uuid, course_id uuid, course_title text, course_slug text, start_date date, end_date date, start_time time without time zone, end_time time without time zone, venue text, delivery_mode text, status text, capacity integer, available_seats integer) | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gin_extract_value_trgm(text, internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)` -> boolean | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)` -> "char" | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_compress(internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_consistent(internal, text, smallint, oid, internal)` -> boolean | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_decompress(internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_distance(internal, text, smallint, oid, internal)` -> double precision | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_in(cstring)` -> gtrgm | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_options(internal)` -> void | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_out(gtrgm)` -> cstring | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_penalty(internal, internal, internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_picksplit(internal, internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_same(gtrgm, gtrgm, internal)` -> internal | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.gtrgm_union(internal, internal)` -> gtrgm | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.log_event(p_action audit_action, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb)` -> void | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.log_event_as_service(p_actor_id uuid, p_actor_email text, p_action audit_action, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb)` -> void | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.mark_opportunity_lost(p_opportunity_id uuid, p_reason text)` -> void | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.mark_proposal_delivery_status(p_id uuid, p_email_sent boolean, p_sheets_synced boolean)` -> void | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=pg_catalog, public'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.reject_quotation(p_quotation_id uuid, p_reason text)` -> void | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.resolve_schedule_feedback_participant(p_public_token text, p_identity_number text, p_request_fingerprint_hash text)` -> TABLE(feedback_token text, already_submitted boolean) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=pg_catalog'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.set_limit(real)` -> real | 13 | SECURITY INVOKER | volatility=v | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.set_updated_at()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.show_limit()` -> real | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.show_trgm(text)` -> text[] | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.similarity(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.similarity_dist(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.similarity_op(text, text)` -> boolean | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.strict_word_similarity(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.strict_word_similarity_commutator_op(text, text)` -> boolean | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.strict_word_similarity_dist_commutator_op(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.strict_word_similarity_dist_op(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.strict_word_similarity_op(text, text)` -> boolean | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.submit_proposal_request(p_company_name text, p_contact_person text, p_job_title text, p_email text, p_phone text, p_industry text, p_category text, p_programme text, p_participants integer, p_location text, p_preferred_month text, p_budget text, p_objectives text, p_notes text)` -> uuid | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.submit_public_enquiry(p_name text, p_company text, p_email text, p_phone text, p_enquiry_type text, p_subject text, p_message text, p_source_page text)` -> uuid | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.sync_participant_last4()` -> trigger | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.teras_photo_next_id()` -> text | 13619 | SECURITY INVOKER | volatility=v | owner=postgres | search_path=['search_path=pg_catalog, public'] | ACL=['=X/postgres', 'postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.verify_and_log(p_query text, p_method text, p_ip text, p_ua text)` -> TABLE(found boolean, certificate_number text, holder_name text, participant_code_masked text, company text, course_title text, training_date date, issue_date date, expiry_date date, status text, is_valid boolean, verified_at timestamp with time zone) | 13619 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'anon=X/postgres', 'authenticated=X/postgres', 'service_role=X/postgres']
- `public.verify_certificate(input_certificate_no text)` -> TABLE(certificate_no text, participant_name text, course_name text, course_code text, training_start_date date, training_end_date date, issue_date date, expiry_date date, status text, venue text) | 14 | SECURITY DEFINER | volatility=s | owner=postgres | search_path=['search_path=""'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.verify_certificate_by_value(search_value text)` -> TABLE(participant_name text, course_name text, certificate_no text, training_start_date date, training_end_date date, issue_date date, expiry_date date, status text, trainer_name text, venue text, instructor text, certificate_file_url text) | 14 | SECURITY DEFINER | volatility=v | owner=postgres | search_path=['search_path=public'] | ACL=['postgres=X/postgres', 'service_role=X/postgres']
- `public.word_similarity(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.word_similarity_commutator_op(text, text)` -> boolean | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.word_similarity_dist_commutator_op(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.word_similarity_dist_op(text, text)` -> real | 13 | SECURITY INVOKER | volatility=i | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']
- `public.word_similarity_op(text, text)` -> boolean | 13 | SECURITY INVOKER | volatility=s | owner=supabase_admin | search_path=None | ACL=['=X/supabase_admin', 'supabase_admin=X/supabase_admin', 'postgres=X/supabase_admin', 'anon=X/supabase_admin', 'authenticated=X/supabase_admin', 'service_role=X/supabase_admin']

## Triggers
- `public.assessments` AFTER INSERT DELETE UPDATE ROW trg_assessments_audit -> audit_trigger()
- `public.assessments` BEFORE UPDATE ROW trg_assessments_updated_at -> set_updated_at()
- `public.attendance` AFTER INSERT DELETE UPDATE ROW trg_attendance_audit -> audit_trigger()
- `public.attendance` BEFORE INSERT UPDATE ROW trg_attendance_sync_present -> sync_attendance_present()
- `public.attendance` BEFORE UPDATE ROW trg_attendance_updated_at -> set_updated_at()
- `public.certificate_skill_results` AFTER INSERT ROW trg_certificate_skill_results_audit -> audit_trigger()
- `public.certificate_templates` AFTER INSERT DELETE UPDATE ROW trg_cert_templates_audit -> audit_trigger()
- `public.certificate_templates` BEFORE UPDATE ROW trg_cert_templates_updated_at -> set_updated_at()
- `public.certificates` BEFORE UPDATE ROW certificates_set_updated_at -> set_updated_at()
- `public.certificates` AFTER INSERT DELETE UPDATE ROW trg_certificates_audit -> audit_trigger()
- `public.certificates` BEFORE INSERT ROW trg_certificates_before_insert -> certificates_before_insert()
- `public.certificates` BEFORE UPDATE ROW trg_certificates_updated_at -> set_updated_at()
- `public.companies` AFTER INSERT DELETE UPDATE ROW trg_companies_audit -> audit_trigger()
- `public.companies` BEFORE INSERT UPDATE ROW trg_companies_stamp -> stamp_actor()
- `public.companies` BEFORE UPDATE ROW trg_companies_updated_at -> set_updated_at()
- `public.companies` BEFORE INSERT ROW trg_company_id -> gen_company_id()
- `public.course_schedules` AFTER INSERT DELETE UPDATE ROW trg_course_schedules_audit -> audit_trigger()
- `public.course_schedules` BEFORE INSERT ROW trg_course_schedules_code -> gen_schedule_code()
- `public.course_schedules` BEFORE UPDATE ROW trg_course_schedules_updated_at -> set_updated_at()
- `public.courses` BEFORE UPDATE ROW courses_set_updated_at -> set_updated_at()
- `public.enquiries` AFTER INSERT ROW trg_enquiries_create_sales_lead -> create_sales_lead_metadata()
- `public.feedback_improvement_actions` AFTER INSERT DELETE UPDATE ROW trg_feedback_actions_audit -> audit_trigger()
- `public.feedback_improvement_actions` BEFORE INSERT UPDATE ROW trg_feedback_actions_stamp -> stamp_actor()
- `public.feedback_improvement_actions` BEFORE UPDATE ROW trg_feedback_actions_transition_guard -> feedback_action_transition_guard()
- `public.feedback_improvement_actions` BEFORE UPDATE ROW trg_feedback_actions_updated_at -> set_updated_at()
- `public.feedback_issues` AFTER INSERT DELETE UPDATE ROW trg_feedback_issues_audit -> audit_trigger()
- `public.feedback_issues` BEFORE INSERT UPDATE ROW trg_feedback_issues_stamp -> stamp_actor()
- `public.feedback_issues` BEFORE UPDATE ROW trg_feedback_issues_transition_guard -> feedback_issue_transition_guard()
- `public.feedback_issues` BEFORE UPDATE ROW trg_feedback_issues_updated_at -> set_updated_at()
- `public.participant_feedback` AFTER INSERT DELETE UPDATE ROW trg_participant_feedback_audit -> audit_trigger()
- `public.participant_feedback` BEFORE UPDATE ROW trg_participant_feedback_updated_at -> set_updated_at()
- `public.participant_skill_results` AFTER INSERT DELETE UPDATE ROW trg_participant_skill_results_audit -> audit_trigger()
- `public.participant_skill_results` BEFORE UPDATE ROW trg_participant_skill_results_updated_at -> set_updated_at()
- `public.participants` BEFORE UPDATE ROW participants_set_updated_at -> set_updated_at()
- `public.participants` BEFORE INSERT UPDATE ROW participants_sync_last4 -> sync_participant_last4()
- `public.participants` BEFORE INSERT ROW trg_participant_id -> gen_participant_id()
- `public.participants` AFTER INSERT DELETE UPDATE ROW trg_participants_audit -> audit_trigger()
- `public.participants` BEFORE UPDATE ROW trg_participants_updated_at -> set_updated_at()
- `public.photo_ai_analysis` BEFORE UPDATE ROW trg_photo_ai_analysis_updated_at -> set_updated_at()
- `public.photo_events` BEFORE UPDATE ROW trg_photo_events_updated_at -> set_updated_at()
- `public.photos` BEFORE UPDATE ROW trg_photos_updated_at -> set_updated_at()
- `public.proposal_requests` AFTER INSERT ROW trg_proposal_requests_create_sales_lead -> create_sales_lead_metadata()
- `public.sales_tasks` AFTER INSERT DELETE UPDATE ROW trg_sales_tasks_audit -> audit_trigger()
- `public.sales_tasks` BEFORE INSERT UPDATE ROW trg_sales_tasks_stamp -> stamp_actor()
- `public.sales_tasks` BEFORE UPDATE ROW trg_sales_tasks_updated_at -> set_updated_at()
- `public.schedule_participants` AFTER INSERT DELETE UPDATE ROW trg_schedule_participants_audit -> audit_trigger()
- `public.schedule_participants` AFTER INSERT DELETE UPDATE ROW trg_schedule_participants_sync_seats -> sync_schedule_seats()
- `public.schedule_participants` BEFORE UPDATE ROW trg_schedule_participants_updated_at -> set_updated_at()

## RLS policies
- `public.admin_users` policy `Admins can read admin membership` [SELECT] roles=['authenticated']
    USING: (( SELECT auth.uid() AS uid) = user_id)
- `public.assessments` policy `assessments_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.assessments` policy `assessments_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin_or_trainer()
- `public.assessments` policy `assessments_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.assessments` policy `assessments_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin_or_trainer()
    WITH CHECK: app.is_admin_or_trainer()
- `public.attendance` policy `attendance_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin_or_trainer()
- `public.attendance` policy `attendance_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin_or_trainer()
- `public.attendance` policy `attendance_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.attendance` policy `attendance_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin_or_trainer()
    WITH CHECK: app.is_admin_or_trainer()
- `public.audit_logs` policy `audit_staff_read` [SELECT] roles=['public']
    USING: app.is_admin()
- `public.certificate_import_logs` policy `Admins can create import logs` [INSERT] roles=['authenticated']
    WITH CHECK: ((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM admin_users a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid)))))
- `public.certificate_import_logs` policy `Admins can read import logs` [SELECT] roles=['authenticated']
    USING: (EXISTS ( SELECT 1
   FROM admin_users a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid))))
- `public.certificate_skill_results` policy `certificate_skill_results_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.certificate_skill_results` policy `certificate_skill_results_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.certificate_templates` policy `cert_templates_admin_write` [ALL] roles=['public']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.certificate_templates` policy `cert_templates_view` [SELECT] roles=['public']
    USING: (app.is_editor() OR (app."current_role"() = 'trainer'::user_role))
- `public.certificate_verifications` policy `cert_verif_staff_read` [SELECT] roles=['public']
    USING: (app.is_editor() OR (app."current_role"() = 'trainer'::user_role))
- `public.certificates` policy `certificates_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.certificates` policy `certificates_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.certificates` policy `certificates_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.certificates` policy `certificates_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.cms_content` policy `cms_content_staff_all` [ALL] roles=['authenticated']
    USING: ( SELECT app.is_editor() AS is_editor)
    WITH CHECK: ( SELECT app.is_editor() AS is_editor)
- `public.cms_media` policy `cms_media_staff_all` [ALL] roles=['authenticated']
    USING: ( SELECT app.is_editor() AS is_editor)
    WITH CHECK: ( SELECT app.is_editor() AS is_editor)
- `public.companies` policy `companies_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.companies` policy `companies_admin_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_admin()
- `public.companies` policy `companies_admin_update` [UPDATE] roles=['public']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.companies` policy `companies_staff_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.company_profile` policy `company_profile_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.company_profile` policy `company_profile_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.company_profile` policy `company_profile_public_read` [SELECT] roles=['public']
    USING: true
- `public.course_schedules` policy `course_schedules_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.course_schedules` policy `course_schedules_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.course_schedules` policy `course_schedules_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.course_schedules` policy `course_schedules_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.courses` policy `courses_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.courses` policy `courses_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.has_min_role('editor'::user_role)
- `public.courses` policy `courses_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.courses` policy `courses_update` [UPDATE] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
    WITH CHECK: app.has_min_role('editor'::user_role)
- `public.downloads` policy `downloads_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.downloads` policy `downloads_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.downloads` policy `downloads_editor_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.downloads` policy `downloads_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.downloads` policy `downloads_public_read` [SELECT] roles=['public']
    USING: ((status = 'published'::content_status) AND (deleted_at IS NULL))
- `public.enquiries` policy `enquiries_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.faq_categories` policy `faq_categories_editor_all` [ALL] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.faqs` policy `faqs_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.faqs` policy `faqs_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.faqs` policy `faqs_editor_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.faqs` policy `faqs_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.faqs` policy `faqs_public_read` [SELECT] roles=['public']
    USING: ((status = 'published'::content_status) AND (deleted_at IS NULL))
- `public.feedback_improvement_actions` policy `feedback_improvement_actions_staff_insert` [INSERT] roles=['authenticated']
    WITH CHECK: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.feedback_improvement_actions` policy `feedback_improvement_actions_staff_select` [SELECT] roles=['authenticated']
    USING: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.feedback_improvement_actions` policy `feedback_improvement_actions_staff_update` [UPDATE] roles=['authenticated']
    USING: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
    WITH CHECK: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.feedback_issues` policy `feedback_issues_staff_insert` [INSERT] roles=['authenticated']
    WITH CHECK: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.feedback_issues` policy `feedback_issues_staff_select` [SELECT] roles=['authenticated']
    USING: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.feedback_issues` policy `feedback_issues_staff_update` [UPDATE] roles=['authenticated']
    USING: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
    WITH CHECK: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.gallery_categories` policy `gallery_categories_editor_all` [ALL] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.gallery_images` policy `gallery_images_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.gallery_images` policy `gallery_images_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.gallery_images` policy `gallery_images_editor_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.gallery_images` policy `gallery_images_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.gallery_images` policy `gallery_images_public_read` [SELECT] roles=['public']
    USING: ((status = 'published'::content_status) AND (deleted_at IS NULL))
- `public.media` policy `media_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.media` policy `media_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.media` policy `media_editor_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.media` policy `media_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.media` policy `media_public_read` [SELECT] roles=['public']
    USING: ((status = 'published'::content_status) AND (deleted_at IS NULL))
- `public.media_folders` policy `media_folders_editor_all` [ALL] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.news_categories` policy `news_categories_editor_all` [ALL] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.news_posts` policy `news_posts_admin_delete` [DELETE] roles=['public']
    USING: app.is_admin()
- `public.news_posts` policy `news_posts_editor_insert` [INSERT] roles=['public']
    WITH CHECK: app.is_editor()
- `public.news_posts` policy `news_posts_editor_read` [SELECT] roles=['public']
    USING: app.is_editor()
- `public.news_posts` policy `news_posts_editor_update` [UPDATE] roles=['public']
    USING: app.is_editor()
    WITH CHECK: app.is_editor()
- `public.news_posts` policy `news_posts_public_read` [SELECT] roles=['public']
    USING: ((status = 'published'::content_status) AND (deleted_at IS NULL))
- `public.participant_feedback` policy `participant_feedback_staff_select` [SELECT] roles=['authenticated']
    USING: ( SELECT app.has_min_role('editor'::user_role) AS has_min_role)
- `public.participant_skill_results` policy `participant_skill_results_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.participant_skill_results` policy `participant_skill_results_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin_or_trainer()
- `public.participant_skill_results` policy `participant_skill_results_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.participant_skill_results` policy `participant_skill_results_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin_or_trainer()
    WITH CHECK: app.is_admin_or_trainer()
- `public.participants` policy `participants_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.participants` policy `participants_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.participants` policy `participants_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.participants` policy `participants_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.profiles` policy `profiles_self_select` [SELECT] roles=['authenticated']
    USING: ((id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_admin() AS is_admin))
- `public.profiles` policy `profiles_self_update` [UPDATE] roles=['authenticated']
    USING: ((id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_super_admin() AS is_super_admin))
    WITH CHECK: ((id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_super_admin() AS is_super_admin))
- `public.proposal_requests` policy `proposal_requests_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.proposal_requests` policy `proposal_requests_update` [UPDATE] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
    WITH CHECK: app.has_min_role('editor'::user_role)
- `public.sales_activity` policy `sales_activity_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.has_min_role('editor'::user_role)
- `public.sales_activity` policy `sales_activity_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_lead_metadata` policy `sales_lead_metadata_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_lead_metadata` policy `sales_lead_metadata_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.sales_opportunities` policy `sales_opportunities_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.sales_opportunities` policy `sales_opportunities_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_opportunities` policy `sales_opportunities_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.sales_quotation_items` policy `sales_quotation_items_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.sales_quotation_items` policy `sales_quotation_items_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.sales_quotation_items` policy `sales_quotation_items_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_quotation_items` policy `sales_quotation_items_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.sales_quotations` policy `sales_quotations_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.sales_quotations` policy `sales_quotations_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_quotations` policy `sales_quotations_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()
- `public.sales_tasks` policy `sales_tasks_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.sales_tasks` policy `sales_tasks_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.has_min_role('editor'::user_role)
- `public.sales_tasks` policy `sales_tasks_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('editor'::user_role)
- `public.sales_tasks` policy `sales_tasks_update` [UPDATE] roles=['authenticated']
    USING: (app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid()))
    WITH CHECK: (app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid()))
- `public.schedule_participants` policy `schedule_participants_delete` [DELETE] roles=['authenticated']
    USING: app.is_admin()
- `public.schedule_participants` policy `schedule_participants_insert` [INSERT] roles=['authenticated']
    WITH CHECK: app.is_admin()
- `public.schedule_participants` policy `schedule_participants_select` [SELECT] roles=['authenticated']
    USING: app.has_min_role('trainer'::user_role)
- `public.schedule_participants` policy `schedule_participants_update` [UPDATE] roles=['authenticated']
    USING: app.is_admin()
    WITH CHECK: app.is_admin()

## Roles
- `anon` super=False createDb=False login=False bypassRLS=False connlimit=-1
- `authenticated` super=False createDb=False login=False bypassRLS=False connlimit=-1
- `authenticator` super=False createDb=False login=True bypassRLS=False connlimit=-1
- `dashboard_user` super=False createDb=True login=False bypassRLS=False connlimit=-1
- `postgres` super=False createDb=True login=True bypassRLS=True connlimit=-1
- `service_role` super=False createDb=False login=False bypassRLS=True connlimit=-1
- `supabase_admin` super=True createDb=True login=True bypassRLS=True connlimit=-1
- `supabase_auth_admin` super=False createDb=False login=True bypassRLS=False connlimit=-1

## Sequences
- `app.sales_opportunity_seq` last_value=12
- `app.sales_quotation_seq` last_value=10
- `public.audit_logs_id_seq` last_value=1282
- `public.certificate_number_seq` last_value=31
- `public.certificate_verifications_id_seq` last_value=72
- `public.company_id_seq` last_value=1
- `public.participant_id_seq` last_value=168
- `public.schedule_code_seq` last_value=20