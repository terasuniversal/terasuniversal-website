-- G1 rollback (20261129120000_manual_payment_idempotency_reference). Run only with separate Owner approval.
-- Restores the pre-G1 client surface: the 7-argument record_manual_payment is executable by authenticated again and the
-- G1 functions and indexes are removed. Kept on purpose: invoice_payments.idempotency_key and its values (no DROP COLUMN,
-- CLAUDE.md section 11.5); payments recorded while G1 was live stay exactly as recorded.
-- Order matters: re-grant the old wrapper first so a failure later in the block cannot leave staff without any wrapper.
do $g1rb$
begin
  perform set_config('lock_timeout', '5s', true);
  if to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text,uuid)') is null
     or to_regprocedure('public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)') is null
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text)')) <> '95b4afc264c3b4579e49b29b8024fcfc'
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)')) <> 'db3e3d34fce21530c92e3ae8ab43a82d' then
    raise exception 'g1_rollback_precondition_failed: database is not in the G1 state - nothing changed' using errcode = 'P0001';
  end if;

  grant execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) to authenticated;
  drop function public.record_manual_payment(uuid, text, text, numeric, date, text, text, uuid);
  drop function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text, uuid);
  drop index if exists public.invoice_payments_manual_reference_key;
  drop index if exists public.invoice_payments_idempotency_key_key;

  if (select proacl::text from pg_proc where oid = to_regprocedure('public.record_manual_payment(uuid,text,text,numeric,date,text,text)'))
       is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
     or to_regclass('public.invoice_payments_manual_reference_key') is not null
     or to_regclass('public.invoice_payments_idempotency_key_key') is not null then
    raise exception 'g1_rollback_postcondition_failed' using errcode = 'P0001';
  end if;
end;
$g1rb$;
