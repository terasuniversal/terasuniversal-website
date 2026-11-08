-- SYNTHETIC test data only. Every name, number and code below is invented and obviously fake
-- (".invalid" e-mail, "SYN-" identity numbers). No Production value is used anywhere.
set role migrator;
set check_function_bodies = off;
create schema t;
grant usage on schema t to public;

insert into public.profiles (id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa1@example.invalid', 'Synthetic SA One', 'super_admin', true),
  ('00000000-0000-0000-0000-0000000000a2', 'sa2@example.invalid', 'Synthetic SA Two', 'super_admin', true),
  ('00000000-0000-0000-0000-0000000000a3', 'adm@example.invalid', 'Synthetic Admin', 'admin', true),
  ('00000000-0000-0000-0000-0000000000a4', 'ed@example.invalid', 'Synthetic Editor', 'editor', true),
  ('00000000-0000-0000-0000-0000000000a5', 'sa-inactive@example.invalid', 'Synthetic Inactive SA', 'super_admin', false);

insert into public.courses (id, title, course_name, course_code) values
  ('c0000000-0000-0000-0000-000000000001', 'Scaffold Basic (synthetic)', 'Scaffold Basic (synthetic)', 'SYN-SCAF'),
  ('963b1f6b-4c15-4833-90da-21aa0af0f544', 'Working at Height (synthetic)', 'Working at Height (synthetic)', 'SYN-WAH');

create sequence t.cert_seq;

create function t.mk_part(p_code text, p_name text, p_ic text, p_identity_no text default null) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.participants (participant_code, participant_id, full_name, ic_passport_no, identity_no, company)
  values (p_code, p_code, p_name, p_ic, p_identity_no, 'Synthetic Co')
  returning id into v_id;
  insert into public.schedule_participants (schedule_id, participant_id)
  values ('d0000000-0000-0000-0000-000000000001', v_id);
  return v_id;
end $$;

-- kinds: A (snapshot), A_noic (snapshot without any IC), A_conf (snapshot name differs from certificate name),
--        B (legacy, stored IC), C (legacy, IC shown live from profile)
create function t.mk_cert(p_part uuid, p_kind text, p_course uuid default 'c0000000-0000-0000-0000-000000000001') returns uuid
language plpgsql as $$
declare
  v_p public.participants%rowtype; v_id uuid; v_ic text; v_l4 text; v_n bigint := nextval('t.cert_seq'); v_token text;
begin
  select * into v_p from public.participants where id = p_part;
  v_ic := coalesce(v_p.ic_passport_no, v_p.identity_no);
  v_l4 := upper(right(regexp_replace(v_ic, '[^0-9A-Za-z]', '', 'g'), 4));
  insert into public.certificates (certificate_no, participant_name, holder_name, identity_no, identity_last4, course_name,
      course_id, participant_id, schedule_id, issue_date, status, trainer_name, venue, metadata, public_verification_enabled)
  values ('SYN-CERT-' || lpad(v_n::text, 4, '0'), v_p.full_name, v_p.full_name,
      case when p_kind in ('A', 'A_conf', 'B') then v_ic end,
      case when p_kind in ('A', 'A_conf') then v_l4 end,
      (select title from public.courses where id = p_course), p_course, p_part,
      'd0000000-0000-0000-0000-000000000001', date '2026-10-01', 'valid', 'Synthetic Trainer', 'Synthetic Venue',
      jsonb_build_object('synthetic', true), true)
  returning id, verification_token into v_id, v_token;
  if p_kind in ('A', 'A_noic', 'A_conf') then
    insert into public.certificate_issuance_snapshots (certificate_id, snapshot_version, renderer_version, holder_name, identity_no,
        identity_last4, course_name, training_start_date, training_end_date, venue, trainer_name, template_config,
        verification_metadata, render_payload, issue_date)
    values (v_id, 2, 'certificate_renderer_v1',
        case when p_kind = 'A_conf' then 'Synthetic Conflict Old' else v_p.full_name end,
        case when p_kind <> 'A_noic' then v_ic end, case when p_kind <> 'A_noic' then v_l4 end,
        (select title from public.courses where id = p_course), date '2026-09-29', date '2026-09-30', 'Synthetic Venue',
        'Synthetic Trainer', '{}'::jsonb,
        jsonb_build_object('verification_token', v_token, 'verification_enabled', true),
        jsonb_build_object('certificate_number', 'SYN-CERT-' || lpad(v_n::text, 4, '0'),
            'holder_name', case when p_kind = 'A_conf' then 'Synthetic Conflict Old' else v_p.full_name end)
          || case when p_kind <> 'A_noic' then jsonb_build_object('identity_no', v_ic) else '{}'::jsonb end,
        date '2026-10-01');
  end if;
  return v_id;
end $$;

-- evidence builder: n distinct document types, hashes derived from a seed
create function t.ev(p_n int, p_seed text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('type', (array['national_id', 'employer_letter', 'signed_declaration'])[i],
      'reference', 'SYN-DOC-' || p_seed || '-' || i,
      'sha256', encode(sha256(convert_to(p_seed || '-' || i, 'UTF8')), 'hex'), 'reviewed_on', '2026-11-01') order by i)
  from generate_series(1, p_n) i $$;

-- decision builder: one decision per active certificate of the participant
create function t.dec(p_part uuid, p_name text, p_ident_ab text, p_ident_c text, p_reason text default 'synthetic decision reason') returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('certificate_id', c.id, 'name_decision', p_name,
      'identity_decision', case identity_audit.identity_class(c.id) when 'A' then p_ident_ab when 'B' then p_ident_ab when 'C' then p_ident_c end,
      'reason', p_reason)) order by c.certificate_no), '[]'::jsonb)
  from public.certificates c where c.participant_id = p_part and c.deleted_at is null $$;

create function t.pid(p_code text) returns uuid language sql as $$ select id from public.participants where participant_code = p_code $$;

-- participants and certificates ---------------------------------------------------------------------
select t.mk_part('PA', 'Synthetic Alpha Person', 'SYN-A-100001', 'SYN-A-100001');
select t.mk_cert(t.pid('PA'), 'A'); select t.mk_cert(t.pid('PA'), 'B'); select t.mk_cert(t.pid('PA'), 'C');
select t.mk_part('PB', 'Synthetic Bravo Person', 'SYN-B-200002');           select t.mk_cert(t.pid('PB'), 'A');
select t.mk_part('PC', 'Synthetic Charlie Person', 'SYN-C-300003');          -- no certificates
select t.mk_part('PW', 'Synthetic Whiskey Person', 'SYN-W-400004');
select t.mk_cert(t.pid('PW'), 'B', '963b1f6b-4c15-4833-90da-21aa0af0f544');
update public.certificates set identity_no = 'SYN-W-DUP-0005' where participant_id = t.pid('PW');
select t.mk_part('PD', 'Synthetic Duplicate Person', 'SYN-W-DUP-0005');     select t.mk_cert(t.pid('PD'), 'A');
select t.mk_part('PN', 'Synthetic November Person', 'SYN-N-500006');        select t.mk_cert(t.pid('PN'), 'A');
select t.mk_part('PF', 'Synthetic Foxtrot Person', 'SYN-F-600007');         select t.mk_cert(t.pid('PF'), 'A');
select t.mk_part('PG', 'Synthetic Golf Person', 'SYN-G-700008');            select t.mk_cert(t.pid('PG'), 'A');
select t.mk_part('PH', 'Synthetic Hotel Person', 'SYN-H-800009');           select t.mk_cert(t.pid('PH'), 'A');
select t.mk_part('PI', 'Synthetic India Person', 'SYN-I-900010');           select t.mk_cert(t.pid('PI'), 'A');
select t.mk_part('PJ', 'Synthetic Juliet Person', 'SYN-J-110011', 'SYN-J-110011'); select t.mk_cert(t.pid('PJ'), 'A');
select t.mk_part('PK', 'Synthetic Kilo Person', 'SYN-K-120012');            select t.mk_cert(t.pid('PK'), 'A'); select t.mk_cert(t.pid('PK'), 'C');
select t.mk_part('PL', 'Synthetic Lima Person', 'SYN-L-130013');            select t.mk_cert(t.pid('PL'), 'C');
select t.mk_part('PM', 'Synthetic Mike Person', 'SYN-M-140014');            select t.mk_cert(t.pid('PM'), 'A_noic');
select t.mk_part('PO', 'Synthetic Oscar Person', 'SYN-O-150015');           select t.mk_cert(t.pid('PO'), 'A_conf');
select t.mk_part('PP', 'Synthetic Papa Person', 'SYN-P-160016');            select t.mk_cert(t.pid('PP'), 'A');
select t.mk_part('PQ', 'Synthetic Quebec Person', 'SYN-Q-170017');          select t.mk_cert(t.pid('PQ'), 'A');
select t.mk_part('PR', 'Synthetic Romeo Person', 'SYN-R-180018');           select t.mk_cert(t.pid('PR'), 'A');
select t.mk_part('PS', 'Synthetic Sierra Person', 'SYN-S-190019');          select t.mk_cert(t.pid('PS'), 'A');
select t.mk_part('PT', 'Synthetic Tango Person', 'SYN-T-200020');           select t.mk_cert(t.pid('PT'), 'A'); select t.mk_cert(t.pid('PT'), 'A');
select t.mk_part('PU', 'Synthetic Uniform Person', 'SYN-U-210021');         select t.mk_cert(t.pid('PU'), 'A');
select t.mk_part('PV', 'Synthetic Victor Person', 'SYN-V-220022');          select t.mk_cert(t.pid('PV'), 'A');
select t.mk_part('PX', 'Synthetic Xray Person', 'SYN-X-230023');            select t.mk_cert(t.pid('PX'), 'A');
-- a soft-deleted participant whose certificate still carries an identity (certificate-level collision)
select t.mk_part('PZ', 'Synthetic Zulu Person', 'SYN-Z-150025');            select t.mk_cert(t.pid('PZ'), 'A');
update public.participants set deleted_at = now() where participant_code = 'PZ';
-- a soft-deleted participant WITHOUT certificates (participant-level collision with a deleted person)
select t.mk_part('PZ2', 'Synthetic Zulu Two Person', 'SYN-Z-150026');
update public.participants set deleted_at = now() where participant_code = 'PZ2';
-- a profile that stores its identity ONLY in identity_no (the renderer never reads that column)
select t.mk_part('PIDN', 'Synthetic Indigo Person', null, 'SYN-IDN-160027'); select t.mk_cert(t.pid('PIDN'), 'C');

-- pre-state fingerprints of everything except the identity columns (used by the invariants test)
create table t.pre_c as select id, md5((to_jsonb(c) - array['holder_name', 'participant_name', 'identity_no', 'identity_last4', 'updated_at'])::text) h
  from public.certificates c;
create table t.pre_s as select certificate_id, md5((to_jsonb(s) - array['holder_name', 'identity_no', 'identity_last4', 'render_payload'])::text
  || (s.render_payload - array['holder_name', 'identity_no'])::text) h from public.certificate_issuance_snapshots s;
create table t.wah_before as select id, app.wah_participant_holds_certificate(id) v from public.participants;
