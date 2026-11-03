-- DRAFT -- NOT APPLIED. Certificates must carry the Malaysian calendar date of issue.
--
-- Why: the database runs in UTC and both functions set issue_date from current_date, so a
-- certificate issued between 00:00 and 08:00 Malaysia time carries the previous day's date.
--
-- Target: Production iagzkrzeuawaxvacqprk. Forward-only, additive. No function body and no
-- row changes. current_date follows the time zone in force, so a function-level setting is
-- enough, and it ends with the function call. It also covers the triggers those functions
-- fire. Timestamps are stored as instants, so they are unaffected.
--
-- Existing certificates keep their dates: issue_date is historical data.
--
-- A later "create or replace" of either function discards this setting, so it must be
-- repeated there. The guard contract asserts it is present.
--
-- Rollback (instant): see the "rollback>" lines.

begin;

do $$
begin
  if to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)') is null
     or to_regprocedure('app.duplicate_certificate_with_skill_snapshot(uuid)') is null then
    raise exception 'Certificate issue date fix requires the certificate issuance functions';
  end if;
end $$;

alter function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) set timezone to 'Asia/Kuala_Lumpur';
alter function app.duplicate_certificate_with_skill_snapshot(uuid) set timezone to 'Asia/Kuala_Lumpur';

commit;

-- rollback> alter function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) reset timezone;
-- rollback> alter function app.duplicate_certificate_with_skill_snapshot(uuid) reset timezone;
