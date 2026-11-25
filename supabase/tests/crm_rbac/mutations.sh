#!/usr/bin/env bash
# DB mutation testing (perl -0 substitutions, so a rule may span lines): each mutant weakens one authorization rule in a COPY of the ten migrations (in memory), applies
# them in a rolled-back transaction on the fixture and runs the stage-D persona matrix + checks + M-10 matrix. A mutant is KILLED when
# at least one matrix probe or check fails. Usage: bash supabase/tests/crm_rbac/mutations.sh [container]
set -u; export MSYS_NO_PATHCONV=1
C=${1:-rbacdev}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
T=supabase/tests/crm_rbac; M=supabase/migrations
all(){ for f in $(ls $M | grep '^202612'); do cat "$M/$f"; echo; done; }
run(){ # name, sed-expression applied to the concatenated migrations
  local name=$1 expr=$2 out fails
  out=$( { echo "begin;"; all | perl -0pe "$expr"; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql;
           echo "select * from rbac_test.run('D');"; echo "select rbac_test.checks('D');"; echo "select * from rbac_test.m10('D');"; echo "rollback;"; } \
         | docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 -At 2>&1 )
  fails=$(echo "$out" | grep -c -E 'FAIL|ERROR')
  [ "$fails" -gt 0 ] && echo "KILLED   $name ($fails failing lines)" || echo "SURVIVED $name"
}
run "can_module without the Custom-access condition" "s/and coalesce\(\(select pr\.access_control_enabled from public\.profiles pr where pr\.id = auth\.uid\(\)\), false\)\)/)/"
# Equivalent mutant (expected to SURVIVE): has_module_access_level -> has_module_access already returns false for an
# inactive account, so the is_active term in can_module is defence in depth, not the only barrier.
run "can_module without is_active (equivalent: has_module_access also checks is_active)" "s/\n    and app\.is_active\(\)\n/\n/"
run "can_module accepts any level" "s/p_level in \('view', 'edit', 'admin'\)/true/"
run "M-01 keeps authenticated on finalize_public_registration_crm" "s/(revoke execute on function public\.finalize_public_registration_crm\(uuid\) from public, anon), authenticated;/\1;/"
run "M-04 quotations insert without module" "s/(create policy sales_quotations_insert[^;]*?)\( SELECT app\.can_module\('sales_quotations'::text, 'edit'::text\) AS can_module\)/\1true/s"
run "M-05 invoice gate becomes editor role" "s/if not app\.can_module\('invoices', 'edit'\) then/if not app.has_min_role('editor'::public.user_role) then/"
run "M-06 invoice_items back to editor floor" "s/\(app\.has_min_role\('editor'::public\.user_role\) AND \( SELECT app\.has_any_module_access\(ARRAY\['invoices'::text\], 'view'::text\) AS has_any_module_access\)\)/app.has_min_role('editor'::public.user_role)/"
run "M-07 participants without module list" "s/'feedback_responses'::text\], 'view'::text\)/'feedback_responses'::text, 'sales'::text, 'invoices'::text], 'view'::text)/"
run "M-08 audit keeps reports" "s/ARRAY\['audit'::text, 'automation'::text, 'backups'::text\]/ARRAY['audit'::text, 'automation'::text, 'backups'::text, 'reports'::text]/"
run "M-09 participants_delete role only" "s/(create policy participants_delete on public\.participants as permissive for delete to authenticated\s*)$/\1/; s/\(app\.is_admin\(\) AND \( SELECT public\.has_module_access_level\('participants'::text, 'admin'::text\) AS has_module_access_level\)\)/app.is_admin()/"
run "M-09 attendance admin branch without module" "s/\(app\.is_admin\(\) AND \( SELECT public\.has_module_access_level\('attendance'::text, 'edit'::text\) AS has_module_access_level\)\)/app.is_admin()/g"
run "M-03 default stays false" "s/set default true;/set default false;/; s/is distinct from 'true'/is distinct from 'false'/"
# M-10 mutants (each must be caught by the M-10 matrix or by M-10's own postconditions).
run "M-10 enquiries stays role-only" "s/(create policy enquiries_select[^;]*?)using \(\(app\.has_min_role\('editor'::public\.user_role\) AND \( SELECT app\.has_any_module_access\([^;]*?\)\)\);/\1using (app.has_min_role('editor'::public.user_role));/s"
run "M-10 lead-contact list gains sales_quotations (Finance would read PII)" "s/('sales_followups'::text, 'marketing_contacts'::text\], 'view'::text\))/'sales_followups'::text, 'marketing_contacts'::text, 'sales_quotations'::text], 'view'::text)/g"
run "M-10 marketing_contacts without the promoted-lead condition" "s/ AND \(EXISTS \( SELECT 1 FROM public\.sales_lead_metadata m WHERE \(\(m\.lead_source = 'marketing_contact'::text\) AND \(m\.source_id = marketing_contacts\.id\)\)\)\)//"
run "M-10 marketing_contact_events open to Sales modules" "s/ARRAY\['marketing_contacts'::text\], 'view'::text\)/ARRAY['marketing_contacts'::text, 'sales'::text, 'sales_leads'::text], 'view'::text)/"
run "M-10 proposal_requests without the editor floor" "s/(create policy proposal_requests_select[^;]*?using \()\(app\.has_min_role\('editor'::public\.user_role\) AND /\1(true AND /s"
run "M-10 overrides keep sales_reports (blocked by M-10 postcondition)" "s/(create policy sales_lead_contact_overrides_select[^;]*?'sales_followups'::text, )'marketing_contacts'::text/\1'sales_reports'::text, 'marketing_contacts'::text/s"
