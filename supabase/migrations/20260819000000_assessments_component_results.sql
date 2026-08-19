-- Additive: independent, manually-entered component results for Theory and
-- Practical, separate from the existing combined `result` column. No
-- score -> result derivation exists or is introduced here -- TERAS has no
-- approved passing threshold for theory_score/practical_score, so both new
-- columns default to 'pending' for every existing row (the only reliable
-- value, since there is no historical source to backfill from).

alter table public.assessments
add column if not exists theory_result text not null default 'pending',
add column if not exists practical_result text not null default 'pending';

alter table public.assessments
drop constraint if exists assessments_theory_result_check;

alter table public.assessments
add constraint assessments_theory_result_check
check (theory_result in ('pending', 'pass', 'fail'));

alter table public.assessments
drop constraint if exists assessments_practical_result_check;

alter table public.assessments
add constraint assessments_practical_result_check
check (practical_result in ('pending', 'pass', 'fail'));
