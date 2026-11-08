-- External verification of the audit guard set (read-only; NOT a migration, never applied by tooling).
--
-- Why this exists: identity_audit.verify_ledger() and identity_audit.guard_components() live in the database they check. A
-- migration owner (or anyone who can redefine functions) could replace the enumerator so it reports a stale, "clean" answer.
-- This script recomputes the same fingerprint WITHOUT calling any identity_audit function and WITHOUT resolving schema-qualified
-- names (which would need USAGE on the audit schemas): it reads pg_proc / pg_trigger / pg_class directly, so it runs with a
-- role that has nothing but CONNECT. Run it from outside the application (psql -f) and compare its output with the evidence
-- stored OFF the database (see EXTERNAL_ANCHOR_DESIGN.md). On a clean install it must equal identity_audit.guard_fingerprint();
-- run.sh asserts that, and asserts that it exposes a lying enumerator that verify_ledger() cannot see.
--
-- Keep the component lists in step with identity_audit.guard_components() in 02 (this file is generated from it; run.sh compares).
set search_path = pg_catalog;
select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.string_agg(c.k || ':' || c.v, E'\n' order by c.k, c.v), 'UTF8')), 'hex')
         as external_guard_fingerprint
  from (
    select 'fn:' || f.sig as k,
           coalesce((select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) || ':' || p.proowner::pg_catalog.regrole::pg_catalog.text || ':' || coalesce(p.proacl::pg_catalog.text, '')
                      from pg_catalog.pg_proc p
                      where p.oid::pg_catalog.regprocedure::pg_catalog.text = f.sig), 'MISSING') as v
      from (values ('app.certificate_historical_update_guard()'), ('app.certificate_legacy_identity_guard()'),
                  ('app.snapshot_identity_guard()'), ('app.participant_identity_guard()'),
                  ('identity_audit.authorized(text,uuid,text,text,text)'), ('identity_audit.ledger_chain()'),
                  ('identity_audit.append_only()'), ('identity_audit.requests_guard()'),
                  ('identity_audit.text_has_identity(text)'), ('identity_audit.text_leaks_identity(text,text[])'),
                  ('identity_audit.safe_text(text,text[])'), ('identity_audit.fold_text(text)'),
                  ('identity_audit.guard_components()'), ('identity_audit.guard_fingerprint()'), ('identity_audit.guard_snapshot()'),
                  ('identity_audit.guard_state_clean()'), ('identity_audit.assert_guards_clean()'),
                  ('identity_audit.finish_guard_transition(jsonb,text[],boolean,boolean)'),
                  ('identity_audit.verify_ledger()'), ('identity_audit.record_anchor()'),
                  ('identity_audit.requests_text_guard()'), ('identity_audit.request_certificates_text_guard()'),
                  ('identity_audit.evidence_gate()'), ('identity_audit.external_evidence_ready()'),
                  ('public.identity_evidence_snapshot()'), ('public.identity_evidence_ack(bigint,bigint,text,text)'),
                  ('public.identity_evidence_heartbeat(text,bigint,text,bigint,text[])')) as f(sig)
    union all
    select 'trg:' || t.rel || '.' || t.name,
           coalesce((select x.tgenabled::pg_catalog.text || ':' || pg_catalog.md5(pg_catalog.pg_get_triggerdef(x.oid))
                       from pg_catalog.pg_trigger x
                       join pg_catalog.pg_class cl on cl.oid = x.tgrelid
                       join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
                      where x.tgname = t.name and ns.nspname || '.' || cl.relname = t.rel and not x.tgisinternal), 'MISSING')
      from (values ('public.certificates', 'trg_certificate_historical_update_guard'),
                  ('public.certificates', 'trg_certificate_legacy_identity_guard'),
                  ('public.certificate_issuance_snapshots', 'trg_snapshot_identity_guard'),
                  ('public.participants', 'trg_participant_identity_guard'),
                  ('identity_audit.corrections', 'corrections_chain'),
                  ('identity_audit.corrections', 'corrections_append_only'),
                  ('identity_audit.corrections', 'corrections_no_truncate'),
                  ('identity_audit.requests', 'requests_guard'),
                  ('identity_audit.requests', 'requests_text_guard'),
                  ('identity_audit.request_certificates', 'request_certificates_text_guard'),
                  ('identity_audit.requests', 'requests_evidence_gate_ins'),
                  ('identity_audit.requests', 'requests_evidence_gate_apply')) as t(rel, name)
  ) as c(k, v);
