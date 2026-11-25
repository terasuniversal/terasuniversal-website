-- RBAC M-11 persona matrix: certificate records (full identity number), verification log (IP), participant feedback
-- (local Docker fixture only; synthetic data, no real identity numbers or addresses).
-- Runs inside the stage transaction after 40_m10.sql. Usage: select * from rbac_test.m11('<stage>');
--   stages S0..D = before M-11 (expectation "pre"); E = after M-11 (expectation "post").
-- Codes as in 20_matrix.sql: A allowed (>=1 row / success), D denied (error or 0 rows), - skip.
\set ON_ERROR_STOP on

-- Checks-only personas: an INACTIVE role-default trainer (the old verification-log rule had no is_active check on its
-- trainer branch), a Custom editor holding only certificates View (Training Ops certificate clerk), a Custom CLIENT
-- account holding certificates and feedback grants (the role floor must still apply: has_module_access does not check
-- the role for Custom accounts), and the Management shape after the staff transition (feedback_issues, no feedback).
insert into rbac_test.persona values
 ('IT', 'aaaaaaaa-0000-4000-8000-000000000020', 'trainer', false, false, '{}', 'Inactive trainer (role default)'),
 ('CV', 'aaaaaaaa-0000-4000-8000-000000000021', 'editor', true, true, '{"certificates":"view"}', 'Certificates View only'),
 ('CL', 'aaaaaaaa-0000-4000-8000-000000000022', 'client', true, true, '{"certificates":"view","feedback":"view"}', 'Custom client account with certificate/feedback grants'),
 ('FI', 'aaaaaaaa-0000-4000-8000-000000000023', 'editor', true, true, '{"dashboard":"view","reports":"view","feedback_issues":"view"}', 'Management after transition (feedback_issues, no feedback)');
insert into auth.users (id, email, aud, role, raw_user_meta_data)
select uid, lower(code) || '@rbac.invalid', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'RBAC ' || code)
from rbac_test.persona where code in ('IT', 'CV', 'CL', 'FI');
alter table public.profiles disable trigger user;
update public.profiles p set role = x.role, is_active = x.active, access_control_enabled = x.acl
from rbac_test.persona x where x.uid = p.id and x.code in ('IT', 'CV', 'CL', 'FI');
alter table public.profiles enable trigger user;
insert into public.staff_module_access (user_id, module_key, access_level)
select x.uid, m.key, m.value #>> '{}' from rbac_test.persona x, jsonb_each(x.modules) m where x.code in ('IT', 'CV', 'CL', 'FI');

-- Synthetic rows (identity number is an obviously fake placeholder).
do $m11seed$
declare v_c uuid; v_p uuid;
begin
  insert into public.participants (full_name, company, status) values ('RBAC M11 Participant', 'RBAC Sdn Bhd', 'registered') returning id into v_p;
  insert into public.certificates (certificate_no, certificate_number, participant_name, holder_name, identity_no, identity_last4, course_name,
                                   issue_date, status, participant_id, course_id, verification_enabled)
  values ('M11-0001', 'M11-0001', 'RBAC Participant', 'RBAC Participant', 'SYNTH000000', '0000', 'RBAC Course',
          current_date, 'valid', v_p, (select id from rbac_test.ids where k = 'course'), true)
  returning id into v_c;
  insert into public.certificate_verifications (certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
  values (v_c, 'M11-0001', 'number', 'M11-0001', 'valid', '192.0.2.1', 'rbac-test');
  insert into public.participant_feedback (schedule_id, participant_id, token, status, q1_score, liked_most, submitted_at)
  values ((select id from rbac_test.ids where k = 'sched'), v_p, 'FB-M11TOKEN', 'submitted', 5, 'M11 synthetic comment', now());
  insert into rbac_test.ids values ('m11_cert', v_c);
end;
$m11seed$;

create table rbac_test.m11_cases (id text primary key, descr text, sql text, pre text, post text);
-- Persona order: SA DA SS FS MG RD CE VO NG MD TR IN LS LF LM AN MK MV TG IT CV CL FI
insert into rbac_test.m11_cases values
 ('C01', 'SELECT certificates row (identity_no column)',
  $s$select count(identity_no)::text from public.certificates where id = (select id from rbac_test.ids where k = 'm11_cert')$s$,
  'AAAAAAAAAAADAAADAAADADA', 'ADDDDADADDADAADDDDDDADD'),
 ('C02', 'Reports-style head count of valid certificates',
  $s$select count(*)::text from public.certificates where status = 'valid' and id = (select id from rbac_test.ids where k = 'm11_cert')$s$,
  'AAAAAAAAAAADAAADAAADADA', 'ADDDDADADDADAADDDDDDADD'),
 ('C03', 'SELECT certificate_verifications (ip_address column)',
  $s$select count(ip_address)::text from public.certificate_verifications where certificate_id = (select id from rbac_test.ids where k = 'm11_cert')$s$,
  'AAAAAAAAAAADAAADAAAAADA', 'ADDDDADDDDADDDDDDDDDADD'),
 ('C04', 'SELECT participant_feedback (free-text comment)',
  $s$select count(liked_most)::text from public.participant_feedback where token = 'FB-M11TOKEN'$s$,
  'AAAAAAAAAADDAAADAADDADA', 'ADDDAADDDDDDDDADDDDDDDD'),
 ('V01', 'public /verify: verify_and_log by certificate number (SECURITY DEFINER)',
  $s$select count(*)::text from public.verify_and_log('M11-0001', 'number', '192.0.2.2', 'rbac-test')$s$,
  'A---------A----A-------', 'A---------A----A-------'),
 ('V02', 'public feedback form: feedback_get_by_token (anon)',
  $s$select count(*)::text from public.feedback_get_by_token('FB-M11TOKEN')$s$,
  '---------------A-------', '---------------A-------'),
 ('V03', 'legacy lookup verify_certificate_by_value stays closed to anon (EXECUTE revoked before M-11)',
  $s$select count(*)::text from public.verify_certificate_by_value('M11-0001')$s$,
  '---------------D-------', '---------------D-------');

create or replace function rbac_test.m11(p_stage text) returns table (pass int, fail int) language plpgsql as $$
declare
  c record; codes text[] := array['SA','DA','SS','FS','MG','RD','CE','VO','NG','MD','TR','IN','LS','LF','LM','AN','MK','MV','TG','IT','CV','CL','FI'];
  i int; exp_s text; e text; got text; res text; grid text; np int := 0; nf int := 0;
begin
  for c in select * from rbac_test.m11_cases order by id loop
    exp_s := case when p_stage = 'E' then c.post else c.pre end;
    grid := '';
    for i in 1..23 loop
      e := substr(exp_s, i, 1);
      if e = '-' then grid := grid || '-'; continue; end if;
      res := rbac_test.probe(codes[i], c.sql);
      got := rbac_test.classify(res);
      grid := grid || got;
      if got = e then np := np + 1;
      else nf := nf + 1; raise notice 'FAIL M11 % % % expected % got % (%)', p_stage, c.id, codes[i], e, got, res; end if;
    end loop;
    raise notice 'GRID M11 % % % | %', p_stage, c.id, grid, c.descr;
  end loop;
  -- service_role (server-side, bypasses RLS) still reads all three tables.
  if (select rbac_test.classify(rbac_test.probe('SR', $q$select (select count(*) from public.certificates) + (select count(*) from public.certificate_verifications) + (select count(*) from public.participant_feedback)$q$))) = 'A'
    then np := np + 1; else nf := nf + 1; raise notice 'FAIL M11 % service_role read', p_stage; end if;
  raise notice 'TOTAL M11 % pass=% fail=%', p_stage, np, nf;
  return query select np, nf;
end $$;
