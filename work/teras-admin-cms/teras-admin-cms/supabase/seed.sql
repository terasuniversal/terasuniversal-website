-- =====================================================================
-- TERAS UNIVERSAL Admin CMS — Seed Data
-- =====================================================================
-- Populates lookup tables and migrates the CURRENT hard-coded website
-- content into the database so the CMS starts fully populated and the
-- public site can switch to reading from Supabase with no visible change.
--
-- Real business facts (address, phone, emails) are taken verbatim from
-- the live site. NO testimonials or statistics are fabricated — the
-- testimonials table is left empty until the client supplies real ones.
--
-- Run AFTER migrations 0001–0008. Safe to re-run (idempotent upserts).
-- =====================================================================

-- --- Company profile (singleton, real data) --------------------------
insert into public.company_profile (id, legal_name, tagline, about, vision, mission, services, phone, email_training, email_admin, address, city, state, postcode, country, whatsapp, social_media)
values (
  1,
  'TERAS UNIVERSAL SDN. BHD.',
  'Building Competence. Creating Opportunities.',
  'TERAS UNIVERSAL SDN. BHD. is a Malaysian training and industrial consultancy company specialising in occupational safety and health, scaffolding, working at height, confined space, technical competency and workforce development.',
  'A clear direction for meaningful workforce development.',
  'Building competent, disciplined and industry-ready workforces through practical, compliance-focused training.',
  '["Industrial Safety","Technical Competency","Industrial Consultancy","Workforce Development"]'::jsonb,
  '+60 19-519 3834',
  'training@terasuniversal.com.my',
  'admin@terasuniversal.com.my',
  'Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam',
  'Jitra',
  'Kedah',
  '06000',
  'Malaysia',
  '60195193834',
  '{}'::jsonb
)
on conflict (id) do update set
  legal_name = excluded.legal_name,
  tagline    = excluded.tagline,
  phone      = excluded.phone,
  email_training = excluded.email_training,
  email_admin = excluded.email_admin,
  address    = excluded.address;

-- --- Site settings ---------------------------------------------------
insert into public.site_settings (key, value, description, is_public) values
  ('seo',       '{"defaultTitle":"TERAS UNIVERSAL SDN. BHD. | Industrial Safety Training & Technical Competency Malaysia","titleTemplate":"%s | TERAS UNIVERSAL"}', 'Default SEO', true),
  ('branding',  '{"logo":"/teras-universal-logo.png","favicon":"/favicon.png","navy":"#0B2C56","gold":"#E1A925"}', 'Logo, favicon, brand colours', true),
  ('contact',   '{"phone":"+60 19-519 3834","whatsapp":"60195193834","email":"training@terasuniversal.com.my"}', 'Public contact info', true),
  ('analytics', '{"ga4":"","bing":"","googleSiteVerification":""}', 'Analytics + verification IDs', false),
  ('email',     '{"fromName":"TERAS UNIVERSAL","internalRecipient":"training@terasuniversal.com.my"}', 'Resend email config', false)
on conflict (key) do nothing;

-- --- Course categories via courses (from live "Featured Programmes") --
insert into public.courses (title, slug, category, summary, status, featured, sort_order)
values
  ('Scaffolding Competency', 'scaffolding-competency', 'Industrial Safety', 'Core scaffolding knowledge, safe erection practices, inspection awareness and practical competency development.', 'published', true, 1),
  ('Working at Height', 'working-at-height', 'Industrial Safety', 'Safe access, fall prevention, equipment awareness and practical control measures for elevated work.', 'published', true, 2),
  ('Confined Space Safety', 'confined-space-safety', 'Industrial Safety', 'Hazard awareness, entry principles, control measures and emergency preparedness for confined-space work.', 'published', false, 3),
  ('Safety Passport', 'safety-passport', 'Industrial Safety', 'Essential safety responsibilities, hazard recognition and workplace controls for industry personnel.', 'published', false, 4),
  ('Scaffolding Inspection', 'scaffolding-inspection', 'Technical Competency', 'Structured inspection knowledge covering scaffold condition, safe-use requirements and reporting.', 'published', false, 5),
  ('Lifting Awareness', 'lifting-awareness', 'Technical Competency', 'Fundamental lifting-operation safety, communication, signalling and risk-control awareness.', 'published', false, 6),
  ('Foreign Worker Skills', 'foreign-worker-skills', 'Workforce Development', 'Targeted safety and skills development to strengthen understanding, discipline and workplace performance.', 'published', false, 7),
  ('Custom Corporate Training', 'custom-corporate-training', 'Workforce Development', 'Tailored programmes aligned with your workforce profile, project risks and operational objectives.', 'published', false, 8)
on conflict (slug) do nothing;

-- --- FAQ categories --------------------------------------------------
insert into public.faq_categories (name, slug, sort_order) values
  ('General', 'general', 1),
  ('Training Delivery', 'training-delivery', 2),
  ('Corporate', 'corporate', 3)
on conflict (slug) do nothing;

-- --- Gallery categories ----------------------------------------------
insert into public.gallery_categories (name, slug, sort_order) values
  ('Training', 'training', 1),
  ('Facilities', 'facilities', 2),
  ('Practical', 'practical', 3),
  ('Corporate', 'corporate', 4)
on conflict (slug) do nothing;

-- --- Gallery images (migrated from data/trainingGallery.js) ----------
-- NOTE: these currently reference the AI-placeholder images. When real
-- photos land (see Photo Replacement Brief), swap image_url only.
insert into public.gallery_images (title, alt_text, image_url, status, sort_order) values
  ('Industrial safety briefing', 'Industrial safety briefing', '/images/temp-ai-industrial-safety-briefing.webp', 'published', 1),
  ('Classroom training', 'Classroom training', '/images/temp-ai-corporate-scene-01.webp', 'published', 2),
  ('Scaffolding practical', 'Scaffolding practical', '/images/temp-ai-scaffolding-practical.webp', 'published', 3),
  ('Working at height', 'Working at height', '/images/temp-ai-training-yard.webp', 'published', 4),
  ('Equipment inspection', 'Equipment inspection', '/images/temp-ai-technical-equipment.webp', 'published', 5),
  ('Competency assessment', 'Competency assessment', '/images/temp-ai-competency-assessment.webp', 'published', 6)
on conflict do nothing;

-- --- Download categories (placeholder rows; attach media later) -------
insert into public.downloads (title, slug, category, status, sort_order) values
  ('Company Profile', 'company-profile', 'Company Profile', 'draft', 1),
  ('Training Calendar', 'training-calendar', 'Training Calendar', 'draft', 2),
  ('Registration Form', 'registration-form', 'Registration Form', 'draft', 3)
on conflict (slug) do nothing;

-- --- News categories -------------------------------------------------
insert into public.news_categories (name, slug, sort_order) values
  ('Announcements', 'announcements', 1),
  ('Safety Insights', 'safety-insights', 2),
  ('Company News', 'company-news', 3)
on conflict (slug) do nothing;

-- =====================================================================
-- BOOTSTRAP SUPER ADMIN
-- =====================================================================
-- 1) Create the user in Supabase Auth first (Dashboard → Authentication →
--    Add user, OR via the app's invite flow). Use a real staff email.
-- 2) Then elevate that user to super_admin by email. Replace the address
--    below with the actual owner email before running, or run manually.
--
-- update public.profiles
--    set role = 'super_admin', is_active = true
--  where email = 'admin@terasuniversal.com.my';
-- =====================================================================
