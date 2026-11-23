-- MC-1 rollback (20261128120000_marketing_contact_number_execute_grant): the statement reviewed in the migration header and
-- PROPOSAL.md. Restores the pre-MC-1 ACL {postgres=X/postgres}. Run only with separate Owner approval.
revoke execute on function app.next_marketing_contact_number() from authenticated;
