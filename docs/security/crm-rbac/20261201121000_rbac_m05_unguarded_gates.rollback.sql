-- ROLLBACK for 20261201121000_rbac_m05_unguarded_gates.sql (local design artefact; separate Owner approval required to run anywhere).
-- Restores each original gate line; every other byte of each body is kept (the forward step changed only that line).
set local lock_timeout = '5s';

do $m05_rollback$
declare
  r record; v_src text; v_def text; v_acl text; v_n int; v_expect text;
begin
  for r in
    select * from (values
      ($q$public.accept_quotation_unguarded(uuid)$q$, $q$68d5c63171f6711e6aea11b88a2b05f5$q$, $q$if not app.can_module('sales_quotations', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.reject_quotation_unguarded(uuid,text)$q$, $q$93701c74e2f10a23be506a35825236b3$q$, $q$if not app.can_module('sales_quotations', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.convert_lead_to_opportunity_unguarded(uuid,text,date,numeric)$q$, $q$3afd3bb94763a42951da0b3d3defd635$q$, $q$if not (app.can_module('sales_leads', 'edit') and app.can_module('sales_opportunities', 'edit')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.mark_opportunity_lost_unguarded(uuid,text)$q$, $q$ee9b35fbba8f1696227d8776fefa3890$q$, $q$if not app.can_module('sales_opportunities', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.create_invoice_from_quotation_unguarded(uuid)$q$, $q$a7dc254af2864f7d779033f0aafda98e$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.issue_invoice_unguarded(uuid)$q$, $q$80bdf958211aff571cfa0ce0c876d932$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.cancel_invoice_unguarded(uuid,text)$q$, $q$684c58040334c45a4ad481e394d078a2$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)$q$, $q$db3e3d34fce21530c92e3ae8ab43a82d$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)$q$, $q$dd9d4310e9d68f2e2572722079788438$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.generate_receipt_for_payment_unguarded(uuid)$q$, $q$55acc776bd049b57f1ab2bbe60f90218$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.record_toyyibpay_bill_unguarded(uuid,uuid,text,text,numeric)$q$, $q$b77f8fefce280fc7df201a86b1546f0b$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.get_active_toyyibpay_attempt_unguarded(uuid)$q$, $q$9f0eb10e71703836343d8a300f48ae83$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.mark_toyyibpay_attempt_superseded_unguarded(uuid)$q$, $q$f81f10397bb7993bdfaf0da878f03435$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.log_toyyibpay_conflict_unguarded(uuid,uuid,text)$q$, $q$70da315bac633830bb0250d9b26c8156$q$, $q$if not app.can_module('invoices', 'edit') then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.create_hrdf_claim_for_invoice_unguarded(uuid)$q$, $q$2c2fa406a87917b344c1c20b9b27379f$q$, $q$if not (app.can_module('invoices', 'edit') and app.can_module('hrdf_claims', 'edit')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.record_hrdf_payment_unguarded(uuid,numeric,text,text,date,text,text)$q$, $q$1394d6827bc46d83b6265c1d8ce77bef$q$, $q$if not (app.can_module('invoices', 'edit') and app.can_module('hrdf_claims', 'edit')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.transition_hrdf_claim_unguarded(uuid,text,jsonb)$q$, $q$f86100a8e7d2234912b080ce76280144$q$, $q$if not app.can_module('hrdf_claims', 'edit') then$q$, $q$if not app.is_admin() then$q$)
    ) as t(sig, body_md5, old_line, new_line)
  loop
    select prosrc, coalesce(proacl::text, '') into v_src, v_acl from pg_proc where oid = to_regprocedure(r.sig);
    if v_src is null then
      raise exception 'm05_precondition_failed: % does not exist - nothing changed', r.sig using errcode = 'P0001';
    end if;
    if md5(replace(replace(v_src, chr(13), ''), r.old_line, r.new_line)) <> r.body_md5 then
      raise exception 'm05_precondition_failed: % body is not the reviewed post-state - nothing changed', r.sig using errcode = 'P0001';
    end if;
    v_n := (length(v_src) - length(replace(v_src, r.old_line, ''))) / length(r.old_line);
    if v_n <> 1 then
      raise exception 'm05_precondition_failed: % has % occurrence(s) of the gate line, expected 1', r.sig, v_n using errcode = 'P0001';
    end if;
    v_expect := md5(replace(v_src, r.old_line, r.new_line));
    v_def := replace(pg_get_functiondef(to_regprocedure(r.sig)), r.old_line, r.new_line);
    execute v_def;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure(r.sig)) <> v_expect
       or (select coalesce(proacl::text, '') from pg_proc where oid = to_regprocedure(r.sig)) <> v_acl then
      raise exception 'm05_postcondition_failed: % changed beyond the gate line or its ACL changed', r.sig using errcode = 'P0001';
    end if;
  end loop;
end;
$m05_rollback$;
