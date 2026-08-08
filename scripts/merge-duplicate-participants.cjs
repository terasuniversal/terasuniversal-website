// WARNING: this script has already been executed against production.
// It may modify, delete, or merge production participant data.
// Do not run casually — review the query logic and back up the affected
// tables before any future execution.
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.TERAS_DB_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  const refs = await client.query("select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema where tc.constraint_type='FOREIGN KEY' and ccu.table_schema='public' and ccu.table_name='participants'");
  const duplicates = await client.query("select regexp_replace(identity_no, '[^0-9A-Za-z]', '', 'g') as identity_key, array_agg(id order by created_at, id) as ids from public.participants where deleted_at is null and identity_no is not null and btrim(identity_no)<>'' group by 1 having count(*)>1");
  await client.query("begin");
  try {
    for (const group of duplicates.rows) {
      const [primary, ...duplicatesIds] = group.ids;
      for (const duplicateId of duplicatesIds) {
        for (const ref of refs.rows) await client.query(`update public.${ref.table_name} set ${ref.column_name} = $1 where ${ref.column_name} = $2`, [primary, duplicateId]);
        await client.query("update public.participants set deleted_at = now(), updated_at = now() where id = $1", [duplicateId]);
      }
    }
    await client.query("create unique index if not exists participants_active_email_unique on public.participants (lower(email)) where deleted_at is null and email is not null and btrim(email) <> ''");
    await client.query("create unique index if not exists participants_active_identity_unique on public.participants (regexp_replace(identity_no, '[^0-9A-Za-z]', '', 'g')) where deleted_at is null and identity_no is not null and btrim(identity_no) <> ''");
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  console.log(JSON.stringify({ mergedGroups: duplicates.rows.length }));
  await client.end();
}
main().catch(async e=>{console.error(e.message);await client.end().catch(()=>{});process.exit(1)});
