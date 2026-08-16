# SCHEMA_INDEX

> ## SOURCE OF TRUTH AFTER BASELINE V1
> Compact index of the **live production schema** (project `iagzkrzeuawaxvacqprk`). Use this + `PRODUCTION_DATABASE_BASELINE.md` for day-to-day DB questions. The canonical frozen schema is `supabase/baseline/v1/schema.sql`; new environments are built via `supabase/baseline/v1/bootstrap.sql` + post-baseline migrations (>= `20260817000000`). Historical migrations are for archaeology only.

Compact index of the live production schema (project `iagzkrzeuawaxvacqprk`). Source of truth: `supabase/baseline/v1/schema.sql` + forward-only changes. Full detail: `docs/database-baseline-audit/PRODUCTION_SCHEMA_INVENTORY.md`.

## public.admin_users
- Columns: 3 (user_id, display_name, created_at)
- PK: (user_id)
- FK: (user_id) -> auth.users(id) ON DELETE CASCADE
- RLS: on | owner postgres
- Policies (1): SELECT

## public.assessments
- Columns: 19 (id, schedule_id, participant_id, assessment_type, score, max_score, result, assessed_at, remarks, created_at, updated_at, theory_score...)
- PK: (id)
- FK: (assessor_id) -> profiles(id); (locked_by) -> profiles(id); (participant_id) -> participants(id) ON DELETE CASCADE; (schedule_id) -> course_schedules(id) ON DELETE SET NULL
- Unique: (schedule_id, participant_id)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.attendance
- Columns: 13 (id, schedule_id, participant_id, session_date, present, remarks, recorded_by, created_at, updated_at, attendance_status, check_in_time, check_out_time...)
- PK: (id)
- FK: (participant_id) -> participants(id) ON DELETE CASCADE; (recorded_by) -> profiles(id); (schedule_id) -> course_schedules(id) ON DELETE CASCADE
- Unique: (schedule_id, participant_id, session_date)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.audit_logs
- Columns: 9 (id, actor_id, actor_email, action, entity_type, entity_id, summary, metadata, created_at)
- PK: (id)
- FK: (actor_id) -> profiles(id) ON DELETE SET NULL
- RLS: on | owner postgres
- Policies (1): SELECT

## public.certificate_import_logs
- Columns: 11 (id, created_by, source, source_file_count, row_count, imported_count, skipped_count, error_count, status, error_summary, created_at)
- PK: (id)
- FK: (created_by) -> auth.users(id) ON DELETE RESTRICT
- RLS: on | owner postgres
- Policies (2): INSERT; SELECT

## public.certificate_skill_results
- Columns: 8 (id, certificate_id, area, status, score, notes, source_skill_result_id, created_at)
- PK: (id)
- FK: (certificate_id) -> certificates(id) ON DELETE CASCADE; (source_skill_result_id) -> participant_skill_results(id) ON DELETE SET NULL
- Unique: (certificate_id, area)
- RLS: on | owner postgres
- Policies (2): INSERT; SELECT

## public.certificate_templates
- Columns: 13 (id, name, description, orientation, paper_size, config, is_active, is_default, created_by, updated_by, created_at, updated_at...)
- PK: (id)
- FK: (created_by) -> profiles(id); (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (2): ALL; SELECT

## public.certificate_verifications
- Columns: 9 (id, certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent, verified_at)
- PK: (id)
- FK: (certificate_id) -> certificates(id) ON DELETE SET NULL
- RLS: on | owner postgres
- Policies (1): SELECT

## public.certificates
- Columns: 32 (id, certificate_no, participant_name, identity_last4, course_name, course_code, training_start_date, training_end_date, issue_date, expiry_date, status, trainer_name...)
- PK: (id)
- FK: (course_id) -> courses(id) ON DELETE SET NULL; (issued_by) -> profiles(id); (participant_id) -> participants(id) ON DELETE RESTRICT; (schedule_id) -> course_schedules(id) ON DELETE SET NULL; (template_id) -> certificate_templates(id) ON DELETE SET NULL
- Unique: (certificate_no)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.cms_content
- Columns: 13 (id, content_type, slug, title, body, status, featured, sort_order, created_by, updated_by, created_at, updated_at...)
- PK: (id)
- FK: (created_by) -> profiles(id); (updated_by) -> profiles(id)
- Unique: (content_type, slug)
- RLS: on | owner postgres
- Policies (1): ALL

## public.cms_media
- Columns: 11 (id, bucket, storage_path, file_name, mime_type, file_size, public_url, alt_text, created_by, created_at, deleted_at)
- PK: (id)
- FK: (created_by) -> profiles(id)
- Unique: (bucket, storage_path)
- RLS: on | owner postgres
- Policies (1): ALL

## public.companies
- Columns: 26 (id, company_id, company_name, registration_no, industry, company_type, address, postcode, city, state, country, phone...)
- PK: (id)
- FK: (created_by) -> profiles(id); (updated_by) -> profiles(id)
- Unique: (company_id)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.company_profile
- Columns: 20 (id, legal_name, tagline, about, vision, mission, services, phone, email_training, email_admin, address, city...)
- PK: (id)
- FK: (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (3): INSERT; SELECT; UPDATE

## public.course_schedules
- Columns: 23 (id, course_id, trainer_name, venue, start_date, end_date, capacity, seats_taken, status, notes, is_published, created_by...)
- PK: (id)
- FK: (course_id) -> courses(id) ON DELETE RESTRICT; (created_by) -> profiles(id); (source_opportunity_id) -> sales_opportunities(id) ON DELETE SET NULL; (source_quotation_id) -> sales_quotations(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.courses
- Columns: 38 (id, course_code, course_name, description, validity_months, active, created_at, updated_at, title, slug, category, summary...)
- PK: (id)
- FK: (certificate_template_id) -> certificate_templates(id) ON DELETE SET NULL; (created_by) -> profiles(id); (updated_by) -> profiles(id)
- Unique: (course_code)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.downloads
- Columns: 16 (id, title, slug, description, category, media_id, file_url, file_size, download_count, status, sort_order, created_by...)
- PK: (id)
- FK: (created_by) -> profiles(id); (media_id) -> media(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- Unique: (slug)
- RLS: on | owner postgres
- Policies (5): DELETE; INSERT; SELECT; UPDATE

## public.enquiries
- Columns: 12 (id, name, company, email, phone, enquiry_type, subject, message, source_page, status, created_at, deleted_at)
- PK: (id)
- RLS: on | owner postgres
- Policies (1): SELECT

## public.faq_categories
- Columns: 5 (id, name, slug, sort_order, created_at)
- PK: (id)
- Unique: (slug)
- RLS: on | owner postgres
- Policies (1): ALL

## public.faqs
- Columns: 11 (id, question, answer, category_id, status, sort_order, created_by, updated_by, created_at, updated_at, deleted_at)
- PK: (id)
- FK: (category_id) -> faq_categories(id) ON DELETE SET NULL; (created_by) -> profiles(id); (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (5): DELETE; INSERT; SELECT; UPDATE

## public.feedback_improvement_actions
- Columns: 20 (id, issue_id, schedule_id, category, department, title, description, priority, status, assigned_to, due_date, corrective_action...)
- PK: (id)
- FK: (assigned_to) -> profiles(id); (created_by) -> profiles(id); (issue_id) -> feedback_issues(id) ON DELETE CASCADE; (schedule_id) -> course_schedules(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (3): INSERT; SELECT; UPDATE

## public.feedback_issues
- Columns: 14 (id, source_feedback_id, schedule_id, category, department, title, description, priority, status, created_by, updated_by, created_at...)
- PK: (id)
- FK: (created_by) -> profiles(id); (schedule_id) -> course_schedules(id) ON DELETE SET NULL; (source_feedback_id) -> participant_feedback(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (3): INSERT; SELECT; UPDATE

## public.feedback_schedule_links
- Columns: 7 (id, schedule_id, public_token, is_active, created_at, created_by, disabled_at)
- PK: (id)
- FK: (created_by) -> profiles(id) ON DELETE SET NULL; (schedule_id) -> course_schedules(id) ON DELETE CASCADE
- Unique: (public_token); (schedule_id)
- RLS: on | owner postgres

## public.feedback_schedule_lookup_attempts
- Columns: 5 (schedule_link_id, request_fingerprint_hash, window_started_at, attempt_count, last_attempt_at)
- PK: (schedule_link_id, request_fingerprint_hash, window_started_at)
- FK: (schedule_link_id) -> feedback_schedule_links(id) ON DELETE CASCADE
- RLS: on | owner postgres

## public.gallery_categories
- Columns: 5 (id, name, slug, sort_order, created_at)
- PK: (id)
- Unique: (slug)
- RLS: on | owner postgres
- Policies (1): ALL

## public.gallery_images
- Columns: 14 (id, title, alt_text, media_id, image_url, category_id, featured, status, sort_order, created_by, updated_by, created_at...)
- PK: (id)
- FK: (category_id) -> gallery_categories(id) ON DELETE SET NULL; (created_by) -> profiles(id); (media_id) -> media(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- RLS: on | owner postgres
- Policies (5): DELETE; INSERT; SELECT; UPDATE

## public.media
- Columns: 18 (id, folder_id, kind, bucket, storage_path, public_url, file_name, mime_type, file_size, width, height, alt_text...)
- PK: (id)
- FK: (created_by) -> profiles(id); (folder_id) -> media_folders(id) ON DELETE SET NULL
- Unique: (bucket, storage_path)
- RLS: on | owner postgres
- Policies (5): DELETE; INSERT; SELECT; UPDATE

## public.media_folders
- Columns: 6 (id, name, parent_id, path, created_by, created_at)
- PK: (id)
- FK: (created_by) -> profiles(id); (parent_id) -> media_folders(id) ON DELETE CASCADE
- Unique: (parent_id, name)
- RLS: on | owner postgres
- Policies (1): ALL

## public.news_categories
- Columns: 5 (id, name, slug, sort_order, created_at)
- PK: (id)
- Unique: (slug)
- RLS: on | owner postgres
- Policies (1): ALL

## public.news_posts
- Columns: 19 (id, title, slug, excerpt, body, category_id, featured_image_url, featured, status, scheduled_for, published_at, seo_title...)
- PK: (id)
- FK: (author_id) -> profiles(id); (category_id) -> news_categories(id) ON DELETE SET NULL; (created_by) -> profiles(id); (updated_by) -> profiles(id)
- Unique: (slug)
- RLS: on | owner postgres
- Policies (5): DELETE; INSERT; SELECT; UPDATE

## public.participant_feedback
- Columns: 24 (id, schedule_id, participant_id, token, status, q1_score, q2_score, q3_score, q4_score, q5_score, q6_score, q7_score...)
- PK: (id)
- FK: (participant_id) -> participants(id) ON DELETE CASCADE; (schedule_id) -> course_schedules(id) ON DELETE CASCADE
- Unique: (schedule_id, participant_id)
- RLS: on | owner postgres
- Policies (1): SELECT

## public.participant_skill_results
- Columns: 15 (id, schedule_id, participant_id, area, status, score, notes, assessed_by, assessed_at, locked, locked_at, locked_by...)
- PK: (id)
- FK: (assessed_by) -> profiles(id); (locked_by) -> profiles(id); (participant_id) -> participants(id) ON DELETE CASCADE; (schedule_id) -> course_schedules(id) ON DELETE CASCADE
- Unique: (schedule_id, participant_id, area)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.participants
- Columns: 28 (id, participant_code, full_name, identity_no, identity_last4, email, phone, organization, position, address, notes, status...)
- PK: (id)
- FK: (company_id) -> companies(id) ON DELETE SET NULL; (created_by) -> profiles(id); (schedule_id) -> course_schedules(id) ON DELETE SET NULL; (updated_by) -> profiles(id)
- Unique: (participant_code)
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.photo_activity_log
- Columns: 7 (id, photo_id, action, actor_name, actor_telegram_id, metadata, created_at)
- PK: (id)
- FK: (photo_id) -> photos(id) ON DELETE SET NULL
- RLS: on (FORCE) | owner postgres

## public.photo_ai_analysis
- Columns: 24 (id, photo_id, provider, model, analysis_version, overall_score, sharpness_score, composition_score, subject_clarity_score, training_relevance_score, professionalism_score, story_impact_score...)
- PK: (id)
- FK: (photo_id) -> photos(id) ON DELETE CASCADE
- Unique: (photo_id, provider, model, analysis_version)
- RLS: on (FORCE) | owner postgres

## public.photo_categories
- Columns: 3 (key, label, sort_order)
- PK: (key)
- RLS: on (FORCE) | owner postgres

## public.photo_events
- Columns: 8 (id, name, slug, event_date, location, status, created_at, updated_at)
- PK: (id)
- Unique: (slug)
- RLS: on (FORCE) | owner postgres

## public.photo_id_sequences
- Columns: 2 (seq_date, last_value)
- PK: (seq_date)
- RLS: on (FORCE) | owner postgres

## public.photo_usage_types
- Columns: 3 (key, label, sort_order)
- PK: (key)
- RLS: on (FORCE) | owner postgres

## public.photo_usages
- Columns: 4 (id, photo_id, usage_type, created_at)
- PK: (id)
- FK: (photo_id) -> photos(id) ON DELETE CASCADE; (usage_type) -> photo_usage_types(key) ON DELETE RESTRICT
- Unique: (photo_id, usage_type)
- RLS: on (FORCE) | owner postgres

## public.photos
- Columns: 17 (id, media_id, photo_id, telegram_file_id, telegram_file_unique_id, event_id, category, status, is_best_photo, uploaded_by, uploaded_by_telegram_id, uploaded_at...)
- PK: (id)
- FK: (category) -> photo_categories(key) ON DELETE RESTRICT; (event_id) -> photo_events(id) ON DELETE SET NULL; (media_id) -> media(id) ON DELETE RESTRICT
- Unique: (media_id); (photo_id); (telegram_file_unique_id)
- RLS: on (FORCE) | owner postgres

## public.profiles
- Columns: 11 (id, email, full_name, phone, avatar_url, job_title, role, is_active, last_login_at, created_at, updated_at)
- PK: (id)
- FK: (id) -> auth.users(id) ON DELETE CASCADE
- Unique: (email)
- RLS: on | owner postgres
- Policies (2): SELECT; UPDATE

## public.proposal_requests
- Columns: 22 (id, company_name, contact_person, job_title, email, phone, industry, category, programme, participants, location, preferred_month...)
- PK: (id)
- FK: (assigned_to) -> profiles(id)
- RLS: on | owner postgres
- Policies (2): SELECT; UPDATE

## public.sales_activity
- Columns: 8 (id, lead_metadata_id, type, note, actor_id, created_at, opportunity_id, quotation_id)
- PK: (id)
- FK: (actor_id) -> profiles(id); (lead_metadata_id) -> sales_lead_metadata(id) ON DELETE CASCADE; (opportunity_id) -> sales_opportunities(id); (quotation_id) -> sales_quotations(id)
- RLS: on | owner postgres
- Policies (2): INSERT; SELECT

## public.sales_lead_metadata
- Columns: 11 (id, lead_source, source_id, status, assigned_to, follow_up_at, priority, lost_reason, won_at, created_at, updated_at)
- PK: (id)
- FK: (assigned_to) -> profiles(id)
- Unique: (lead_source, source_id)
- RLS: on | owner postgres
- Policies (2): SELECT; UPDATE

## public.sales_opportunities
- Columns: 21 (id, lead_metadata_id, opportunity_no, company_name, contact_person, contact_email, contact_phone, title, programme, stage, assigned_to, expected_close_date...)
- PK: (id)
- FK: (assigned_to) -> profiles(id); (company_id) -> companies(id) ON DELETE SET NULL; (created_by) -> profiles(id); (lead_metadata_id) -> sales_lead_metadata(id)
- Unique: (lead_metadata_id); (opportunity_no)
- RLS: on | owner postgres
- Policies (3): INSERT; SELECT; UPDATE

## public.sales_quotation_items
- Columns: 9 (id, quotation_id, description, quantity, unit, unit_price, discount, line_total, sort_order)
- PK: (id)
- FK: (quotation_id) -> sales_quotations(id) ON DELETE CASCADE
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.sales_quotations
- Columns: 25 (id, opportunity_id, quotation_no, revision_no, parent_quotation_id, status, issue_date, valid_until, currency, subtotal, discount, sst_applicable...)
- PK: (id)
- FK: (created_by) -> profiles(id); (opportunity_id) -> sales_opportunities(id); (parent_quotation_id) -> sales_quotations(id)
- Unique: (quotation_no, revision_no)
- RLS: on | owner postgres
- Policies (3): INSERT; SELECT; UPDATE

## public.sales_tasks
- Columns: 15 (id, title, description, status, priority, due_at, assigned_to, lead_metadata_id, opportunity_id, quotation_id, created_by, completed_at...)
- PK: (id)
- FK: (assigned_to) -> profiles(id) ON DELETE SET NULL; (created_by) -> profiles(id) ON DELETE SET NULL; (lead_metadata_id) -> sales_lead_metadata(id) ON DELETE SET NULL; (opportunity_id) -> sales_opportunities(id) ON DELETE SET NULL; (quotation_id) -> sales_quotations(id) ON DELETE SET NULL
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE

## public.schedule_participants
- Columns: 9 (id, schedule_id, participant_id, registration_status, enrolled_at, notes, created_at, updated_at, deleted_at)
- PK: (id)
- FK: (participant_id) -> participants(id) ON DELETE CASCADE; (schedule_id) -> course_schedules(id) ON DELETE CASCADE
- RLS: on | owner postgres
- Policies (4): DELETE; INSERT; SELECT; UPDATE
