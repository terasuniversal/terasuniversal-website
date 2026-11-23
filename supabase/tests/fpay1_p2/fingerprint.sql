select p.proname, md5(p.prosrc) src_md5, p.proacl::text acl, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proconfig::text cfg
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('cancel_invoice', 'cancel_invoice_unguarded', 'finalize_toyyibpay_payment_from_callback', 'mark_toyyibpay_attempt_superseded_unguarded')
order by 1;
