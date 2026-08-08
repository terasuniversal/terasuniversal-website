const { Client } = require("pg");
const client = new Client({ connectionString: process.env.TERAS_DB_URL, ssl: { rejectUnauthorized: false } });
async function main() { await client.connect(); const [b,p] = await Promise.all([client.query("select id, public from storage.buckets where id in ('media','downloads')"), client.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' order by policyname")]); console.log(JSON.stringify({ buckets:b.rows, policies:p.rows })); await client.end(); }
main().catch(async e=>{console.error(e.message);await client.end().catch(()=>{});process.exit(1)});
