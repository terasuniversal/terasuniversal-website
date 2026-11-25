-- RBAC M-10 persona matrix: contact PII on lead and marketing tables (local Docker fixture only; synthetic data).
-- Runs inside the stage transaction after 10_seed.sql / 20_matrix.sql. Usage: select rbac_test.m10('<stage>');
--   stage S0, A, B, C = before M-10 (expectation "pre"); D = after M-10 (expectation "post").
-- Codes as in 20_matrix.sql: A allowed (>=1 row / success), D denied (error or 0 rows), P passes authorization
-- (success or business error), N must not succeed, - skip.
\set ON_ERROR_STOP on

-- Checks-only personas: Marketing staff (contacts Edit + dashboard View), a Marketing dashboard-only holder, and a
-- Trainer with Custom access holding an explicit Sales grant (has_module_access does not check the role for Custom
-- accounts, so the editor floor is a real barrier, not defence in depth).
insert into rbac_test.persona values
 ('MK', 'aaaaaaaa-0000-4000-8000-000000000017', 'editor', true, true, '{"marketing":"view","marketing_contacts":"edit"}', 'Marketing staff'),
 ('MV', 'aaaaaaaa-0000-4000-8000-000000000018', 'editor', true, true, '{"marketing":"view"}', 'Marketing dashboard only'),
 ('TG', 'aaaaaaaa-0000-4000-8000-000000000019', 'trainer', true, true, '{"sales_leads":"view"}', 'Trainer with Custom access and an explicit Sales grant (editor floor must still apply)');
insert into auth.users (id, email, aud, role, raw_user_meta_data)
select uid, lower(code) || '@rbac.invalid', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'RBAC ' || code)
from rbac_test.persona where code in ('MK', 'MV', 'TG');
alter table public.profiles disable trigger user;
update public.profiles p set role = x.role, is_active = x.active, access_control_enabled = x.acl
from rbac_test.persona x where x.uid = p.id and x.code in ('MK', 'MV', 'TG');
alter table public.profiles enable trigger user;
insert into public.staff_module_access (user_id, module_key, access_level)
select x.uid, m.key, m.value #>> '{}' from rbac_test.persona x, jsonb_each(x.modules) m where x.code in ('MK', 'MV', 'TG');

-- Synthetic contact rows: one public enquiry, one proposal request (both create a lead through their triggers), one
-- marketing contact promoted to a lead, one not promoted, one contact event, and a contact override on the seed lead.
do $m10seed$
declare v_e uuid; v_p uuid; v_mp uuid; v_mn uuid; v_mr uuid;
begin
  perform rbac_test.claims('SA');
  insert into public.enquiries (name, company, email, phone, enquiry_type, subject, message, source_page)
    values ('M10 Enquirer', 'M10 Sdn Bhd', 'm10.enquiry@rbac.invalid', '0100000001', 'Corporate', 'M10 subject', 'M10 message', 'contact_page') returning id into v_e;
  insert into public.proposal_requests (company_name, contact_person, email, phone, industry, category, objectives)
    values ('M10 Proposal Sdn Bhd', 'M10 Requester', 'm10.proposal@rbac.invalid', '0100000002', 'Construction', 'Industrial Safety', 'M10 objectives') returning id into v_p;
  insert into public.marketing_contacts (full_name, email, phone, source) values ('M10 Promoted', 'm10.promoted@rbac.invalid', '0100000003', 'manual') returning id into v_mp;
  update public.marketing_contacts set status = 'sales_ready' where id = v_mp;
  insert into public.marketing_contacts (full_name, email, phone, source) values ('M10 Plain', 'm10.plain@rbac.invalid', '0100000004', 'manual') returning id into v_mn;
  perform public.promote_marketing_contact_to_sales_unguarded(v_mp);
  insert into public.marketing_contacts (full_name, email, phone, source, status) values ('M10 Ready', 'm10.ready@rbac.invalid', '0100000006', 'manual', 'sales_ready') returning id into v_mr;
  insert into public.marketing_contact_events (contact_id, event_type, note) values (v_mn, 'note_added', 'M10 event');
  insert into public.sales_lead_contact_overrides (lead_metadata_id, contact_name, email, phone, created_by)
    values ((select id from rbac_test.ids where k = 'lead'), 'M10 Override', 'm10.override@rbac.invalid', '0100000005', 'aaaaaaaa-0000-4000-8000-000000000001');
  insert into rbac_test.ids values ('m10_enq', v_e), ('m10_prop', v_p), ('m10_mc_promoted', v_mp), ('m10_mc_plain', v_mn), ('m10_mc_ready', v_mr),
    ('m10_internal', (select source_id from public.sales_lead_metadata where id = (select id from rbac_test.ids where k = 'lead')));
  perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
end;
$m10seed$;

create table rbac_test.m10_cases (id text primary key, descr text, sql text, pre text, post text);
-- Persona order: SA DA SS FS MG RD CE VO NG MD TR IN LS LF LM AN MK MV TG
insert into rbac_test.m10_cases values
 ('P01', 'SELECT enquiries (public enquiry row)',
  $s$select count(*)::text from public.enquiries where id = (select id from rbac_test.ids where k = 'm10_enq')$s$,
  'AAAAAAAAAADDAAADAAD', 'ADADDAAADADDADDDADD'),
 ('P02', 'SELECT proposal_requests (public proposal row)',
  $s$select count(*)::text from public.proposal_requests where id = (select id from rbac_test.ids where k = 'm10_prop')$s$,
  'AAAAAAAAAADDAAADAAD', 'ADADDAAADADDADDDADD'),
 ('P03', 'SELECT sales_internal_lead_sources (internal lead contact)',
  $s$select count(*)::text from public.sales_internal_lead_sources where id = (select id from rbac_test.ids where k = 'm10_internal')$s$,
  'ADAAAAAADADDAAADADD', 'ADADDAAADADDADDDADD'),
 ('P04', 'SELECT sales_lead_contact_overrides (lead contact override)',
  $s$select count(*)::text from public.sales_lead_contact_overrides where lead_metadata_id = (select id from rbac_test.ids where k = 'lead')$s$,
  'ADAAAAAADADDAAADADD', 'ADADDAAADADDADDDADD'),
 ('P05', 'SELECT marketing_contacts (promoted to a lead)',
  $s$select count(*)::text from public.marketing_contacts where id = (select id from rbac_test.ids where k = 'm10_mc_promoted')$s$,
  'AAAAAAAAAADDAAADAAD', 'ADADDAAADADDADDDAAD'),
 ('P06', 'SELECT marketing_contacts (not promoted)',
  $s$select count(*)::text from public.marketing_contacts where id = (select id from rbac_test.ids where k = 'm10_mc_plain')$s$,
  'AAAAAAAAAADDAAADAAD', 'ADDDDADDDDDDDDDDAAD'),
 ('P07', 'SELECT marketing_contact_events',
  $s$select count(*)::text from public.marketing_contact_events where contact_id = (select id from rbac_test.ids where k = 'm10_mc_plain')$s$,
  'AAAAAAAAAADDAAADAAD', 'ADDDDADDDDDDDDDDADD'),
 ('P08', 'v_sales_lead_inbox shows the enquiry contact (security_invoker view)',
  $s$select count(*)::text from public.v_sales_lead_inbox where lead_source = 'enquiry' and source_id = (select id from rbac_test.ids where k = 'm10_enq') and contact_name is not null$s$,
  'ADAAAAAADADDAAADADD', 'ADADDAAADADDADDDADD'),
 ('P09', 'v_sales_lead_inbox still lists the lead row (metadata, no contact) - Sales Reports keeps statistics',
  $s$select count(*)::text from public.v_sales_lead_inbox where lead_source = 'enquiry' and source_id = (select id from rbac_test.ids where k = 'm10_enq')$s$,
  'ADAAAAAADADDAAADADD', 'ADAAAAAADADDAAADADD'),
 ('P10', 'SELECT sales_lead_metadata (no contact columns; unchanged by M-10)',
  $s$select count(*)::text from public.sales_lead_metadata where lead_source = 'enquiry' and source_id = (select id from rbac_test.ids where k = 'm10_enq')$s$,
  'ADAAAAAADADDAAADADD', 'ADAAAAAADADDAAADADD'),
 ('W01', 'UPDATE proposal_requests status (Sales Leads Edit) - still works',
  $s$update public.proposal_requests set status = 'in_review' where id = (select id from rbac_test.ids where k = 'm10_prop')$s$,
  'ADADDADDDADDADDDDDD', 'ADADDADDDADDADDDDDD'),
 ('W02', 'UPDATE marketing_contacts (Marketing Contacts Edit) - still works',
  $s$update public.marketing_contacts set status = 'nurturing' where id = (select id from rbac_test.ids where k = 'm10_mc_plain')$s$,
  'ADDDDADDDDDDDDDDADD', 'ADDDDADDDDDDDDDDADD'),
 ('W03', 'DELETE enquiries (no DELETE policy: nobody)',
  $s$delete from public.enquiries where id = (select id from rbac_test.ids where k = 'm10_enq')$s$,
  'DDDDDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDDDDD'),
 ('W04', 'DELETE marketing_contacts (no DELETE policy: nobody)',
  $s$delete from public.marketing_contacts where id = (select id from rbac_test.ids where k = 'm10_mc_plain')$s$,
  'DDDDDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDDDDD'),
 ('W05', 'DELETE proposal_requests (no DELETE policy: nobody)',
  $s$delete from public.proposal_requests where id = (select id from rbac_test.ids where k = 'm10_prop')$s$,
  'DDDDDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDDDDD'),
 ('F01', 'public enquiry form: submit_public_enquiry (anon column only; others skipped)',
  $s$select public.submit_public_enquiry('M10 Anon', null, 'm10.anon@rbac.invalid', '0100000009', 'Individual', 'Subject', 'Message', 'homepage')::text$s$,
  '---------------A---', '---------------A---'),
 ('F02', 'public proposal form: submit_proposal_request (anon)',
  $s$select public.submit_proposal_request('M10 Anon Co', 'M10 Anon', null, 'm10.anonprop@rbac.invalid', '0100000010', 'Others', 'Workforce Development', null, 5, null, null, null, 'Objectives', null)::text$s$,
  '---------------A---', '---------------A---'),
 ('F03', 'Marketing staff promotes a contact (SECURITY DEFINER RPC, Marketing Contacts Edit)',
  $s$select public.promote_marketing_contact_to_sales((select id from rbac_test.ids where k = 'm10_mc_ready'))::text$s$,
  'A---------------AD-', 'A---------------AD-');

create or replace function rbac_test.m10(p_stage text) returns table (pass int, fail int) language plpgsql as $$
declare
  c record; codes text[] := array['SA','DA','SS','FS','MG','RD','CE','VO','NG','MD','TR','IN','LS','LF','LM','AN','MK','MV','TG'];
  i int; exp_s text; e text; got text; res text; grid text; np int := 0; nf int := 0; ok boolean;
begin
  for c in select * from rbac_test.m10_cases order by id loop
    exp_s := case when p_stage = 'D' then c.post else c.pre end;
    grid := '';
    for i in 1..19 loop
      e := substr(exp_s, i, 1);
      if e = '-' then grid := grid || '-'; continue; end if;
      res := rbac_test.probe(codes[i], c.sql);
      got := rbac_test.classify(res);
      grid := grid || got;
      ok := case e when 'A' then got = 'A' when 'D' then got = 'D' when 'P' then got in ('A', 'X') when 'N' then got in ('D', 'X') else false end;
      if ok then np := np + 1;
      else nf := nf + 1; raise notice 'FAIL M10 % % % expected % got % (%)', p_stage, c.id, codes[i], e, got, res; end if;
    end loop;
    raise notice 'GRID M10 % % % | %', p_stage, c.id, grid, c.descr;
  end loop;
  -- service_role (server-side, bypasses RLS) still reads every contact row.
  if (select rbac_test.classify(rbac_test.probe('SR', $q$select (select count(*) from public.enquiries) + (select count(*) from public.marketing_contacts) + (select count(*) from public.marketing_contact_events)$q$))) = 'A'
    then np := np + 1; else nf := nf + 1; raise notice 'FAIL M10 % service_role read', p_stage; end if;
  -- W9 eBook public RPC (Staging only; absent from the Production-equivalent fixture).
  if to_regprocedure('public.submit_public_ebook_lead(text,text,text,text,boolean,text,boolean,text,jsonb,uuid)') is not null then
    res := rbac_test.probe('SR', $q$select public.submit_public_ebook_lead('m10.ebook@rbac.invalid', 'M10 Ebook', null, (select coalesce((select ebook_id::text from public.ebook_catalog limit 1), 'x')), true, 'v1', false, 'v1', '{}'::jsonb, gen_random_uuid())::text$q$);
    raise notice 'CHECK INFO M10 % w9_ebook_rpc %', p_stage, res;
  else
    raise notice 'CHECK INFO M10 % w9_ebook_rpc absent (Production-equivalent baseline)', p_stage;
  end if;
  raise notice 'TOTAL M10 % pass=% fail=%', p_stage, np, nf;
  return query select np, nf;
end $$;
